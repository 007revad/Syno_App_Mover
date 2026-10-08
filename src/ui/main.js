Ext.namespace("SYNO.SDS.App_Mover");

// -----------------------------------------------------------------
// App entry point
// -----------------------------------------------------------------
Ext.define("SYNO.SDS._ThirdParty.App.App_Mover", {
    extend: "SYNO.SDS.AppInstance",
    appWindowName: "SYNO.SDS.App_Mover.MainWindow",
    constructor: function() {
        this.callParent(arguments);
    }
});

// -----------------------------------------------------------------
// Shared API helper (same shape as Syno_Toolbox's)
// -----------------------------------------------------------------
SYNO.SDS.App_Mover.API_PATH = "/webman/3rdparty/App_Mover/api.cgi";

SYNO.SDS.App_Mover.apiCall = function(action, params, method, callback) {
    // 4-arg form: apiCall(action, params, method, cb)
    // 3-arg form (GET): apiCall(action, params, cb)
    if (typeof method === "function") {
        callback = method;
        method = "GET";
    }
    Ext.Ajax.request({
        url: SYNO.SDS.App_Mover.API_PATH,
        method: method || "GET",
        params: Ext.apply({ action: action, _ts: new Date().getTime() }, params || {}),
        success: function(response) {
            var resp;
            try {
                resp = Ext.decode(response.responseText);
            } catch (e) {
                resp = { success: false, message: "Bad response from api.cgi" };
            }
            callback(resp);
        },
        failure: function() {
            callback({ success: false, message: "Request to api.cgi failed" });
        }
    });
};

