#!/usr/bin/env bash
#------------------------------------------------------------------------------
# Lists what Syno App Mover's web UI needs. Does not need root and does not
# change anything.
#
# Usage: syno_app_mover_list.sh <verb> [argument] [options]
#
# Verbs take zero or one argument (the same shapes synotoolbox-helper accepts)
#   listvolumes                 mounted volumes with free space and app counts
#   listpackages [/volumeN]     apps Move can move, plus USB Copy and @database
#   listbackuppackages          apps Backup can back up
#   listbackups                 backed up apps Restore can restore
#   databaseinfo /volumeN       what moving @database to /volumeN would do
#
# Settings (environment variables, for testing from a shell. They are not
# command line options, so a value coming from a web request can never change
# them. The verbs above don't need them.)
#   APP_MOVER_CONF=FILE         syno_app_mover.conf (default: see CONF below)
#   APP_MOVER_DOCKER=yes        also list Docker and Container Manager
#
# Output is just the JSON payload, for api.cgi's json_response to put in
# "result": an array for the list verbs, an object for databaseinfo.
# On failure the message is printed as plain text and the exit code is 1
# (api.cgi logs it and builds the {"success":false,...} reply).
#
# The lists are built the same way syno_app_mover.sh builds its own menus,
# so the UI offers exactly what the script would. If you change how the
# script builds a list, change it here too.
#------------------------------------------------------------------------------

# Docker and Container Manager are left out of every list.
# Set to "no" (or set APP_MOVER_DOCKER=yes) to list them again.
# Keep this in step with the --no-docker option passed to syno_app_mover.sh
no_docker="yes"

# Where the package keeps syno_app_mover.conf (used for listbackups): in the
# state folder of the package's var folder. Change PKG_NAME and CONF_NAME if
# the package uses other names.
PKG_NAME="App_Mover"
CONF_NAME="syno_app_mover.conf"

fail(){ 
    printf '%s\n' "$1"
    exit 1
}

json_str(){ 
    # Print $1 as a JSON string
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    # Drop any other control characters (not allowed in JSON strings)
    s="$(printf %s "$s" | tr -d '\000-\010\013\014\016-\037')"
    printf '"%s"' "$s"
}

key(){ 
    # $1 is file, $2 is key
    /usr/syno/bin/synogetkeyvalue "$1" "$2"
}

# Same test syno_app_mover.sh uses to find volumes: /volume1 to /volume99
# (not /volumeUSB# or /volume0) that are mounted.
# df's last column must be exactly the volume (syno_app_mover.sh greps for
# the volume anywhere in the line, so /volume1 also matches /volume10).
is_mounted_volume(){ 
    [[ $1 =~ ^/volume[1-9][0-9]?$ ]] || return 1
    [[ -d $1 ]] || return 1
    df -h 2>/dev/null | grep -q -E "[[:space:]]${1}\$"
}

get_volumes(){ 
    local v
    for v in /volume*; do
        if is_mounted_volume "$v"; then
            echo "$v"
        fi
    done
}

volume_space(){ 
    # Prints total and free space in KB. Uses the last line of df's output
    # so a long device name wrapping onto its own line doesn't matter.
    local out
    out="$(df -P -k "$1" 2>/dev/null || df -k "$1" 2>/dev/null)"
    out="$(printf '%s\n' "$out" | awk 'END {print $(NF-4), $(NF-2)}')"
    if [[ $out =~ ^[0-9]+\ [0-9]+$ ]]; then
        echo "$out"
    else
        echo "0 0"
    fi
}

excluded_pkg(){ 
    if [[ $no_docker == "yes" ]]; then
        if [[ $1 == "ContainerManager" ]] || [[ $1 == "Docker" ]]; then
            return 0
        fi
    fi
    return 1
}

dev_tool(){ 
    # Same as skip_dev_tools in syno_app_mover.sh (only used by Backup and
    # Restore, never by Move): packages that can't be stopped have no data.
    # $1 is the INFO file
    local skip1 skip2
    skip1="$(key "$1" startable)"
    skip2="$(key "$1" ctl_stop)"
    [[ $skip1 == "no" ]] || [[ $skip2 == "no" ]]
}

