#!/bin/bash
#----------------------------------------------------------
# App_Mover package - root-run script. DSM 7: called by appmover-helper
# (setuid root). DSM 6: called directly by api.cgi.
#
# Every verb prints just its JSON payload for api.cgi's json_response to
# put in "result". On failure it prints a plain text message and exits 1.
#
# Usage:
#   app_mover_api.sh startjob <move|backup|restore> <dest volume|-> <apps>
#       <apps> is a comma separated list of app system names, or "all"
#       (backup and restore), or "@database" (move, on its own)
#   app_mover_api.sh jobstatus <job id>:<offset>      (job id 0 = current job)
#   app_mover_api.sh jobresults
#   app_mover_api.sh getsettings
#   app_mover_api.sh getschedule
#   app_mover_api.sh setschedule <hour|week|month> <hours 1-11, or 0> <apps>
#   app_mover_api.sh listfolders <folder, or nothing for the volumes>
#   app_mover_api.sh listbackups
#   app_mover_api.sh databaseinfo <volume>
#   app_mover_api.sh setsettings <backuppath> <buffer GB> <skip minutes>
#   app_mover_api.sh selfheal
#   app_mover_api.sh removeschedule
#
# A scheduled backup is Task Scheduler running
#   app_mover_api.sh scheduledbackup
# (not a verb the helper accepts) which backs up the apps chosen when the
# schedule was saved. It is a job like any other, so the window shows it.
#
# A job is syno_app_mover.sh run detached, as root, with its output written
# to a log. The UI polls jobstatus for new lines until the job has finished,
# then asks for jobresults. The job carries on if the browser is closed.
#----------------------------------------------------------

PKG_NAME="App_Mover"
PKG_ROOT="/var/packages/${PKG_NAME}"
BIN_DIR="${PKG_ROOT}/target/bin"
# This script's own path. Not $0: appmover-helper runs it from an open file
# descriptor, so $0 is /dev/fd/N there.
SELF="${BIN_DIR}/app_mover_api.sh"

# Same PATH appmover-helper sets (DSM 6 calls this script directly)
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/syno/bin:/usr/syno/sbin"

# Get DSM major version
dsm=$(/usr/syno/bin/synogetkeyvalue /etc.defaults/VERSION majorversion)
if ! [[ "$dsm" =~ ^[0-9]+$ ]]; then
    echo "Unable to determine DSM version"
    exit 1
fi
if [[ $dsm -ge 7 ]]; then
    VAR_DIR="${PKG_ROOT}/var"
else
    VAR_DIR="${PKG_ROOT}/etc"
fi

MOVER="${BIN_DIR}/syno_app_mover.sh"
LIST_SCRIPT="${BIN_DIR}/syno_app_mover_list.sh"
TASK_SETUP="${BIN_DIR}/task_setup.sh"
API_LOG_FILE="${VAR_DIR}/api.log"
TASK_NAME="App Mover Backup"

# Everything root writes lives in STATE_DIR. VAR_DIR belongs to the package
# user, who could swap a file in it for a symlink and have root write
# through it, so root only writes inside a folder that root owns (and
# checks that on every run - see ensure_state_dir). The package user can
# still read it, which the list helper needs for the conf file.
STATE_DIR="${VAR_DIR}/state"
CONF_FILE="${STATE_DIR}/syno_app_mover.conf"
LOG_DIR="${STATE_DIR}/logs"
JOB_ID_FILE="${STATE_DIR}/job.id"
JOB_PID_FILE="${STATE_DIR}/job.pid"
JOB_RC_FILE="${STATE_DIR}/job.rc"
JOB_LOG="${STATE_DIR}/job.log"
START_LOCK="${STATE_DIR}/startjob.lock"

# syno_app_mover.sh prints this on a line of its own just before the part
# of its output that the results window shows (when it is run with
# APP_MOVER_RESULTS_MARKER=yes)
RESULTS_MARKER="@@APP_MOVER_RESULTS@@"

MAX_APPS_LEN=4000
# Monthly schedules need this DSM build or later (the same number and the
# same buildnumber key task_setup.sh uses; an unreadable build counts as old)
MONTHLY_MIN_BUILD=64570
POLL_MAX_BYTES=65536
LOG_KEEP_DAYS=30

