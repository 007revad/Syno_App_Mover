#!/bin/bash
#----------------------------------------------------------
# App_Mover package - API CGI
# Structure ported from Syno_Toolbox's api.cgi (verified working pattern):
# same header block, urldecode/parse_kv, json_response, run_privileged.
# Only the action cases differ.
#
# Every reply is {"success":true|false, "message":"...", "result":<payload>}
#
# Actions
#   init                              (the only one that needs no authorisation)
#   listvolumes                       mounted volumes with free space
#   listpackages [volume]             apps Move can move
#   listbackuppackages                apps Backup can back up
#   listbackups                       backed up apps Restore can restore (as root)
#   databaseinfo dest                 what moving @database to dest would do
#   startjob mode dest apps           POST. mode is move, backup or restore
#   jobstatus job                     job is <job id>:<offset>, id 0 = current
#   jobresults                        the text for the results window
#   getsettings
#   setsettings backuppath buffer skip_minutes     POST
#   getschedule                       the scheduled backup, if there is one
#   setschedule type interval apps    POST. type is hour, week or month
#   removeschedule                    POST
#   listfolders [path]                the folder picker (as root)
#----------------------------------------------------------

# --------- 1. Common variables and path calculations -------------

PKG_NAME="App_Mover"
PKG_ROOT="/var/packages/${PKG_NAME}"
TARGET_DIR="${PKG_ROOT}/target"
BIN_DIR="${TARGET_DIR}/bin"

dsm=$(/usr/syno/bin/synogetkeyvalue /etc.defaults/VERSION majorversion)
if [[ $dsm -ge 7 ]]; then
    VAR_DIR="${PKG_ROOT}/var"
else
    VAR_DIR="${PKG_ROOT}/etc"
fi

LOG_FILE="${VAR_DIR}/api.log"
API_SCRIPT="${BIN_DIR}/app_mover_api.sh"
LIST_SCRIPT="${BIN_DIR}/syno_app_mover_list.sh"
HELPER="${BIN_DIR}/helper/appmover-helper"

touch "${LOG_FILE}"
chmod 644 "${LOG_FILE}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

# --------- 2. Parsing URL-encoded parameters --------------------
# (Done before the header output so ACTION is known. Nothing here changed
# from Toolbox's api.cgi.)

urldecode() { : "${*//+/ }"; echo -e "${_//%/\\x}"; }
declare -A PARAM
parse_kv() {
    local kv_pair key val
    IFS='&' read -ra kv_pair <<< "$1"
    for pair in "${kv_pair[@]}"; do
        IFS='=' read -r key val <<< "${pair}"
        key="$(urldecode "${key}")"
        val="$(urldecode "${val}")"
        PARAM["${key}"]="${val}"
    done
}

# --------- 2a. JSON/privilege helpers ----------------------------

json_response() {
    local ok="$1" msg="$2" data="$3"
    local msg_json
    msg_json=$(echo "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')
    if [ -z "$data" ]; then
        echo "{\"success\":$ok, \"message\":$msg_json, \"result\":null}"
    else
        echo "{\"success\":$ok, \"message\":$msg_json, \"result\":$data}"
    fi
}

run_privileged() {
    # DSM 7's package CGI runs sandboxed enough to need real escalation
    # (setuid helper); DSM 6 doesn't - confirmed against Drive Info's
    # existing dsm-version branch. Same split as Syno_Toolbox's api.cgi.
    if [[ "$dsm" -ge 7 ]]; then
        RUN_OUT=$("$HELPER" "$@" 2>>"${LOG_FILE}")
    else
        RUN_OUT=$(bash "$API_SCRIPT" "$@" 2>>"${LOG_FILE}")
    fi
    RUN_RC=$?
}

run_list() {
    # The list verbs only read, so they don't need root: this calls the
    # script directly instead of going through run_privileged/the helper.
    # (Tested as the package user inside DSM 7's CGI sandbox.)
    RUN_OUT=$(bash "$LIST_SCRIPT" "$@" 2>>"${LOG_FILE}")
    RUN_RC=$?
}

# --------- 2b. Who may call this -----------------------------------
# This can move, back up and restore apps as root, and api.cgi is reachable
# without being logged in to DSM (Toolbox's pingtoolbox relies on that), so
# every action except init has to be authorised here.
#
# The caller must be a logged in DSM administrator:
#  - Who is calling: /usr/syno/synoman/webman/modules/authenticate.cgi prints
#    the logged in user's name. DSM validates the session itself, from the
#    session cookie plus the X-SYNO-TOKEN header the DSM desktop sends. With
#    no valid session it prints nothing. Observed on DSM 7: the app's own
#    requests (cookie + token) print the name; a request with no session, or
#    a plain page load with a cookie but no token, prints nothing.
#  - Is it an administrator: the name is in the "administrators" line of
#    /etc/group (world readable). The CGI user can't run synogroup (permission
#    denied), so the file is read instead. Local accounts only.
#  - Any failure, or anything unexpected, is "not authorised".
# config's "allUsers" lets any DSM user open the window, which is why this
# checks for an administrator and not just a login.

is_admin() {
    # $1 = user name, already checked against a strict pattern by the caller
    awk -F: -v u="$1" '
        $1=="administrators" {
            n=split($4,a,",")
            for (i=1;i<=n;i++) if (a[i]==u) found=1
        }
        END { exit !found }' /etc/group
}

require_auth() {
    local user
    user=$(/usr/syno/synoman/webman/modules/authenticate.cgi 2>/dev/null | head -n1)

    if [[ "$user" =~ ^[A-Za-z0-9._@-]+$ ]]; then
        if is_admin "$user"; then
            return 0
        fi
        log "[ERROR] ${ACTION}: not authorised (user=${user} is not an administrator)"
    else
        log "[ERROR] ${ACTION}: not authorised (no valid DSM session)"
    fi
    json_response false "Not authorised" ""
    exit 0
}

require_post() {
    # Actions that change anything must not be possible with a plain link
    if [[ "$REQUEST_METHOD" != "POST" ]]; then
        log "[ERROR] ${ACTION}: needs POST (was ${REQUEST_METHOD})"
        json_response false "This action needs POST" ""
        exit 0
    fi
}

case "$REQUEST_METHOD" in
POST)
    CONTENT_LENGTH=${CONTENT_LENGTH:-0}
    if [ "$CONTENT_LENGTH" -gt 0 ]; then
        read -r -n "$CONTENT_LENGTH" POST_DATA
    else
        POST_DATA=""
    fi
    parse_kv "${POST_DATA}"
    ;;