clean(){ 
    # Names go through tab separated lines, so remove any tabs and newlines
    local s="$1"
    s="${s//$'\t'/ }"
    s="${s//$'\n'/ }"
    printf %s "$s"
}

# Prints one tab separated line per installed package:
# volume, id, name, version, enabled
# Built like the "Add non-system packages to array" part of syno_app_mover.sh
list_installed(){ 
    # $1 is mode (move or backup)
    local link target package package_volume package_name version enabled
    cd /var/packages || fail "Failed to cd to /var/packages"
    while IFS= read -r -d '' link && IFS= read -r -d '' target; do
        if [[ ${link##*/} == "target" ]] && echo "$target" | grep -q 'volume'; then
            # Check symlink target exists
            if [[ -e "/var/packages${link#.}" ]]; then
                # Skip broken packages with no INFO file
                package="$(printf %s "$link" | cut -d'/' -f2)"
                if [[ -f "/var/packages/${package}/INFO" ]]; then
                    package_volume="$(printf %s "$target" | cut -d'/' -f1,2)"
                    package_name="$(key "/var/packages/${package}/INFO" displayname)"
                    if [[ -z $package_name ]]; then
                        package_name="$(key "/var/packages/${package}/INFO" package)"
                    fi

                    excluded_pkg "$package" && continue
                    if [[ $1 == "backup" ]]; then
                        dev_tool "/var/packages/${package}/INFO" && continue
                    fi

                    version="$(key "/var/packages/${package}/INFO" version)"
                    enabled="false"
                    [[ -f "/var/packages/${package}/enabled" ]] && enabled="true"
                    printf '%s\t%s\t%s\t%s\t%s\n' "$package_volume" "$package" \
                        "$(clean "$package_name")" "$(clean "$version")" "$enabled"
                fi
            fi
        fi
    done < <(find . -maxdepth 2 -type l -printf '%p\0%l\0')
}

database_volume(){ 
    # Volume @database is on (where /var/services/pgsql points)
    local link
    link="$(readlink "/var/services/pgsql")"
    [[ -n $link ]] && echo "/$(printf %s "$link" | cut -d'/' -f2)"
}

# Prints the extra lines Move mode adds to its menu: USB Copy and @database
list_extras(){ 
    local vol

    # USB Copy, if it is installed. syno_app_mover.sh asks `synopkg status`,
    # but run as a package user that wrongly reports installed packages as
    # broken (status 150, "failed to read fhs home"). So this decides the way
    # list_installed does: INFO file and a target that exists.
    #
    # Its database volume comes from setting.conf, which is root only
    # (-rw-r-----), so a package user can't read it. Then the row for the
    # database's volume is left out and nothing is said, because that is
    # the normal case. USB Copy is still listed under the volume the package
    # itself is installed on, and syno_app_mover.sh (run as root) prints the
    # USB Copy guidance when it is selected.
    if [[ -f /var/packages/USBCopy/INFO ]] && [[ -e /var/packages/USBCopy/target ]]; then
        vol="$(key /var/packages/USBCopy/etc/setting.conf repo_vol_path 2>/dev/null)"
        if [[ -n $vol ]]; then
            printf '%s\t%s\t%s\t%s\t%s\n' "$vol" "USBCopy" "USB Copy" "" ""
        elif [[ -r /var/packages/USBCopy/etc/setting.conf ]]; then
            echo "repo_vol_path missing from /var/packages/USBCopy/etc/setting.conf" >&2
        fi
    fi

    # @database
    vol="$(database_volume)"
    if [[ -n $vol ]]; then
        printf '%s\t%s\t%s\t%s\t%s\n' "$vol" "@database" "@database" "" ""
    fi
}

kind_of(){ 
    case "$1" in
        "@database") echo "database" ;;
        USBCopy)     echo "usbcopy" ;;
        *)           echo "package" ;;
    esac
}

dedupe(){ 
    # syno_app_mover.sh's menu lists USB Copy once for the volume the package
    # is installed on and again for the volume of its database. Only show a
    # volume and id once (the first row, the one with a version, is kept).
    awk -F'\t' '!seen[$1 FS $2]++'
}

#------------------------------------------------------------------------------
# Verbs