fail(){ 
    printf '%s\n' "$1"
    exit 1
}

api_log(){ 
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] App_Mover: $1" >> "$API_LOG_FILE" 2>/dev/null
}

#------------------------------------------------------------------------------
# State folder

state_dir_ok(){
    # A real folder (not a symlink), owned by root, that neither its group
    # nor anyone else can write to
    [[ -d $STATE_DIR && ! -L $STATE_DIR ]] || return 1
    [[ "$(stat -c '%u' "$STATE_DIR")" == "0" ]] || return 1
    (( (8#$(stat -c '%a' "$STATE_DIR") & 8#022) == 0 ))
}

ensure_state_dir(){
    # Must be a real folder owned by root that only root can write to. If it
    # isn't (the package user renamed it and made its own, or swapped it for
    # a symlink, or it was re-owned or made group writable) move it out of
    # the way and start again.
    if [[ -e $STATE_DIR || -L $STATE_DIR ]] && ! state_dir_ok; then
        api_log "state folder was not a root owned folder that only root can write to - moved to ${STATE_DIR}.bad.$$"
        mv -T "$STATE_DIR" "${STATE_DIR}.bad.$$" 2>/dev/null || rm -f "$STATE_DIR"
    fi
    if [[ ! -e $STATE_DIR && ! -L $STATE_DIR ]]; then
        mkdir -m 755 "$STATE_DIR" || fail "Failed to create $STATE_DIR"
    fi
    # If moving it aside failed (the package user owns var/, so it could fill
    # it with folders named like the .bad ones) don't carry on and write
    # into a folder that isn't trusted.
    state_dir_ok || fail "The state folder is not safe to use"
    if [[ ! -d $LOG_DIR ]]; then
        mkdir -m 755 "$LOG_DIR" || fail "Failed to create $LOG_DIR"
    fi
}

ensure_conf(){ 
    # Same keys as syno_app_mover.conf in the script's own download
    if [[ ! -f $CONF_FILE ]]; then
        : > "$CONF_FILE"
        /usr/syno/bin/synosetkeyvalue "$CONF_FILE" buffer 50
        /usr/syno/bin/synosetkeyvalue "$CONF_FILE" backuppath ""
        /usr/syno/bin/synosetkeyvalue "$CONF_FILE" skip_minutes 360
    fi
    # Read by the list helper, which runs as the package user. No secrets in it.
    # root:<package name>, because DSM 7 doesn't accept root:root for package files.
    chown "root:${PKG_NAME}" "$CONF_FILE" 2>/dev/null
    chmod 644 "$CONF_FILE" 2>/dev/null
}

#------------------------------------------------------------------------------
# Self-heal file ownership (same reasoning as CPUTemp's cpu_temp_api.sh).
#
# postinst runs as the package user, so everything under bin/ starts out
# owned by it and could be rewritten in place even though bin/ is 555.
# This script only ever runs as root, so on every call it takes ownership
# of anything under bin/ that isn't root:<package name> and locks it.
# (root:<package name> and not root:root, because DSM 7 doesn't accept
# root:root for package files.)
#
# LIMITATION (accepted, as in cpu_temp_api.sh): this cannot protect this
# script itself if it was replaced before it first ran.
self_heal(){ 
    local f owner
    for f in "$BIN_DIR"/*.sh "$BIN_DIR"/*.py "$SELF"; do
        [[ -f "$f" ]] || continue
        owner="$(stat -c '%U:%G' "$f" 2>/dev/null)"
        if [[ "$owner" != "root:${PKG_NAME}" ]]; then
            chown "root:${PKG_NAME}" "$f" 2>/dev/null
            chmod 555 "$f" 2>/dev/null
            api_log "self-heal secured $f (was owned by $owner)"
        fi
    done

    # api.log must stay owned by the package user (api.cgi writes to it).
    # If root's own write above created it, only root can fix that.
    if [[ -f "$API_LOG_FILE" ]]; then
        chown "${PKG_NAME}:${PKG_NAME}" "$API_LOG_FILE" 2>/dev/null
        chmod 644 "$API_LOG_FILE" 2>/dev/null
    fi
}

#------------------------------------------------------------------------------
# Validation. api.cgi passes request parameters straight through, so this is
# where they are checked (appmover-helper only checks how many there are).

valid_volume(){ 
    # /volume1 to /volume99, and mounted (same test syno_app_mover.sh uses)
    [[ $1 =~ ^/volume[1-9][0-9]?$ ]] || return 1
    [[ -d $1 ]] || return 1
    df -h 2>/dev/null | grep -q -E "[[:space:]]${1}\$"
}

get_backuppath(){ 
    /usr/syno/bin/synogetkeyvalue "$CONF_FILE" backuppath
}

validate_job(){ 
    # $1 mode, $2 dest, $3 apps. On a problem: message on stdout, return 1
    local mode="$1" dest="$2" apps="$3" app list backuppath
    local -a list

    case "$mode" in
        move|backup|restore) ;;
        *) echo "Invalid mode '$mode'"; return 1 ;;
    esac

    if [[ $mode == "move" ]]; then
        valid_volume "$dest" || { echo "Invalid destination volume '$dest'"; return 1; }
    elif [[ $dest != "-" ]]; then
        echo "A destination volume is only for move"; return 1
    fi

    [[ -n $apps ]] || { echo "No apps selected"; return 1; }
    if [[ ${#apps} -gt $MAX_APPS_LEN ]]; then
        echo "Too many apps selected"; return 1
    fi

    if [[ $apps == "all" ]]; then
        if [[ $mode == "move" ]]; then
            echo "Select the apps to move"; return 1
        fi
    else
        IFS=',' read -r -a list <<< "$apps"
        for app in "${list[@]}"; do
            if [[ $app == "@database" ]]; then
                [[ $mode == "move" ]] || { echo "@database can only be moved"; return 1; }
                [[ ${#list[@]} -eq 1 ]] || { echo "@database must be moved on its own"; return 1; }
                continue
            fi
            [[ $app =~ ^[A-Za-z0-9._+-]+$ ]] || { echo "Invalid app name '$app'"; return 1; }
            if [[ $app == "ContainerManager" ]] || [[ $app == "Docker" ]]; then
                echo "Docker and Container Manager are not supported"; return 1
            fi
            if [[ $app == "$PKG_NAME" ]]; then
                echo "App Mover can't move, back up or restore itself"; return 1
            fi
            if [[ $mode == "restore" ]]; then
                backuppath="$(get_backuppath)"
                [[ -d "${backuppath}/syno_app_mover/${app}" ]] || { echo "No backup of '$app'"; return 1; }
                [[ -L "/var/packages/${app}/target" ]] || { echo "'$app' is not installed. Install it before restoring."; return 1; }
            else
                [[ -f "/var/packages/${app}/INFO" ]] || { echo "'$app' is not installed"; return 1; }
            fi
        done
    fi

    if [[ $mode == "backup" ]] || [[ $mode == "restore" ]]; then
        backuppath="$(get_backuppath)"
        [[ -n $backuppath ]] || { echo "Set the backup location in Settings first"; return 1; }
        [[ -d $backuppath ]] || { echo "Backup location $backuppath not found"; return 1; }
    fi
    return 0
}

build_args(){ 
    # Sets MOVER_ARGS for syno_app_mover.sh. $1 mode, $2 dest, $3 apps
    MOVER_ARGS=()
    case "$1" in
        move)    MOVER_ARGS+=("--move=$3" "--dest=$2") ;;
        backup)  MOVER_ARGS+=("--auto=$3") ;;
        restore) MOVER_ARGS+=("--restore=$3") ;;
    esac
    MOVER_ARGS+=(--no-docker --no-update "--conf=${CONF_FILE}" "--logdir=${LOG_DIR}")
}

#------------------------------------------------------------------------------
# Jobs

job_running(){ 
    local pid
    [[ -f $JOB_PID_FILE ]] || return 1
    [[ -f $JOB_RC_FILE ]] && return 1
    pid="$(cat "$JOB_PID_FILE" 2>/dev/null)"
    [[ $pid =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    # Make sure the pid is still our job and not something that reused it
    tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null | grep -q -E '_runjob|scheduledbackup'
}

take_start_lock(){ 
    # Only one start at a time. Ignores a lock left behind by a crash.
    mkdir "$START_LOCK" 2>/dev/null && return 0
    if [[ -n "$(find "$START_LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ]]; then
        rmdir "$START_LOCK" 2>/dev/null
        mkdir "$START_LOCK" 2>/dev/null && return 0
    fi
    return 1
}

new_job(){ 
    # Starts the files of a new job and sets JOB_NEW_ID. The caller holds the
    # start lock and has checked that no job is running.
    find "$LOG_DIR" -maxdepth 1 -name 'syno_app_mover_*.log' -mtime +"$LOG_KEEP_DAYS" -delete 2>/dev/null
    JOB_NEW_ID="$(date +%s)$(printf '%04d' $((RANDOM % 10000)))"
    rm -f "$JOB_PID_FILE" "$JOB_RC_FILE" "$JOB_ID_FILE"
    : > "$JOB_LOG"
    echo "$JOB_NEW_ID" > "$JOB_ID_FILE"
}

job_id(){ 
    local id
    id="$(cat "$JOB_ID_FILE" 2>/dev/null)"
    [[ $id =~ ^[0-9]+$ ]] && echo "$id" || echo "0"
}

do_startjob(){ 
    local mode="$1" dest="$2" apps="$3" msg id

    msg="$(validate_job "$mode" "$dest" "$apps")" || fail "$msg"

    # Only one start at a time, and only one job at a time
    take_start_lock || fail "Another job is starting"
    trap 'rmdir "$START_LOCK" 2>/dev/null' EXIT

    if job_running; then
        fail "A job is already running"
    fi

    new_job
    id="$JOB_NEW_ID"
    api_log "job $id: $mode ${dest} ${apps}"

    # Detached: carries on if the browser is closed
    APP_MOVER_INTERNAL=1 setsid bash "$SELF" _runjob "$mode" "$dest" "$apps" >> "$JOB_LOG" 2>&1 < /dev/null &

    # Wait for the job to say it has started
    for _ in {1..30}; do
        [[ -f $JOB_PID_FILE ]] && break
        sleep 0.1
    done
    [[ -f $JOB_PID_FILE ]] || fail "The job did not start"

    echo "{\"job_id\":${id}}"
}

do_runjob(){ 
    # Internal. The detached part of a job. $1 mode, $2 dest, $3 apps
    local rc
    [[ $APP_MOVER_INTERNAL == "1" ]] || fail "Not a verb"
    validate_job "$1" "$2" "$3" > /dev/null || exit 1
    echo "$$" > "$JOB_PID_FILE"
    build_args "$1" "$2" "$3"
    APP_MOVER_RESULTS_MARKER=yes "$MOVER" "${MOVER_ARGS[@]}"
    rc=$?
    echo "$rc" > "${JOB_RC_FILE}.tmp" && mv -f "${JOB_RC_FILE}.tmp" "$JOB_RC_FILE"
    exit 0
}

# Python reads the log: lines need cleaning (the script's progress bar
# redraws one line with \r, and has colours and a bell) and JSON needs
# escaping. Same use of python3 as cpu_temp_api.sh.
clean_log_py='
import json, os, re, sys

CLEAN_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

def clean(raw):
    s = raw.decode("utf-8", "replace")
    # A progress bar redraws its line with \r: keep the last thing it drew
    parts = [p for p in s.split("\r") if p.strip()]
    s = parts[-1] if parts else ""
    s = CLEAN_ANSI.sub("", s).replace("\x07", "")
    return s.rstrip()
'

do_jobstatus(){ 
    # $1 is <job id>:<offset>
    local want_id offset id running="false" rc="null" finished="0"
    [[ $1 =~ ^([0-9]+):([0-9]+)$ ]] || fail "Invalid job status request"
    want_id="${BASH_REMATCH[1]}"
    offset="${BASH_REMATCH[2]}"

    id="$(job_id)"
    if [[ $id == "0" ]] || [[ ! -f $JOB_LOG ]]; then
        echo '{"job_id":0,"running":false,"rc":null,"offset":0,"more":false,"lines":[],"partial":""}'
        return 0
    fi
    if [[ $want_id != "0" ]] && [[ $want_id != "$id" ]]; then
        fail "That job has been replaced by a newer one"
    fi

    if job_running; then
        running="true"
    else
        finished="1"
        if [[ -f $JOB_RC_FILE ]]; then
            rc="$(cat "$JOB_RC_FILE")"
            [[ $rc =~ ^[0-9]+$ ]] || rc="-1"
        else
            rc="-1"     # stopped without saying so
        fi
    fi

    python3 -c "${clean_log_py}
log, job_id, offset, finished, running, rc, max_bytes, marker = sys.argv[1:9]
offset = int(offset); max_bytes = int(max_bytes); finished = finished == \"1\"
size = os.path.getsize(log)
offset = min(offset, size)
with open(log, \"rb\") as f:
    f.seek(offset)
    data = f.read(max_bytes)
more = offset + len(data) < size
if finished and not more:
    complete, rest = data, b\"\"
else:
    nl = data.rfind(b\"\\n\")
    if nl == -1:
        # One very long line: don't stall waiting for its end
        complete, rest = (data, b\"\") if more else (b\"\", data)
    else:
        complete, rest = data[:nl + 1], data[nl + 1:]
lines = [clean(l) for l in complete.split(b\"\\n\")]
if complete.endswith(b\"\\n\") or not complete:
    lines = lines[:-1]
lines = [l for l in lines if l != marker]
print(json.dumps({
    \"job_id\": int(job_id), \"running\": running == \"true\",
    \"rc\": None if rc == \"null\" else int(rc),
    \"offset\": offset + len(complete), \"more\": more,
    \"lines\": lines, \"partial\": clean(rest) if rest != marker.encode() else \"\",
}))
" "$JOB_LOG" "$id" "$offset" "$finished" "$running" "$rc" "$POLL_MAX_BYTES" "$RESULTS_MARKER"
}

do_jobresults(){ 
    local id rc="null"
    id="$(job_id)"
    if [[ $id == "0" ]] || [[ ! -f $JOB_LOG ]]; then
        fail "There is no job"
    fi
    if job_running; then
        fail "The job is still running"
    fi
    if [[ -f $JOB_RC_FILE ]]; then
        rc="$(cat "$JOB_RC_FILE")"
        [[ $rc =~ ^[0-9]+$ ]] || rc="-1"
    else
        rc="-1"
    fi

    python3 -c "${clean_log_py}
log, job_id, rc, marker = sys.argv[1:5]
with open(log, \"rb\") as f:
    lines = [clean(l) for l in f.read().split(b\"\\n\")]
while lines and lines[-1] == \"\":
    lines.pop()
if marker in lines:
    # What the script printed after the marker
    text = lines[lines.index(marker) + 1:]
    has_results = True
else:
    # It stopped before it got that far (an error): show the end of the log
    text = lines[-200:]
    has_results = False
print(json.dumps({
    \"job_id\": int(job_id), \"rc\": int(rc),
    \"has_results\": has_results, \"text\": \"\\n\".join(text).strip(\"\\n\"),
}))
" "$JOB_LOG" "$id" "$rc" "$RESULTS_MARKER"
}

#------------------------------------------------------------------------------
# Settings

do_getsettings(){ 
    local backuppath buffer skip exists
    backuppath="$(/usr/syno/bin/synogetkeyvalue "$CONF_FILE" backuppath)"
    buffer="$(/usr/syno/bin/synogetkeyvalue "$CONF_FILE" buffer)"
    skip="$(/usr/syno/bin/synogetkeyvalue "$CONF_FILE" skip_minutes)"
    [[ $buffer =~ ^[0-9]+$ ]] || buffer=50
    [[ $skip =~ ^[0-9]+$ ]] || skip=360
    # Is the backup folder still there? (It can be renamed or deleted in File Station.)
    exists="false"
    [[ -n $backuppath && -d $backuppath ]] && exists="true"
    printf '{"backuppath":%s,"backuppath_exists":%s,"buffer":%s,"skip_minutes":%s}\n' \
        "$(json_str "$backuppath")" "$exists" "$buffer" "$skip"
}

json_str(){ 
    # Print $1 as a JSON string
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    s="$(printf %s "$s" | tr -d '\000-\010\013\014\016-\037')"
    printf '"%s"' "$s"
}

do_setsettings(){ 
    local backuppath="$1" buffer="$2" skip="$3" seg
    local -a segs

    # An empty backup location means "not set"
    if [[ -n $backuppath ]]; then
        backuppath="${backuppath%/}"
        # /volumeN/share/folder. Plain characters only (no spaces, so the
        # conf file value never needs quoting) and no folder that starts
        # with @ or # (@appstore, #recycle and so on are DSM's own).
        [[ $backuppath =~ ^/volume[1-9][0-9]?(/[A-Za-z0-9._+-]+)+$ ]] ||
            fail "The backup location must be like /volume1/backups (letters, numbers and . _ + - only)"
        IFS='/' read -r -a segs <<< "${backuppath#/}"
        for seg in "${segs[@]}"; do
            [[ $seg != "." && $seg != ".." ]] || fail "Invalid backup location"
        done
        [[ -d $backuppath ]] || fail "$backuppath not found"
    fi
    [[ $buffer =~ ^[0-9]{1,4}$ ]] || fail "The buffer must be a number of GB"
    [[ $skip =~ ^[0-9]{1,6}$ ]] || fail "The skip time must be a number of minutes"

    ensure_conf
    /usr/syno/bin/synosetkeyvalue "$CONF_FILE" backuppath "$backuppath"
    /usr/syno/bin/synosetkeyvalue "$CONF_FILE" buffer "$buffer"
    /usr/syno/bin/synosetkeyvalue "$CONF_FILE" skip_minutes "$skip"
    chown "root:${PKG_NAME}" "$CONF_FILE" 2>/dev/null
    chmod 644 "$CONF_FILE" 2>/dev/null
    api_log "settings saved"
    echo '{"saved":true}'
}

conf_get(){ 
    /usr/syno/bin/synogetkeyvalue "$CONF_FILE" "$1"
}

conf_set(){ 
    /usr/syno/bin/synosetkeyvalue "$CONF_FILE" "$1" "$2"
    chown "root:${PKG_NAME}" "$CONF_FILE" 2>/dev/null
    chmod 644 "$CONF_FILE" 2>/dev/null
}

task_failed(){ 
    # $1 is task_setup.sh's output and $2 its exit code
    [[ $2 -ne 0 ]] || printf '%s' "$1" | grep -q -E '"success" *: *false'
}

task_message(){ 
    # The "message" in task_setup.sh's JSON, or what it printed
    printf '%s' "$1" | python3 -c '
import json, sys
t = sys.stdin.read().strip()
try:
    m = json.loads(t).get("message")
except Exception:
    m = None
print(m or t[:200] or "Could not set up the scheduled task")
' 2>/dev/null
}

do_getschedule(){ 
    local type interval apps app out exists="false" first="yes" json_apps="" build monthly="false"
    local -a list
    type="$(conf_get schedule_type)"
    interval="$(conf_get schedule_interval)"
    apps="$(conf_get schedule_apps)"
    [[ $type =~ ^(hour|week|month)$ ]] || { type=""; apps=""; }
    [[ $interval =~ ^[0-9]+$ ]] || interval=0

    # The user can delete the task in Task Scheduler, so ask it too
    if [[ -n $type && -x $TASK_SETUP ]]; then
        out="$("$TASK_SETUP" find --name="$TASK_NAME" 2>>"$API_LOG_FILE")"
        if printf '%s' "$out" | grep -q -E '"exists" *: *true'; then
            exists="true"
        fi
    fi

    IFS=',' read -r -a list <<< "$apps"
    for app in "${list[@]}"; do
        [[ $app =~ ^[A-Za-z0-9._+-]+$ ]] || continue
        [[ $first == "yes" ]] || json_apps+=","
        first="no"
        json_apps+="$(json_str "$app")"
    done
    # Can this DSM do monthly? (The window only offers it if it can.)
    build="$(/usr/syno/bin/synogetkeyvalue /etc.defaults/VERSION buildnumber 2>/dev/null)"
    [[ $build =~ ^[0-9]+$ ]] || build=0
    [[ $build -ge $MONTHLY_MIN_BUILD ]] && monthly="true"
    printf '{"type":%s,"interval":%s,"apps":[%s],"task_exists":%s,"build":%s,"monthly":%s}\n' \
        "$(json_str "$type")" "$interval" "$json_apps" "$exists" "$build" "$monthly"
}

do_setschedule(){ 
    # $1 hour, week or month. $2 hours (1 to 11) for hour, 0 for the others.
    # $3 comma separated apps (the ones ticked when the schedule is saved)
    local type="$1" interval="$2" apps="$3" msg out rc
    local -a args

    case "$type" in
        hour|week|month) ;;
        *) fail "Invalid schedule '$type'" ;;
    esac
    if [[ $type == "hour" ]]; then
        [[ $interval =~ ^([1-9]|1[01])$ ]] || fail "The hours must be 1 to 11"
    else
        interval=0
    fi
    [[ $apps != "all" ]] || fail "Select the apps to back up"

    # The same checks as a backup that is started now. That includes that the
    # backup location is set and exists.
    msg="$(validate_job backup - "$apps")" || fail "$msg"

    [[ -x $TASK_SETUP ]] || fail "task_setup.sh is missing"
    args=(set --name="$TASK_NAME" --command="bash ${SELF} scheduledbackup" --interval-type="$type")
    [[ $type == "hour" ]] && args+=(--interval="$interval")
    out="$("$TASK_SETUP" "${args[@]}" 2>>"$API_LOG_FILE")"
    rc=$?
    echo "$out" >> "$API_LOG_FILE"
    if task_failed "$out" "$rc"; then
        fail "$(task_message "$out")"
    fi
    # Make sure it is really there
    out="$("$TASK_SETUP" find --name="$TASK_NAME" 2>>"$API_LOG_FILE")"
    printf '%s' "$out" | grep -q -E '"exists" *: *true' || fail "The scheduled task was not created"

    conf_set schedule_type "$type"
    conf_set schedule_interval "$interval"
    conf_set schedule_apps "$apps"
    api_log "schedule saved: $type $interval $apps"
    echo '{"saved":true}'
}

do_scheduledbackup(){ 
    # Run by Task Scheduler (as root) with the command do_setschedule saved
    # in the task. Backs up the apps chosen when the schedule was saved.
    # Its output is what Task Scheduler shows. It is a job like any other, so
    # the window shows it running.
    local apps app id rc msg
    local -a list keep=()

    apps="$(conf_get schedule_apps)"
    [[ -n $apps ]] || fail "There is no scheduled backup set up"
    IFS=',' read -r -a list <<< "$apps"
    for app in "${list[@]}"; do
        if [[ $app =~ ^[A-Za-z0-9._+-]+$ ]] && [[ -f "/var/packages/${app}/INFO" ]]; then
            keep+=("$app")
        else
            echo "Skipping $app: it is not installed"
        fi
    done
    [[ ${#keep[@]} -gt 0 ]] || fail "None of the apps in the scheduled backup are installed"
    apps="$(IFS=','; echo "${keep[*]}")"
    msg="$(validate_job backup - "$apps")" || fail "$msg"

    take_start_lock || fail "Another job is starting"
    trap 'rmdir "$START_LOCK" 2>/dev/null' EXIT
    if job_running; then
        fail "A job is already running. This scheduled backup was skipped."
    fi
    new_job
    id="$JOB_NEW_ID"
    echo "$$" > "$JOB_PID_FILE"
    rmdir "$START_LOCK" 2>/dev/null
    api_log "job $id: scheduled backup ${apps}"

    build_args backup - "$apps"
    APP_MOVER_RESULTS_MARKER=yes "$MOVER" "${MOVER_ARGS[@]}" 2>&1 | tee -a "$JOB_LOG" | grep -v -x -F "$RESULTS_MARKER"
    rc="${PIPESTATUS[0]}"
    echo "$rc" > "${JOB_RC_FILE}.tmp" && mv -f "${JOB_RC_FILE}.tmp" "$JOB_RC_FILE"
    exit "$rc"
}

do_removeschedule(){ 
    # Called by preuninst so uninstalling leaves no orphaned task, and by the
    # Schedule window's Remove button. Nothing to do if there never was one.
    local out rc
    if [[ -x $TASK_SETUP ]]; then
        out="$("$TASK_SETUP" remove --name="$TASK_NAME" 2>>"$API_LOG_FILE")"
        rc=$?
        echo "$out" >> "$API_LOG_FILE"
        if task_failed "$out" "$rc"; then
            fail "$(task_message "$out")"
        fi
    fi
    conf_set schedule_type ""
    conf_set schedule_interval ""
    conf_set schedule_apps ""
    echo '{"removed":true}'
}

do_listfolders(){ 
    # The folder picker. $1 is a folder like /volume1/Backups, or nothing for
    # the volumes. Prints [{"name":..,"path":..}] for the folders in it.
    # Only plain folders with names the backup location allows: not links,
    # not DSM's own (@appstore, #recycle, ...), nothing hidden.
    local p="${1%/}" d name seg v first="yes" count=0 out=""
    local -a segs

    if [[ -z $p ]]; then
        for v in /volume*; do
            valid_volume "$v" || continue
            [[ $first == "yes" ]] || out+=","
            first="no"
            out+="{\"name\":$(json_str "${v#/}"),\"path\":$(json_str "$v")}"
        done
    else
        [[ $p =~ ^/volume[1-9][0-9]?(/[A-Za-z0-9._+-]+)*$ ]] || fail "Invalid folder"
        IFS='/' read -r -a segs <<< "${p#/}"
        for seg in "${segs[@]}"; do
            [[ $seg != "." && $seg != ".." ]] || fail "Invalid folder"
        done
        valid_volume "/${segs[0]}" || fail "Invalid folder"
        [[ -d $p ]] || fail "$p not found"
        # No links on the way (they could lead anywhere)
        [[ "$(readlink -f "$p")" == "$p" ]] || fail "Invalid folder"

        for d in "$p"/*/; do
            [[ -d $d ]] || continue
            name="${d%/}"
            [[ -L $name ]] && continue
            name="${name##*/}"
            [[ $name =~ ^[A-Za-z0-9._+-]+$ ]] || continue
            case "$name" in
                .*|@*|"#"*|lost+found) continue ;;
            esac
            [[ $first == "yes" ]] || out+=","
            first="no"
            out+="{\"name\":$(json_str "$name"),\"path\":$(json_str "${p}/${name}")}"
            count=$((count + 1))
            [[ $count -lt 1000 ]] || break
        done
    fi
    printf '[%s]\n' "$out"
}

#------------------------------------------------------------------------------

ensure_state_dir
ensure_conf
self_heal

ACTION="$1"
shift

case "$ACTION" in
    startjob)
        [[ $# -eq 3 ]] || fail "startjob needs a mode, a destination and the apps"
        do_startjob "$1" "$2" "$3"
        ;;
    _runjob)
        [[ $# -eq 3 ]] || exit 1
        do_runjob "$1" "$2" "$3"
        ;;
    jobstatus)
        [[ $# -eq 1 ]] || fail "jobstatus needs <job id>:<offset>"
        do_jobstatus "$1"
        ;;
    jobresults)
        do_jobresults
        ;;
    getsettings)
        do_getsettings
        ;;
    databaseinfo)
        # Has to run as root: @database/pgsql belongs to the database user,
        # so the package user can't read it to get its size. The list script
        # checks that the argument is a volume like /volume2.
        [[ $# -eq 1 ]] || fail "databaseinfo needs a volume"
        out="$(bash "$LIST_SCRIPT" databaseinfo "$1" 2>&1)" || fail "$out"
        printf '%s\n' "$out"
        ;;
    listbackups)
        # Has to run as root: the package user can't see into the backup
        # location (a shared folder only lets in the users its permissions
        # name). The list script only reads, and prints just JSON.
        [[ $# -eq 0 ]] || fail "listbackups takes no arguments"
        out="$(bash "$LIST_SCRIPT" listbackups 2>&1)" || fail "$out"
        printf '%s\n' "$out"
        ;;
    setsettings)
        [[ $# -eq 3 ]] || fail "setsettings needs 3 values"
        do_setsettings "$1" "$2" "$3"
        ;;
    getschedule)
        [[ $# -eq 0 ]] || fail "getschedule takes no arguments"
        do_getschedule
        ;;
    setschedule)
        [[ $# -eq 3 ]] || fail "setschedule needs a schedule, the hours and the apps"
        do_setschedule "$1" "$2" "$3"
        ;;
    scheduledbackup)
        # Only ever run by Task Scheduler (appmover-helper doesn't accept it)
        [[ $# -eq 0 ]] || exit 1
        do_scheduledbackup
        ;;
    listfolders)
        [[ $# -eq 1 ]] || fail "listfolders needs a folder"
        do_listfolders "$1"
        ;;
    selfheal)
        echo '{"selfheal":true}'
        ;;
    removeschedule)
        do_removeschedule
        ;;
    *)
        fail "Unknown action"
        ;;
esac