GET)
    parse_kv "${QUERY_STRING}"
    ;;
*)
    log "Unsupported METHOD: ${REQUEST_METHOD}"
    echo "Content-Type: application/json; charset=utf-8"
    echo ""
    echo '{"success":false,"message":"Unsupported METHOD","result":null}'
    exit 0
    ;;
esac

ACTION="${PARAM[action]}"
log "Request: ACTION=${ACTION}"

# --------- 3. HTTP header output --------------------------------
# No Access-Control-Allow-* headers: nothing calls this from another site.

echo "Content-Type: application/json; charset=utf-8"
echo ""

# --------- 4. Action processing ----------------------------------

if [[ "$ACTION" != "init" ]]; then
    require_auth
fi

case "${ACTION}" in
init)
    log "----------------------------------------"
    log "Web UI opened/refreshed"
    echo '{"success":true,"message":"init"}'
    ;;

listvolumes)
    run_list listvolumes
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] listvolumes failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not list volumes}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

listpackages)
    # volume is optional: /volume2 lists just that volume's apps
    run_list listpackages "${PARAM[volume]}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] listpackages ${PARAM[volume]} failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not list apps}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

listbackuppackages)
    run_list listbackuppackages
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] listbackuppackages failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not list apps}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

listbackups)
    # Needs root: the package user can't see into the backup location
    run_privileged listbackups
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] listbackups failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not list backups}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

databaseinfo)
    # Needs root: the package user can't read @database/pgsql to size it
    run_privileged databaseinfo "${PARAM[dest]}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] databaseinfo ${PARAM[dest]} failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not check @database}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

startjob)
    require_post
    # dest is "-" for backup and restore. app_mover_api.sh checks every value.
    run_privileged startjob "${PARAM[mode]}" "${PARAM[dest]:--}" "${PARAM[apps]}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] startjob ${PARAM[mode]} failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Failed to start}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

jobstatus)
    run_privileged jobstatus "${PARAM[job]:-0:0}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] jobstatus ${PARAM[job]} failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not get the job status}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

jobresults)
    run_privileged jobresults
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] jobresults failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not get the results}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

getsettings)
    run_privileged getsettings
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] getsettings failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not read the settings}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

setsettings)
    require_post
    run_privileged setsettings "${PARAM[backuppath]}" "${PARAM[buffer]}" "${PARAM[skip_minutes]}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] setsettings failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Failed to save the settings}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

getschedule)
    run_privileged getschedule
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] getschedule failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not read the schedule}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

setschedule)
    require_post
    # app_mover_api.sh checks every value, and makes the Task Scheduler task
    run_privileged setschedule "${PARAM[type]}" "${PARAM[interval]:-0}" "${PARAM[apps]}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] setschedule ${PARAM[type]} failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Failed to save the schedule}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

removeschedule)
    require_post
    run_privileged removeschedule
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] removeschedule failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Failed to remove the schedule}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

listfolders)
    # The folder picker. Needs root: the package user can't see into shared
    # folders. app_mover_api.sh only lists plain folders under a volume.
    run_privileged listfolders "${PARAM[path]}"
    if [ "$RUN_RC" -ne 0 ]; then
        log "[ERROR] listfolders ${PARAM[path]} failed (rc=${RUN_RC}): ${RUN_OUT}"
        json_response false "${RUN_OUT:-Could not list the folders}" ""
    else
        json_response true "" "${RUN_OUT}"
    fi
    ;;

*)
    log "[ERROR] Invalid action: ${ACTION}"
    json_response false "Invalid action: ${ACTION}" ""
    ;;
esac

exit 0