do_listvolumes(){ 
    local v total free count pkgs db first="yes" lines
    lines="$( { list_installed move; list_extras; } | dedupe )"
    db="$(database_volume)"

    printf '['
    while IFS= read -r v; do
        [[ -n $v ]] || continue
        read -r total free < <(volume_space "$v")
        count="$(printf '%s\n' "$lines" | awk -F'\t' -v v="$v" '$1 == v' | wc -l)"
        pkgs="$(printf '%s\n' "$lines" | awk -F'\t' -v v="$v" '$1 == v && $2 != "@database" && $2 != "USBCopy"' | wc -l)"
        [[ $first == "yes" ]] || printf ','
        first="no"
        printf '{"volume":%s,"total_kb":%s,"free_kb":%s,"entries":%s,"packages":%s,"has_database":%s}' \
            "$(json_str "$v")" "$total" "$free" "$count" "$pkgs" \
            "$([[ $v == "$db" ]] && echo true || echo false)"
    done < <(get_volumes)
    printf ']\n'
}

do_listpackages(){ 
    # $1 is mode (move or backup), $2 is volume to list (or nothing for all)
    local lines vol id name version enabled first="yes"
    if [[ $1 == "move" ]]; then
        lines="$( { list_installed move; list_extras; } | dedupe )"
    else
        lines="$(list_installed backup)"
    fi

    # Sort by volume then name (ignoring case)
    lines="$(printf '%s\n' "$lines" | sort -t $'\t' -k1,1 -k3,3f)"

    printf '['
    while IFS=$'\t' read -r vol id name version enabled; do
        [[ -n $id ]] || continue
        if [[ -n $2 ]] && [[ $vol != "$2" ]]; then
            continue
        fi
        [[ $first == "yes" ]] || printf ','
        first="no"
        printf '{"id":%s,"name":%s,"volume":%s,"kind":%s,"version":%s,"enabled":%s}' \
            "$(json_str "$id")" "$(json_str "$name")" "$(json_str "$vol")" \
            "$(json_str "$(kind_of "$id")")" "$(json_str "$version")" \
            "$([[ $enabled == "true" ]] && echo true || echo false)"
    done <<< "$lines"
    printf ']\n'
}

do_listbackups(){ 
    local backuppath bdir package info name installed_version backup_version
    local installed vol match last first="yes"

    [[ -f $conffile ]] || fail "$conffile not found"
    [[ -r $conffile ]] || fail "$conffile not readable"

    backuppath="$(key "$conffile" backuppath)"
    [[ -n $backuppath ]] || fail "backuppath missing from $conffile"
    [[ -d $backuppath ]] || fail "$backuppath not found"
    bdir="${backuppath}/syno_app_mover"

    printf '['
    if [[ -d $bdir ]]; then
        # Built like the restore part of syno_app_mover.sh
        cd "$bdir" || fail "Failed to cd to $bdir"
        for package in *; do
            if [[ -d $package ]] && [[ $package != "@eaDir" ]] && [[ ${package:0:1} != "-" ]]; then
                info="${bdir}/${package}/INFO"
                name="$(key "$info" displayname)"
                if [[ -z $name ]]; then
                    name="$(key "$info" package)"
                fi
                excluded_pkg "$package" && continue
                dev_tool "$info" && continue

                backup_version="$(key "$info" version)"
                installed="false"; installed_version=""; vol=""; match="false"
                if [[ -L "/var/packages/${package}/target" ]]; then
                    installed="true"
                    installed_version="$(key "/var/packages/${package}/INFO" version)"
                    vol="/$(readlink "/var/packages/${package}/target" | cut -d'/' -f2)"
                    if [[ -n $backup_version ]] && [[ $backup_version == "$installed_version" ]]; then
                        match="true"
                    fi
                fi

                last="null"
                if [[ -f "${bdir}/${package}/lastbackup" ]]; then
                    last="$(cat "${bdir}/${package}/lastbackup")"
                    [[ $last =~ ^[0-9]+$ ]] || last="null"
                fi

                [[ $first == "yes" ]] || printf ','
                first="no"
                printf '{"id":%s,"name":%s,"backup_version":%s,"installed":%s,"installed_version":%s,"volume":%s,"version_match":%s,"last_backup":%s}' \
                    "$(json_str "$package")" "$(json_str "$(clean "$name")")" \
                    "$(json_str "$backup_version")" "$installed" \
                    "$(json_str "$installed_version")" "$(json_str "$vol")" \
                    "$match" "$last"
            fi
        done
    fi
    printf ']\n'
}