// -----------------------------------------------------------------
// Main window
//
// Three panels (Move, Backup, Restore) and a Settings dialog. Starting
// one asks for confirmation, then the window shows the script's output
// as it runs (polling jobstatus - the job carries on if the window is
// closed, and reopening the window picks it up again) and finishes with
// a results window.
// -----------------------------------------------------------------
Ext.define("SYNO.SDS.App_Mover.MainWindow", {
    extend: "SYNO.SDS.AppWindow",

    constructor: function(a) {
        this.appInstance = a.appInstance;
        this.pollMs = 1000;         // how often to ask for new output
        this.mode = "move";
        this.volumes = [];
        this.settings = { backuppath: "", backuppath_exists: false, buffer: 50, skip_minutes: 360 };
        this.schedule = { type: "", interval: 0, apps: [], task_exists: false };
        this.backupItems = [];
        this.viewingResults = false;     // the last job's output is still on screen
        this.job = null;
        this.polling = false;
        this.req = { move: 0, backup: 0, restore: 0, picker: 0 };   // newest request of each list
        SYNO.SDS.App_Mover.MainWindow.superclass.constructor.call(this, Ext.apply({
            layout: "fit",
            resizable: true,
            cls: "syno-app-win appmover-win",
            maximizable: true,
            minimizable: true,
            showHelp: false,
            width: 760,
            height: 580,
            minWidth: 760,
            minHeight: 580,
            html: this.buildHtml(),
            listeners: {
                afterrender: {
                    fn: this.onAfterRender,
                    scope: this
                }
            }
        }, a));
    },

    buildHtml: function() {
        return [
            '<style>',
            '  .am-body { display:flex; flex-direction:column; height:100%; padding:10px; box-sizing:border-box; position:relative; font-size:13px; }',
            '  .am-body * { box-sizing:border-box; }',
            '  .am-selectable { -webkit-user-select:text; -moz-user-select:text; -ms-user-select:text; user-select:text; }',
            '  .am-toolbar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding-bottom:10px; }',
            '  .am-spacer { flex:1 1 auto; }',
            '  .am-body button { padding:5px 18px; cursor:pointer; border-radius:4px; font-size:13px; font-weight:bold; border:1px solid #ccc; background-color:#fff; color:#555; }',
            '  .am-body button:hover { border:1px solid #aaa; background-color:#f0f0f0; }',
            '  .am-body button[disabled] { opacity:0.45; cursor:default; background-color:#fff; border:1px solid #ccc; }',
            '  .am-body button.am-mode.active { border:1px solid #1B8AED; background-color:#1B8AED; color:#fff; }',
            '  .am-body button.am-primary { border:1px solid #1B8AED; background-color:#1B8AED; color:#fff; }',
            '  .am-body button.am-primary:hover { border:1px solid #057FEB; background-color:#057FEB; }',
            '  .am-body button.am-primary[disabled] { border:1px solid #1B8AED; background-color:#1B8AED; }',
            '  .am-message { flex:0 0 auto; min-height:18px; color:#c00; padding-bottom:6px; }',
            '  .am-panel { flex:1 1 auto; display:none; flex-direction:column; min-height:0; }',
            '  .am-panel.active { display:flex; }',
            '  .am-row { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding-bottom:8px; }',
            '  .am-row label { color:#555; }',
            '  .am-row select { min-width:200px; padding:3px; }',
            '  .am-list { flex:1 1 auto; overflow:auto; border:1px solid #ccc; border-radius:4px; padding:4px 8px; background:#fff; min-height:80px; }',
            '  .am-item { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px; padding:4px 2px; border-bottom:1px solid #f0f0f0; }',
            '  .am-item label { flex:0 0 auto; white-space:nowrap; }',
            '  .am-item.am-all { border-bottom:1px solid #ccc; font-weight:bold; }',
            '  .am-item.am-disabled { color:#999; }',
            '  .am-item .am-note { flex:1 1 auto; color:#888; font-size:12px; }',
            '  .am-item .am-warn { flex:1 1 auto; color:#b36b00; font-size:12px; }',
            '  .am-empty { color:#888; padding:10px 2px; }',
            '  .am-notes { flex:0 0 auto; min-height:18px; color:#555; padding-top:6px; font-size:12px; white-space:pre-line; }',
            '  .am-notes.am-bad { color:#c00; }',
            '  .am-actions { flex:0 0 auto; text-align:right; padding-top:8px; }',
            '  .am-actions button { margin-left:8px; }',
            '  .am-pathrow { display:flex; gap:6px; }',
            '  .am-pathrow input { flex:1 1 auto; width:auto; }',
            '  .am-field select { padding:3px; }',
            '  .am-sch-apps { padding:6px; background:#f6f6f6; border:1px solid #ddd; border-radius:4px; max-height:90px; overflow:auto; }',
            '  .am-pk-path { font-weight:bold; color:#444; padding-bottom:6px; word-break:break-all; }',
            '  .am-pk-list { height:260px; overflow:auto; border:1px solid #ccc; border-radius:4px; background:#fff; }',
            '  .am-pk-row { padding:5px 8px; cursor:pointer; border-bottom:1px solid #f0f0f0; }',
            '  .am-pk-row:hover { background:#eaf3fd; }',
            '  .am-pk-up { color:#555; }',
            '  .am-progress { flex:1 1 auto; display:none; flex-direction:column; min-height:0; }',
            '  .am-progress.active { display:flex; }',
            '  .am-progress-head { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding-bottom:8px; font-size:14px; font-weight:bold; color:#444; }',
            '  .am-spinner { width:18px; height:18px; border:3px solid #cfe3f8; border-top-color:#1B8AED; border-radius:50%; animation:am-spin 0.9s linear infinite; }',
            '  .am-spinner.am-done { display:none; }',
            '  @keyframes am-spin { to { transform:rotate(360deg); } }',
            '  .am-log { flex:1 1 auto; min-height:0; margin:0; overflow:auto; background:#161eb5; color:#ddd; padding:8px; font-family:Verdana,Arial,sans-serif; font-size:12px; white-space:pre-wrap; border-radius:4px; }',
            '  .am-log { scrollbar-color:#9bb8ee #0f1680; scrollbar-width:auto; }',
            '  .am-log::-webkit-scrollbar { width:16px; }',
            '  .am-log::-webkit-scrollbar-track { background:#0f1680; }',
            '  .am-log::-webkit-scrollbar-thumb { background:#9bb8ee; border:3px solid #0f1680; border-radius:8px; min-height:40px; }',
            '  .am-log::-webkit-scrollbar-thumb:hover { background:#c3d6f7; }',
            '  .am-list, .am-modal-text, .am-sch-apps, .am-pk-list { scrollbar-color:#6b7c93 #e9edf2; scrollbar-width:auto; }',
            '  .am-list::-webkit-scrollbar, .am-modal-text::-webkit-scrollbar, .am-sch-apps::-webkit-scrollbar, .am-pk-list::-webkit-scrollbar { width:14px; }',
            '  .am-list::-webkit-scrollbar-track, .am-modal-text::-webkit-scrollbar-track, .am-sch-apps::-webkit-scrollbar-track, .am-pk-list::-webkit-scrollbar-track { background:#e9edf2; }',
            '  .am-list::-webkit-scrollbar-thumb, .am-modal-text::-webkit-scrollbar-thumb, .am-sch-apps::-webkit-scrollbar-thumb, .am-pk-list::-webkit-scrollbar-thumb { background:#6b7c93; border:3px solid #e9edf2; border-radius:8px; min-height:40px; }',
            '  .am-list::-webkit-scrollbar-thumb:hover, .am-modal-text::-webkit-scrollbar-thumb:hover, .am-sch-apps::-webkit-scrollbar-thumb:hover, .am-pk-list::-webkit-scrollbar-thumb:hover { background:#4f607a; }',
            '  .am-modal-backdrop { display:none; position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.45); z-index:1000; align-items:center; justify-content:center; }',
            '  .am-modal-backdrop.open { display:flex; }',
            '  .am-modal { position:relative; background:#fff; color:#222; width:380px; max-width:92%; max-height:92%; display:flex; flex-direction:column; padding:20px; border-radius:6px; box-shadow:0 4px 24px rgba(0,0,0,0.35); }',
            '  .am-modal.am-wide { width:660px; height:80%; }',
            '  .am-modal h3 { margin:0 0 12px 0; font-size:15px; flex:0 0 auto; }',
            '  .am-modal-body { flex:1 1 auto; overflow:auto; min-height:0; }',
            '  .am-modal-text { margin:0; white-space:pre-wrap; font-family:Verdana,Arial,sans-serif; font-size:12px; background:#f6f6f6; border:1px solid #ddd; border-radius:4px; padding:8px; height:100%; min-height:0; overflow:auto; }',
            '  .am-modal-close { position:absolute; top:8px; right:10px; border:none !important; background:none !important; font-size:16px !important; cursor:pointer; color:#666 !important; line-height:1; padding:4px !important; }',
            '  .am-modal-buttons { flex:0 0 auto; text-align:right; white-space:nowrap; margin-top:14px; }',
            '  .am-modal-buttons button { margin-left:8px; }',
            '  .am-field { margin-bottom:12px; }',
            '  .am-field label { display:block; margin-bottom:4px; color:#555; }',
            '  .am-field input { width:100%; padding:4px; }',
            '  .am-field .am-hint { color:#888; font-size:12px; margin-top:2px; }',
            '  .am-settings-status { color:#c00; font-size:12px; min-height:16px; }',
            '</style>',
            '<div class="am-body am-selectable">',
            '  <div class="am-toolbar">',
            '    <button type="button" class="am-mode active" data-mode="move">Move</button>',
            '    <button type="button" class="am-mode" data-mode="backup">Backup</button>',
            '    <button type="button" class="am-mode" data-mode="restore">Restore</button>',
            '    <span class="am-spacer"></span>',
            '    <button type="button" class="am-settings">Settings</button>',
            '  </div>',
            '  <div class="am-message"></div>',
            '  <div class="am-panel am-panel-move active">',
            '    <div class="am-row">',
            '      <label>Move apps from</label><select class="am-src"></select>',
            '      <label>to</label><select class="am-dst"></select>',
            '    </div>',
            '    <div class="am-list am-list-move"></div>',
            '    <div class="am-notes am-notes-move"></div>',
            '    <div class="am-actions"><button type="button" class="am-primary am-go-move" disabled>Move</button></div>',
            '  </div>',
            '  <div class="am-panel am-panel-backup">',
            '    <div class="am-list am-list-backup"></div>',
            '    <div class="am-notes am-notes-backup"></div>',
            '    <div class="am-actions">',
            '      <button type="button" class="am-schedule" disabled>Schedule\u2026</button>',
            '      <button type="button" class="am-primary am-go-backup" disabled>Back up</button>',
            '    </div>',
            '  </div>',
            '  <div class="am-panel am-panel-restore">',
            '    <div class="am-list am-list-restore"></div>',
            '    <div class="am-notes am-notes-restore"></div>',
            '    <div class="am-actions"><button type="button" class="am-primary am-go-restore" disabled>Restore</button></div>',
            '  </div>',
            '  <div class="am-progress">',
            '    <div class="am-progress-head"><span class="am-spinner"></span><span class="am-progress-title"></span></div>',
            '    <pre class="am-log"></pre>',
            '  </div>',
            '  <div class="am-modal-backdrop am-confirm-backdrop">',
            '    <div class="am-modal">',
            '      <h3 class="am-confirm-title"></h3>',
            '      <div class="am-modal-body am-confirm-body"></div>',
            '      <div class="am-modal-buttons">',
            '        <button type="button" class="am-confirm-cancel">Cancel</button>',
            '        <button type="button" class="am-primary am-confirm-ok">OK</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '  <div class="am-modal-backdrop am-results-backdrop">',
            '    <div class="am-modal am-wide">',
            '      <h3 class="am-results-title"></h3>',
            '      <div class="am-modal-body"><pre class="am-modal-text am-results-text"></pre></div>',
            '      <div class="am-modal-buttons"><button type="button" class="am-primary am-results-close">Close</button></div>',
            '    </div>',
            '  </div>',
            '  <div class="am-modal-backdrop am-settings-backdrop">',
            '    <div class="am-modal">',
            '      <button type="button" class="am-modal-close am-settings-x" aria-label="Close">\u00d7</button>',
            '      <h3>Settings</h3>',
            '      <div class="am-field">',
            '        <label>Backup location</label>',
            '        <div class="am-pathrow">',
            '          <input type="text" class="am-set-path" placeholder="/volume1/backups">',
            '          <button type="button" class="am-browse">Browse\u2026</button>',
            '        </div>',
            '        <div class="am-hint">An existing folder, like /volume1/backups. Letters, numbers and . _ + - only.</div>',
            '      </div>',
            '      <div class="am-field">',
            '        <label>Free space to leave on the destination volume (GB)</label>',
            '        <input type="number" min="0" max="9999" class="am-set-buffer">',
            '      </div>',
            '      <div class="am-field">',
            '        <label>Skip an app if it was backed up less than this many minutes ago</label>',
            '        <input type="number" min="0" max="999999" class="am-set-skip">',
            '      </div>',
            '      <div class="am-settings-status"></div>',
            '      <div class="am-modal-buttons">',
            '        <button type="button" class="am-settings-cancel">Cancel</button>',
            '        <button type="button" class="am-primary am-settings-save">Save</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '  <div class="am-modal-backdrop am-schedule-backdrop">',
            '    <div class="am-modal">',
            '      <button type="button" class="am-modal-close am-sch-x" aria-label="Close">\u00d7</button>',
            '      <h3>Schedule backup</h3>',
            '      <div class="am-field">',
            '        <label>Apps to back up (the ones ticked in the list)</label>',
            '        <div class="am-sch-apps"></div>',
            '      </div>',
            '      <div class="am-field">',
            '        <label>How often</label>',
            '        <div class="am-pathrow">',
            '          <select class="am-sch-type"></select>',
            '          <select class="am-sch-interval">' + this.hourOptions() + '</select>',
            '        </div>',
            '        <div class="am-hint am-sch-hint"></div>',
            '      </div>',
            '      <div class="am-field am-sch-current"></div>',
            '      <div class="am-settings-status am-sch-status"></div>',
            '      <div class="am-modal-buttons">',
            '        <button type="button" class="am-sch-cancel">Cancel</button>',
            '        <button type="button" class="am-sch-remove">Remove</button>',
            '        <button type="button" class="am-primary am-sch-save">Save</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '  <div class="am-modal-backdrop am-picker-backdrop">',
            '    <div class="am-modal">',
            '      <button type="button" class="am-modal-close am-pk-x" aria-label="Close">\u00d7</button>',
            '      <h3>Choose the backup folder</h3>',
            '      <div class="am-pk-path"></div>',
            '      <div class="am-pk-list"></div>',
            '      <div class="am-settings-status am-pk-status"></div>',
            '      <div class="am-modal-buttons">',
            '        <button type="button" class="am-pk-cancel">Cancel</button>',
            '        <button type="button" class="am-primary am-pk-select" disabled>Select this folder</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join("");
    },

    hourOptions: function() {
        var out = "", i;
        for (i = 1; i <= 11; i++) {
            out += '<option value="' + i + '"' + (i === 6 ? " selected" : "") + ">" +
                (i === 1 ? "Every hour" : "Every " + i + " hours") + "</option>";
        }
        return out;
    },

    // ---------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------
    onAfterRender: function() {
        var el = this.body.dom;
        var q = function(sel) { return el.querySelector(sel); };
        this.el$ = {
            message: q(".am-message"),
            src: q(".am-src"), dst: q(".am-dst"),
            listMove: q(".am-list-move"), listBackup: q(".am-list-backup"), listRestore: q(".am-list-restore"),
            notesMove: q(".am-notes-move"), notesBackup: q(".am-notes-backup"), notesRestore: q(".am-notes-restore"),
            goMove: q(".am-go-move"), goBackup: q(".am-go-backup"), goRestore: q(".am-go-restore"),
            progress: q(".am-progress"), progressTitle: q(".am-progress-title"), spinner: q(".am-spinner"), log: q(".am-log"),
            confirmBackdrop: q(".am-confirm-backdrop"), confirmTitle: q(".am-confirm-title"), confirmBody: q(".am-confirm-body"),
            resultsBackdrop: q(".am-results-backdrop"), resultsTitle: q(".am-results-title"), resultsText: q(".am-results-text"),
            settingsBackdrop: q(".am-settings-backdrop"), setPath: q(".am-set-path"), setBuffer: q(".am-set-buffer"),
            setSkip: q(".am-set-skip"), settingsStatus: q(".am-settings-status"),
            goSchedule: q(".am-schedule"),
            scheduleBackdrop: q(".am-schedule-backdrop"), schApps: q(".am-sch-apps"), schType: q(".am-sch-type"),
            schInterval: q(".am-sch-interval"), schHint: q(".am-sch-hint"), schCurrent: q(".am-sch-current"),
            schStatus: q(".am-sch-status"), schSave: q(".am-sch-save"), schRemove: q(".am-sch-remove"),
            pickerBackdrop: q(".am-picker-backdrop"), pickerPath: q(".am-pk-path"), pickerList: q(".am-pk-list"),
            pickerStatus: q(".am-pk-status"), pickerSelect: q(".am-pk-select")
        };
        this.panels = {
            move: q(".am-panel-move"), backup: q(".am-panel-backup"), restore: q(".am-panel-restore")
        };
        this.modeButtons = el.querySelectorAll(".am-mode");
        this.settingsButton = q(".am-settings");

        Ext.each(this.modeButtons, function(btn) {
            Ext.fly(btn).on("click", function() { this.showMode(btn.getAttribute("data-mode")); }, this);
        }, this);
        Ext.fly(this.settingsButton).on("click", this.openSettings, this);
        Ext.fly(this.el$.src).on("change", this.onSrcChange, this);
        Ext.fly(this.el$.dst).on("change", this.onDstChange, this);
        Ext.fly(this.el$.goMove).on("click", function() { this.confirmStart("move"); }, this);
        Ext.fly(this.el$.goBackup).on("click", function() { this.confirmStart("backup"); }, this);
        Ext.fly(this.el$.goRestore).on("click", function() { this.confirmStart("restore"); }, this);
        Ext.fly(q(".am-confirm-cancel")).on("click", this.closeConfirm, this);
        Ext.fly(q(".am-confirm-ok")).on("click", this.onConfirmOk, this);
        Ext.fly(q(".am-results-close")).on("click", this.closeResults, this);
        Ext.fly(q(".am-settings-x")).on("click", this.closeSettings, this);
        Ext.fly(q(".am-settings-cancel")).on("click", this.closeSettings, this);
        Ext.fly(q(".am-settings-save")).on("click", this.onSaveSettings, this);
        Ext.fly(q(".am-browse")).on("click", this.openPicker, this);
        Ext.fly(q(".am-pk-x")).on("click", this.closePicker, this);
        Ext.fly(q(".am-pk-cancel")).on("click", this.closePicker, this);
        Ext.fly(this.el$.pickerSelect).on("click", this.onPickerSelect, this);
        Ext.fly(this.el$.goSchedule).on("click", this.openSchedule, this);
        Ext.fly(q(".am-sch-x")).on("click", this.closeSchedule, this);
        Ext.fly(q(".am-sch-cancel")).on("click", this.closeSchedule, this);
        Ext.fly(this.el$.schType).on("change", this.onScheduleTypeChange, this);
        Ext.fly(this.el$.schSave).on("click", this.onSaveSchedule, this);
        Ext.fly(this.el$.schRemove).on("click", this.onRemoveSchedule, this);

        // DSM's desktop suppresses the native right-click menu; stopping
        // propagation lets Copy work over our own content (see CPUTemp).
        Ext.fly(el).on("contextmenu", function(ev) { ev.stopPropagation(); });

        this.start();
    },

    start: function() {
        this.setMessage("Loading\u2026", false);
        // Also the first call, so a "Not authorised" is shown straight away.
        // A job that is already running (started earlier, or from another
        // window) is picked up where it is.
        SYNO.SDS.App_Mover.apiCall("jobstatus", { job: "0:0" }, (function(resp) {
            if (!resp || !resp.success) {
                this.setMessage((resp && resp.message) || "Could not talk to the NAS", true);
                return;
            }
            this.setMessage("", false);
            this.loadSettings();
            this.loadSchedule();
            if (resp.result && resp.result.running) {
                this.beginProgress(resp.result.job_id, "A job is running");
                return;
            }
            this.loadVolumes();
        }).createDelegate(this));
    },

    // ---------------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------------
    setMessage: function(msg, isError) {
        if (!this.el$) { return; }
        this.el$.message.textContent = msg || "";
        this.el$.message.style.color = isError ? "#c00" : "#888";
    },

    esc: function(s) {
        return Ext.util.Format.htmlEncode(s === null || s === undefined ? "" : String(s));
    },

    formatKB: function(kb) {
        var gb = kb / 1048576, mb = kb / 1024;
        if (gb >= 1000) { return (gb / 1024).toFixed(1) + " TB"; }
        if (gb >= 10) { return Math.round(gb) + " GB"; }
        if (gb >= 1) { return gb.toFixed(1) + " GB"; }
        if (mb >= 10) { return Math.round(mb) + " MB"; }
        if (mb >= 1) { return mb.toFixed(1) + " MB"; }
        return Math.round(kb) + " KB";
    },

    plural: function(n, one, many) {
        return n + " " + (n === 1 ? one : many);
    },

    // The values of the ticked boxes in a list
    checked: function(listEl) {
        var out = [];
        Ext.each(listEl.querySelectorAll("input.am-cb"), function(cb) {
            if (cb.checked && !cb.disabled) { out.push(cb.value); }
        });
        return out;
    },

    // ---------------------------------------------------------------
    // Modes
    // ---------------------------------------------------------------
    showMode: function(mode) {
        if (this.job) { return; }
        // Leaving the last job's output (the lists are loaded again below)
        this.viewingResults = false;
        Ext.fly(this.el$.progress).removeClass("active");
        this.mode = mode;
        Ext.each(this.modeButtons, function(btn) {
            if (btn.getAttribute("data-mode") === mode) {
                Ext.fly(btn).addClass("active");
            } else {
                Ext.fly(btn).removeClass("active");
            }
        });
        Ext.each(["move", "backup", "restore"], function(m) {
            if (m === mode) {
                Ext.fly(this.panels[m]).addClass("active");
            } else {
                Ext.fly(this.panels[m]).removeClass("active");
            }
        }, this);
        this.setMessage("", false);
        if (mode === "move") { this.loadVolumes(); }
        if (mode === "backup") {
            // Settings can have changed (or the folder renamed in File Station)
            this.loadSettings();
            this.loadSchedule();
            this.loadBackupPackages();
        }
        if (mode === "restore") { this.loadBackups(); }
    },

    // ---------------------------------------------------------------
    // Move
    // ---------------------------------------------------------------
    loadVolumes: function() {
        SYNO.SDS.App_Mover.apiCall("listvolumes", {}, (function(resp) {
            if (!resp || !resp.success) {
                this.setMessage((resp && resp.message) || "Could not list the volumes", true);
                return;
            }
            this.volumes = resp.result || [];
            this.fillSourceSelect();
        }).createDelegate(this));
    },

    fillSourceSelect: function() {
        var sel = this.el$.src, current = sel.value, html = "", found = false, i, v;
        for (i = 0; i < this.volumes.length; i++) {
            v = this.volumes[i];
            if (v.entries > 0) {
                html += '<option value="' + this.esc(v.volume) + '">' + this.esc(v.volume) + " (" +
                    this.plural(v.entries, "item", "items") + ")</option>";
                if (v.volume === current) { found = true; }
            }
        }
        sel.innerHTML = html;
        if (found) { sel.value = current; }
        this.fillDestinationSelect();
        this.loadMovePackages();
    },

    fillDestinationSelect: function() {
        var sel = this.el$.dst, src = this.el$.src.value, current = sel.value, html = "", found = false, i, v;
        for (i = 0; i < this.volumes.length; i++) {
            v = this.volumes[i];
            if (v.volume !== src) {
                html += '<option value="' + this.esc(v.volume) + '">' + this.esc(v.volume) + " (" +
                    this.formatKB(v.free_kb) + " free)</option>";
                if (v.volume === current) { found = true; }
            }
        }
        sel.innerHTML = html;
        if (found) { sel.value = current; }
        this.el$.notesMove.textContent = html ? "" : "There is no other volume to move apps to.";
    },

    onSrcChange: function() {
        this.fillDestinationSelect();
        this.loadMovePackages();
    },

    onDstChange: function() {
        this.loadDatabaseInfo();
        this.updateMoveButton();
    },

    loadMovePackages: function() {
        var src = this.el$.src.value, id = ++this.req.move;
        this.dbinfo = null;
        if (!src) {
            this.el$.listMove.innerHTML = '<div class="am-empty">No apps were found.</div>';
            this.updateMoveButton();
            return;
        }
        this.el$.listMove.innerHTML = '<div class="am-empty">Loading\u2026</div>';
        this.updateMoveButton();       // nothing is ticked while it loads
        SYNO.SDS.App_Mover.apiCall("listpackages", { volume: src }, (function(resp) {
            if (id !== this.req.move) { return; }      // the selection has changed since
            if (!resp || !resp.success) {
                this.el$.listMove.innerHTML = "";
                this.setMessage((resp && resp.message) || "Could not list the apps", true);
                return;
            }
            this.renderMoveList(resp.result || []);
            this.loadDatabaseInfo();
        }).createDelegate(this));
    },

    renderMoveList: function(items) {
        var html = "", i, p, note;
        if (!items.length) {
            this.el$.listMove.innerHTML = '<div class="am-empty">There are no apps on this volume.</div>';
            this.updateMoveButton();
            return;
        }
        html += '<div class="am-item am-all"><label><input type="checkbox" class="am-all-cb"> Select all</label></div>';
        for (i = 0; i < items.length; i++) {
            p = items[i];
            note = "";
            if (p.kind === "database") {
                note = "Synology's database. It is moved on its own.";
            } else if (p.kind === "usbcopy") {
                note = "Only shows how to move USB Copy's database.";
            } else if (p.version) {
                note = p.version;
            }
            html += '<div class="am-item' + (p.kind === "database" ? " am-database" : "") + '" data-kind="' + this.esc(p.kind) + '">' +
                '<label><input type="checkbox" class="am-cb" value="' + this.esc(p.id) + '" data-kind="' + this.esc(p.kind) + '" data-name="' + this.esc(p.name) + '"> ' +
                this.esc(p.name) + "</label>" +
                ' <span class="am-note">' + this.esc(note) + "</span>" +
                ' <span class="am-warn am-dbnote"></span></div>';
        }
        this.el$.listMove.innerHTML = html;
        this.wireList(this.el$.listMove, this.onMoveListChange);
        this.updateMoveButton();
    },

    // Tick boxes and "Select all" in a list
    wireList: function(listEl, handler) {
        var all = listEl.querySelector(".am-all-cb");
        if (all) {
            Ext.fly(all).on("change", function() {
                Ext.each(listEl.querySelectorAll("input.am-cb"), function(cb) {
                    if (cb.getAttribute("data-kind") === "database") {
                        // moved on its own, so never part of "all"
                        if (all.checked) { cb.checked = false; }
                    } else if (!cb.disabled && cb.getAttribute("data-kind") !== "usbcopy") {
                        cb.checked = all.checked;
                    }
                });
                handler.call(this, null);
            }, this);
        }
        Ext.each(listEl.querySelectorAll("input.am-cb"), function(cb) {
            Ext.fly(cb).on("change", function() { handler.call(this, cb); }, this);
        }, this);
    },

    onMoveListChange: function(changed) {
        // @database is moved on its own: ticking it clears the others,
        // ticking anything else clears it
        var self = this;
        if (changed && changed.checked) {
            Ext.each(this.el$.listMove.querySelectorAll("input.am-cb"), function(cb) {
                if (changed.getAttribute("data-kind") === "database") {
                    if (cb !== changed) { cb.checked = false; }
                } else if (cb.getAttribute("data-kind") === "database") {
                    cb.checked = false;
                }
            });
            var all = this.el$.listMove.querySelector(".am-all-cb");
            if (all && changed.getAttribute("data-kind") === "database") { all.checked = false; }
        }
        self.updateMoveButton();
    },

    loadDatabaseInfo: function() {
        // What moving @database to the chosen volume would do. Only asked
        // if @database is in the list.
        var cb = this.el$.listMove.querySelector('input.am-cb[data-kind="database"]');
        var dst = this.el$.dst.value, id = this.req.move, row;
        if (!cb) { return; }
        row = cb.parentNode.parentNode;
        if (!dst) {
            cb.disabled = true;
            row.querySelector(".am-dbnote").textContent = "There is no other volume to move it to.";
            return;
        }
        SYNO.SDS.App_Mover.apiCall("databaseinfo", { dest: dst }, (function(resp) {
            if (id !== this.req.move || dst !== this.el$.dst.value) { return; }
            var note = row.querySelector(".am-dbnote"), r, parts = [], i;
            if (!resp || !resp.success) {
                cb.disabled = true;
                cb.checked = false;
                note.textContent = (resp && resp.message) || "Could not check the database";
                this.updateMoveButton();
                return;
            }
            r = resp.result;
            this.dbinfo = r;
            if (!r.can_move) {
                cb.disabled = true;
                cb.checked = false;
                Ext.fly(row).addClass("am-disabled");
                note.textContent = r.reason;
            } else {
                cb.disabled = false;
                Ext.fly(row).removeClass("am-disabled");
                for (i = 0; i < r.will_rename.length; i++) {
                    parts.push(r.will_rename[i].name + " (" + this.formatKB(r.will_rename[i].size_kb) + ")");
                }
                note.textContent = parts.length ?
                    dst + " has an old copy of " + parts.join(" and ") + ", which is renamed, not deleted." : "";
            }
            this.updateMoveButton();
        }).createDelegate(this));
    },

    updateMoveButton: function() {
        this.el$.goMove.disabled = !(this.checked(this.el$.listMove).length > 0 && this.el$.dst.value);
    },

    // ---------------------------------------------------------------
    // Backup
    // ---------------------------------------------------------------
    // Ticks the boxes with these values (after a list was loaded again)
    reTick: function(listEl, values) {
        Ext.each(listEl.querySelectorAll("input.am-cb"), function(cb) {
            if (values.indexOf(cb.value) !== -1 && !cb.disabled) { cb.checked = true; }
        });
    },

    loadBackupPackages: function() {
        var id = ++this.req.backup, keep = this.checked(this.el$.listBackup);
        this.el$.listBackup.innerHTML = '<div class="am-empty">Loading\u2026</div>';
        this.updateBackupButton();     // nothing is ticked while it loads
        SYNO.SDS.App_Mover.apiCall("listbackuppackages", {}, (function(resp) {
            if (id !== this.req.backup) { return; }
            var items, html, i, p;
            if (!resp || !resp.success) {
                this.el$.listBackup.innerHTML = "";
                this.setMessage((resp && resp.message) || "Could not list the apps", true);
                return;
            }
            items = this.backupItems = resp.result || [];
            if (!items.length) {
                this.el$.listBackup.innerHTML = '<div class="am-empty">No apps were found.</div>';
                this.updateBackupButton();
                return;
            }
            html = '<div class="am-item am-all"><label><input type="checkbox" class="am-all-cb"> Select all</label></div>';
            for (i = 0; i < items.length; i++) {
                p = items[i];
                html += '<div class="am-item"><label><input type="checkbox" class="am-cb" value="' + this.esc(p.id) +
                    '" data-name="' + this.esc(p.name) + '"> ' + this.esc(p.name) + "</label>" +
                    ' <span class="am-note">' + this.esc(p.version) + " on " + this.esc(p.volume) + "</span></div>";
            }
            this.el$.listBackup.innerHTML = html;
            this.reTick(this.el$.listBackup, keep);
            this.wireList(this.el$.listBackup, this.updateBackupButton);
            this.updateBackupButton();
        }).createDelegate(this));
    },

    updateBackupButton: function() {
        var path = this.settings.backuppath, exists = this.settings.backuppath_exists;
        var ok = !!(path && exists), lines = [], notes = this.el$.notesBackup;
        if (!path) {
            lines.push("Set the backup location in Settings first.");
        } else if (!exists) {
            lines.push("The backup location " + path + " was not found. Change it in Settings.");
        } else {
            lines.push("Backups are saved in " + path + "/syno_app_mover");
            lines.push(this.scheduleSummary());
        }
        notes.textContent = lines.join("\n");
        if (path && !exists) { Ext.fly(notes).addClass("am-bad"); } else { Ext.fly(notes).removeClass("am-bad"); }
        this.el$.goBackup.disabled = !(ok && this.checked(this.el$.listBackup).length > 0);
        this.el$.goSchedule.disabled = !ok;
    },

    // ---------------------------------------------------------------
    // Scheduled backup
    // ---------------------------------------------------------------
    loadSchedule: function(callback) {
        SYNO.SDS.App_Mover.apiCall("getschedule", {}, (function(resp) {
            if (resp && resp.success) {
                this.schedule = resp.result;
                this.updateBackupButton();
            }
            if (callback) { callback.call(this, resp); }
        }).createDelegate(this));
    },

    describeFrequency: function(type, interval) {
        if (type === "hour") { return interval === 1 ? "every hour" : "every " + interval + " hours"; }
        if (type === "week") { return "every week, on Mondays at 00:00"; }
        if (type === "month") { return "every month, on the first Monday at 00:00"; }
        return type;
    },

    // App names for ids (the Backup list has them)
    appNames: function(ids) {
        var out = [], i, j, name;
        for (i = 0; i < ids.length; i++) {
            name = ids[i];
            for (j = 0; j < this.backupItems.length; j++) {
                if (this.backupItems[j].id === ids[i]) { name = this.backupItems[j].name; }
            }
            out.push(name);
        }
        return out;
    },

    scheduleSummary: function() {
        var s = this.schedule, text;
        if (!s || !s.type) { return "No backup is scheduled."; }
        text = "Scheduled: " + this.describeFrequency(s.type, s.interval) + ": " + this.appNames(s.apps).join(", ") + ".";
        if (!s.task_exists) {
            text += "\nThe scheduled task is missing from Task Scheduler. Open Schedule and save it again.";
        }
        return text;
    },

    openSchedule: function() {
        var ids = this.checked(this.el$.listBackup), names = this.names(this.el$.listBackup), s = this.schedule || {};
        this.scheduleApps = ids;
        this.el$.schApps.textContent = ids.length ? names.join(", ") : "None. Tick the apps to back up in the list first.";
        this.fillScheduleTypes(!!this.schedule.monthly);
        this.el$.schType.value = s.type || "week";
        if (this.el$.schType.selectedIndex < 0) { this.el$.schType.value = "week"; }
        this.el$.schInterval.value = (s.type === "hour" && s.interval) ? String(s.interval) : "6";
        this.el$.schCurrent.textContent = s.type ?
            "Scheduled now: " + this.describeFrequency(s.type, s.interval) + ": " + this.appNames(s.apps).join(", ") + "." +
            (s.task_exists ? "" : " (The task is missing from Task Scheduler. Saving makes it again.)") :
            "Nothing is scheduled yet.";
        this.el$.schStatus.textContent = "";
        this.el$.schSave.disabled = !ids.length;
        this.el$.schRemove.style.display = s.type ? "" : "none";
        this.onScheduleTypeChange();
        Ext.fly(this.el$.scheduleBackdrop).addClass("open");
    },

    // Monthly only if this DSM build can do it (getschedule says), like Syno Toolbox
    fillScheduleTypes: function(monthly) {
        var html = '<option value="week">Every week</option>';
        if (monthly) { html += '<option value="month">Every month</option>'; }
        html += '<option value="hour">Every few hours</option>';
        this.el$.schType.innerHTML = html;
    },

    closeSchedule: function() {
        Ext.fly(this.el$.scheduleBackdrop).removeClass("open");
    },

    onScheduleTypeChange: function() {
        var type = this.el$.schType.value, hint;
        this.el$.schInterval.style.display = (type === "hour") ? "" : "none";
        if (type === "week") {
            hint = "Backs up every Monday at 00:00.";
        } else if (type === "month") {
            hint = "Backs up on the first Monday of each month at 00:00.";
        } else {
            hint = "Backs up every few hours, starting at the next hour.";
        }
        this.el$.schHint.textContent = hint;
    },

    onSaveSchedule: function() {
        var type = this.el$.schType.value;
        if (!this.scheduleApps || !this.scheduleApps.length) { return; }
        this.el$.schStatus.textContent = "Saving\u2026";
        SYNO.SDS.App_Mover.apiCall("setschedule", {
            type: type,
            interval: type === "hour" ? this.el$.schInterval.value : "0",
            apps: this.scheduleApps.join(",")
        }, "POST", (function(resp) {
            if (resp && resp.success) {
                this.el$.schStatus.textContent = "";
                this.closeSchedule();
                this.loadSchedule();
            } else {
                this.el$.schStatus.textContent = (resp && resp.message) || "Failed to save the schedule";
            }
        }).createDelegate(this));
    },

    onRemoveSchedule: function() {
        this.el$.schStatus.textContent = "Removing\u2026";
        SYNO.SDS.App_Mover.apiCall("removeschedule", {}, "POST", (function(resp) {
            if (resp && resp.success) {
                this.el$.schStatus.textContent = "";
                this.closeSchedule();
                this.loadSchedule();
            } else {
                this.el$.schStatus.textContent = (resp && resp.message) || "Failed to remove the schedule";
            }
        }).createDelegate(this));
    },

    // ---------------------------------------------------------------
    // Restore
    // ---------------------------------------------------------------
    loadBackups: function() {
        var id = ++this.req.restore, keep = this.checked(this.el$.listRestore);
        this.el$.listRestore.innerHTML = '<div class="am-empty">Loading\u2026</div>';
        this.updateRestoreButton();    // nothing is ticked while it loads
        SYNO.SDS.App_Mover.apiCall("listbackups", {}, (function(resp) {
            if (id !== this.req.restore) { return; }
            var items, html, i, b, note;
            if (!resp || !resp.success) {
                this.el$.listRestore.innerHTML = "";
                this.setMessage((resp && resp.message) || "Could not list the backups", true);
                this.backups = [];
                this.updateRestoreButton();
                return;
            }
            items = this.backups = resp.result || [];
            if (!items.length) {
                this.el$.listRestore.innerHTML = '<div class="am-empty">There are no backups yet.</div>';
                this.updateRestoreButton();
                return;
            }
            html = '<div class="am-item am-all"><label><input type="checkbox" class="am-all-cb"> Select all</label></div>';
            for (i = 0; i < items.length; i++) {
                b = items[i];
                note = "";
                if (b.last_backup) {
                    note = "backed up " + new Date(b.last_backup * 1000).toLocaleString() + ". ";
                }
                html += '<div class="am-item' + (b.installed ? "" : " am-disabled") + '"><label><input type="checkbox" class="am-cb" value="' +
                    this.esc(b.id) + '" data-name="' + this.esc(b.name) + '"' + (b.installed ? "" : " disabled") + "> " + this.esc(b.name) + "</label>" +
                    ' <span class="am-note">' + this.esc(note) + (b.backup_version ? "backup " + this.esc(b.backup_version) : "") + "</span>";
                if (!b.installed) {
                    html += ' <span class="am-warn">Not installed. Install it first.</span>';
                } else if (!b.version_match) {
                    html += ' <span class="am-warn">Installed version is ' + this.esc(b.installed_version) + ".</span>";
                }
                html += "</div>";
            }
            this.el$.listRestore.innerHTML = html;
            this.reTick(this.el$.listRestore, keep);
            this.wireList(this.el$.listRestore, this.updateRestoreButton);
            this.updateRestoreButton();
        }).createDelegate(this));
    },

    updateRestoreButton: function() {
        this.el$.notesRestore.textContent = "Apps are restored to the volume they are installed on.";
        this.el$.goRestore.disabled = !(this.checked(this.el$.listRestore).length > 0);
    },

    // ---------------------------------------------------------------
    // Confirm, then start
    // ---------------------------------------------------------------
    names: function(listEl) {
        var out = [];
        Ext.each(listEl.querySelectorAll("input.am-cb"), function(cb) {
            if (cb.checked && !cb.disabled) { out.push(cb.getAttribute("data-name")); }
        });
        return out;
    },

    confirmStart: function(mode) {
        var listEl, ids, names, body, title, dst, extra = [], i, b, mism = [];
        if (this.job) { return; }
        listEl = mode === "move" ? this.el$.listMove : (mode === "backup" ? this.el$.listBackup : this.el$.listRestore);
        ids = this.checked(listEl);
        names = this.names(listEl);
        if (!ids.length) { return; }
        dst = this.el$.dst.value;

        if (mode === "move") {
            title = "Move " + (ids[0] === "@database" ? "@database" : this.plural(ids.length, "app", "apps")) +
                " from " + this.el$.src.value + " to " + dst + "?";
            extra.push("Each app is stopped while it is moved, and started again afterwards.");
            if (ids[0] === "@database") {
                extra = ["DSM services that use the database are stopped while it is copied."];
            }
        } else if (mode === "backup") {
            title = "Back up " + this.plural(ids.length, "app", "apps") + "?";
            extra.push("Apps are stopped while they are backed up, and started again afterwards.");
        } else {
            title = "Restore " + this.plural(ids.length, "app", "apps") + "?";
            extra.push("Each app is stopped, its data replaced with the backup, and then started again.");
            for (i = 0; i < (this.backups || []).length; i++) {
                b = this.backups[i];
                if (ids.indexOf(b.id) !== -1 && b.installed && !b.version_match) {
                    mism.push(b.name + " (backup " + b.backup_version + ", installed " + b.installed_version + ")");
                }
            }
            if (mism.length) {
                extra.push("These backups are from a different version of the app than the one installed: " +
                    mism.join(", ") + ". Restoring a different version can cause problems.");
            }
        }
        body = "<div>" + this.esc(names.join(", ")) + "</div>";
        for (i = 0; i < extra.length; i++) {
            body += '<div style="margin-top:10px;color:' + (extra[i].indexOf("different version") !== -1 ? "#b36b00" : "#555") + ';">' + this.esc(extra[i]) + "</div>";
        }
        this.pending = { mode: mode, ids: ids, dst: dst };
        this.el$.confirmTitle.textContent = title;
        this.el$.confirmBody.innerHTML = body;
        Ext.fly(this.el$.confirmBackdrop).addClass("open");
    },

    closeConfirm: function() {
        Ext.fly(this.el$.confirmBackdrop).removeClass("open");
        this.pending = null;
    },

    onConfirmOk: function() {
        var p = this.pending, params;
        Ext.fly(this.el$.confirmBackdrop).removeClass("open");
        this.pending = null;
        if (!p) { return; }
        params = { mode: p.mode, apps: p.ids.join(",") };
        if (p.mode === "move") { params.dest = p.dst; }
        this.setMessage("Starting\u2026", false);
        SYNO.SDS.App_Mover.apiCall("startjob", params, "POST", (function(resp) {
            if (!resp || !resp.success) {
                this.setMessage((resp && resp.message) || "Failed to start", true);
                return;
            }
            this.setMessage("", false);
            this.beginProgress(resp.result.job_id,
                (p.mode === "move" ? "Moving " : (p.mode === "backup" ? "Backing up " : "Restoring ")) +
                this.plural(p.ids.length, "app", "apps"));
        }).createDelegate(this));
    },

    // ---------------------------------------------------------------
    // A job is running: show its output until it finishes
    // ---------------------------------------------------------------
    beginProgress: function(jobId, title) {
        this.job = { id: jobId, offset: 0, failures: 0, text: "" };
        this.polling = true;
        Ext.each(this.modeButtons, function(btn) { btn.disabled = true; });
        this.settingsButton.disabled = true;
        Ext.each(["move", "backup", "restore"], function(m) { Ext.fly(this.panels[m]).removeClass("active"); }, this);
        this.el$.progressTitle.textContent = title;
        this.el$.log.textContent = "";
        Ext.fly(this.el$.spinner).removeClass("am-done");
        Ext.fly(this.el$.progress).addClass("active");
        this.poll();
    },

    poll: function() {
        if (!this.polling || !this.job) { return; }
        SYNO.SDS.App_Mover.apiCall("jobstatus", { job: this.job.id + ":" + this.job.offset }, (function(resp) {
            var r, atBottom, log = this.el$.log, delay;
            if (!this.polling || !this.job) { return; }      // the window was closed meanwhile
            if (!resp || !resp.success) {
                this.job.failures++;
                if (this.job.failures > 5) {
                    this.polling = false;
                    Ext.fly(this.el$.spinner).addClass("am-done");
                    this.el$.progressTitle.textContent = "Lost contact with the NAS";
                    this.setMessage((resp && resp.message) || "Request to api.cgi failed", true);
                    this.showResults("Lost contact with the NAS",
                        "The job carries on without this window. Close and reopen App Mover to follow it.\n\n" +
                        ((resp && resp.message) || ""), true);
                    return;
                }
                window.setTimeout(this.poll.createDelegate(this), this.pollMs);
                return;
            }
            this.job.failures = 0;
            r = resp.result;
            atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
            if (r.lines && r.lines.length) {
                this.job.text += r.lines.join("\n") + "\n";
            }
            this.job.offset = r.offset;
            log.textContent = this.job.text + (r.partial || "");
            if (atBottom) { log.scrollTop = log.scrollHeight; }
            if (r.running || r.more) {
                delay = r.more ? 0 : this.pollMs;
                window.setTimeout(this.poll.createDelegate(this), delay);
            } else {
                this.jobFinished(r.rc);
            }
        }).createDelegate(this));
    },

    jobFinished: function(rc) {
        this.polling = false;
        Ext.fly(this.el$.spinner).addClass("am-done");
        SYNO.SDS.App_Mover.apiCall("jobresults", {}, (function(resp) {
            var title, text, ok = (rc === 0);
            if (rc === -1) {
                title = "The job stopped unexpectedly";
            } else if (rc === 0) {
                title = "Finished";
            } else {
                title = "Failed (exit code " + rc + ")";
            }
            if (resp && resp.success) {
                text = resp.result.text || "(nothing more to show)";
                if (!resp.result.has_results && rc !== 0) {
                    text = "The job stopped before it finished. The end of its output:\n\n" + text;
                }
            } else {
                text = (resp && resp.message) || "Could not get the results";
            }
            this.el$.progressTitle.textContent = title;
            this.showResults(title, text, ok);
        }).createDelegate(this));
    },

    showResults: function(title, text, ok) {
        this.el$.resultsTitle.textContent = title;
        this.el$.resultsText.textContent = text;
        this.el$.resultsText.scrollTop = 0;
        Ext.fly(this.el$.resultsBackdrop).addClass("open");
    },

    closeResults: function() {
        Ext.fly(this.el$.resultsBackdrop).removeClass("open");
        this.job = null;
        this.polling = false;
        // The output stays on screen so it can still be read (and scrolled).
        // The window goes back to normal, and the lists are loaded again,
        // when the user clicks Move, Backup, Restore, or Settings and then
        // closes or saves it.
        this.viewingResults = true;
        Ext.each(this.modeButtons, function(btn) { btn.disabled = false; });
        this.settingsButton.disabled = false;
    },

    // ---------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------
    loadSettings: function(callback) {
        SYNO.SDS.App_Mover.apiCall("getsettings", {}, (function(resp) {
            if (resp && resp.success) {
                this.settings = resp.result;
                this.updateBackupButton();
            }
            if (callback) { callback.call(this, resp); }
        }).createDelegate(this));
    },

    openSettings: function() {
        if (this.job) { return; }
        this.el$.settingsStatus.textContent = "";
        this.loadSettings(function(resp) {
            if (resp && resp.success) {
                this.el$.setPath.value = this.settings.backuppath || "";
                this.el$.setBuffer.value = this.settings.buffer;
                this.el$.setSkip.value = this.settings.skip_minutes;
            } else {
                this.el$.settingsStatus.textContent = (resp && resp.message) || "Could not load the settings";
            }
            Ext.fly(this.el$.settingsBackdrop).addClass("open");
        });
    },

    hideSettings: function() {
        Ext.fly(this.el$.settingsBackdrop).removeClass("open");
    },

    closeSettings: function() {
        this.hideSettings();
        if (this.viewingResults) { this.showMode(this.mode); }
    },

    onSaveSettings: function() {
        this.el$.settingsStatus.textContent = "Saving\u2026";
        SYNO.SDS.App_Mover.apiCall("setsettings", {
            backuppath: this.el$.setPath.value,
            buffer: this.el$.setBuffer.value,
            skip_minutes: this.el$.setSkip.value
        }, "POST", (function(resp) {
            if (resp && resp.success) {
                this.el$.settingsStatus.textContent = "";
                this.hideSettings();
                // What the window showed (a "not found" for the old location, the
                // backups list) came from the old settings: clear it and load it again
                this.loadSettings(function() {
                    this.setMessage("", false);
                    this.showMode(this.mode);
                });
            } else {
                this.el$.settingsStatus.textContent = (resp && resp.message) || "Failed to save the settings";
            }
        }).createDelegate(this));
    },

    // ---------------------------------------------------------------
    // Folder picker (for the backup location)
    // ---------------------------------------------------------------
    openPicker: function() {
        var cur = (this.el$.setPath.value || "").replace(/\/+$/, "");
        this.pickerPath = "";
        Ext.fly(this.el$.pickerBackdrop).addClass("open");
        // Start in the folder in the box, if it looks like one
        this.loadFolders(/^\/volume[0-9]+\/./.test(cur) ? cur : "", true);
    },

    closePicker: function() {
        Ext.fly(this.el$.pickerBackdrop).removeClass("open");
    },

    parentPath: function(p) {
        var i = p.lastIndexOf("/");
        return i <= 0 ? "" : p.substring(0, i);
    },

    loadFolders: function(path, fallBackToVolumes) {
        var id = ++this.req.picker;
        this.el$.pickerStatus.textContent = "Loading\u2026";
        SYNO.SDS.App_Mover.apiCall("listfolders", { path: path }, (function(resp) {
            if (id !== this.req.picker) { return; }
            if (!resp || !resp.success) {
                if (fallBackToVolumes && path) {
                    this.loadFolders("", false);      // the folder in the box isn't there (any more)
                    return;
                }
                this.el$.pickerStatus.textContent = (resp && resp.message) || "Could not list the folders";
                return;
            }
            this.pickerPath = path;
            this.renderFolders(resp.result || []);
        }).createDelegate(this));
    },

    renderFolders: function(items) {
        var path = this.pickerPath, html = "", i;
        this.el$.pickerStatus.textContent = "";
        this.el$.pickerPath.textContent = path || "Volumes";
        if (path) {
            html += '<div class="am-pk-row am-pk-up" data-path="' + this.esc(this.parentPath(path)) + '">\u2191 ..</div>';
        }
        for (i = 0; i < items.length; i++) {
            html += '<div class="am-pk-row" data-path="' + this.esc(items[i].path) + '">\u25b8 ' + this.esc(items[i].name) + "</div>";
        }
        if (!items.length) {
            html += '<div class="am-empty">There are no folders here.</div>';
        }
        this.el$.pickerList.innerHTML = html;
        Ext.each(this.el$.pickerList.querySelectorAll(".am-pk-row"), function(row) {
            Ext.fly(row).on("click", function() { this.loadFolders(row.getAttribute("data-path"), false); }, this);
        }, this);
        // The backup location has to be a folder in a volume, not a volume
        this.el$.pickerSelect.disabled = !/^\/volume[0-9]+\/./.test(path);
    },

    onPickerSelect: function() {
        this.el$.setPath.value = this.pickerPath;
        this.closePicker();
    },

    onClose: function() {
        // The job (if any) carries on without the window
        this.polling = false;
        SYNO.SDS.App_Mover.MainWindow.superclass.onClose.apply(this, arguments);
        this.doClose();
        return true;
    }
});