do_databaseinfo(){ 
    # What moving @database to $1 would do. Same checks as
    # database_target_check() and database_target_prepare() in
    # syno_app_mover.sh
    local dest="$1" live d p size can="true" reason="" first="yes" live_use

    live="$(database_volume)"
    [[ -n $live ]] || fail "Could not find where @database is"

    if ! is_mounted_volume "$dest"; then
        can="false"; reason="$dest is not a mounted volume"
    elif [[ $live == "$dest" ]]; then
        can="false"; reason="@database is already on $dest"
    fi

    printf '{"source":%s,"dest":%s,' "$(json_str "$live")" "$(json_str "$dest")"

    # Folders on dest that will be renamed (never deleted)
    printf '"will_rename":['
    if [[ $can == "true" ]]; then
        for d in pgsql synologan; do
            p="${dest}/@database/${d}"
            if [[ -e $p ]] || [[ -L $p ]]; then
                if [[ $d == "pgsql" ]]; then
                    live_use="$(readlink -f "/var/services/pgsql")"
                else
                    live_use="$(dirname "$(readlink -f "/var/lib/synologan/database/alert.sqlite")")"
                fi
                if [[ $live_use == "$(readlink -f "$p")" ]]; then
                    can="false"; reason="$p is in use"
                fi
                size="$(du -sk "$p" 2>/dev/null | cut -f1)"
                [[ $size =~ ^[0-9]+$ ]] || size="0"
                [[ $first == "yes" ]] || printf ','
                first="no"
                printf '{"name":%s,"size_kb":%s}' "$(json_str "$d")" "$size"
            fi
        done
    fi
    printf '],'

    # Folders on dest that are left as they are (not copied)
    first="yes"
    printf '"will_keep":['
    if [[ $can == "true" ]]; then
        for d in autoupdate synolog; do
            if [[ -e "${dest}/@database/${d}" ]]; then
                [[ $first == "yes" ]] || printf ','
                first="no"
                printf '%s' "$(json_str "$d")"
            fi
        done
    fi
    printf '],'

    printf '"can_move":%s,"reason":%s}\n' "$can" "$(json_str "$reason")"
}

#------------------------------------------------------------------------------
# Options

verb="$1"
[[ -n $verb ]] && shift

# Default conf location: DSM 7 packages keep writable files in var, DSM 6 in
# etc (the same split api.cgi uses). app_mover_api.sh keeps the conf in the
# state folder inside it, which only root can write.
dsm="$(/usr/syno/bin/synogetkeyvalue /etc.defaults/VERSION majorversion)"
if [[ $dsm -ge 7 ]]; then
    conffile="/var/packages/${PKG_NAME}/var/state/${CONF_NAME}"
else
    conffile="/var/packages/${PKG_NAME}/etc/state/${CONF_NAME}"
fi

[[ $APP_MOVER_DOCKER == "yes" ]] && no_docker="no"
[[ -n $APP_MOVER_CONF ]] && conffile="$APP_MOVER_CONF"

# The only argument is a volume. Nothing else is accepted, so nothing in it
# can be mistaken for an option.
arg="$1"
if [[ $# -gt 1 ]]; then
    fail "Too many arguments"
fi
if [[ -n $arg ]]; then
    # volume2 --> /volume2
    arg="/${arg#/}"
    arg="${arg%/}"
    if [[ ! $arg =~ ^/volume[1-9][0-9]?$ ]]; then
        fail "Invalid volume '$1'"
    fi
fi

case "$verb" in
    listvolumes)
        [[ -z $arg ]] || fail "listvolumes takes no argument"
        do_listvolumes
        ;;
    listpackages)
        do_listpackages move "$arg"
        ;;
    listbackuppackages)
        [[ -z $arg ]] || fail "listbackuppackages takes no argument"
        do_listpackages backup ""
        ;;
    listbackups)
        [[ -z $arg ]] || fail "listbackups takes no argument"
        do_listbackups
        ;;
    databaseinfo)
        [[ -n $arg ]] || fail "databaseinfo needs a volume, like /volume2"
        do_databaseinfo "$arg"
        ;;
    *)
        fail "Unknown verb '$verb'"
        ;;
esac
