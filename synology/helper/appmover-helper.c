/*
 * appmover-helper.c
 *
 * Narrow setuid-root launcher for Syno App Mover.
 * Installed by DSM owner root:<package>, mode 6550 (setuid), from conf/privilege.
 *
 * This replaces the sudoers-based escalation: it does not depend on
 * /usr/bin/sudo being present, and only ever executes one fixed,
 * hardcoded script path with a whitelisted set of no-argument,
 * one-argument or fixed-three-argument commands.
 *
 * The script is opened once, checked and locked through that open file, and
 * run from that same open file (fexecve), so it can't be swapped for another
 * file between the check and the run. bin/ is owned by the package user, so
 * without this the package user could replace the script and get root.
 *
 * It only checks the verb and how many arguments it has (and that none is
 * absurdly long). What the arguments contain is checked by
 * app_mover_api.sh, which is what runs as root.
 */

#define _GNU_SOURCE
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#ifndef TARGET_SCRIPT
#define TARGET_SCRIPT "/var/packages/App_Mover/target/bin/app_mover_api.sh"
#endif

/* Longest argument accepted (startjob's list of apps is the longest) */
#define MAX_ARG_LEN 4096

static int in_list(const char *cmd, const char *list[])
{
    for (int i = 0; list[i] != NULL; i++)
        if (strcmp(cmd, list[i]) == 0)
            return 1;
    return 0;
}

int main(int argc, char *argv[])
{
    const char *no_arg[] = { "jobresults", "jobinfo", "getsettings", "getschedule", "listbackups", "selfheal", "removeschedule", NULL };
    const char *one_arg[] = { "jobstatus", "databaseinfo", "listfolders", NULL };
    const char *three_arg[] = { "startjob", "setsettings", "setschedule", NULL };

    if (argc < 2) {
        fprintf(stderr, "appmover-helper: missing subcommand\n");
        return 1;
    }
    const char *cmd = argv[1];

    int is_no_arg = in_list(cmd, no_arg);
    int is_one_arg = in_list(cmd, one_arg);
    int is_three_arg = in_list(cmd, three_arg);

    if ((is_no_arg && argc != 2) || (is_one_arg && argc != 3) ||
        (is_three_arg && argc != 5) ||
        (!is_no_arg && !is_one_arg && !is_three_arg)) {
        fprintf(stderr, "appmover-helper: rejected '%s' with %d argument(s)\n",
                cmd, argc - 2);
        return 1;
    }

    for (int i = 2; i < argc; i++) {
        if (strlen(argv[i]) > MAX_ARG_LEN) {
            fprintf(stderr, "appmover-helper: rejected '%s': argument %d is too long\n",
                    cmd, i - 1);
            return 1;
        }
    }

    /* setuid binary gives us euid=0; promote ruid too so the exec'd
     * script is genuinely root, not just effectively root. */
    if (setuid(0) != 0) {
        perror("appmover-helper: setuid(0) failed");
        return 1;
    }

    /* Sanitize environment: fixed PATH, no inherited surprises. */
    if (clearenv() != 0) {
        fprintf(stderr, "appmover-helper: clearenv failed\n");
        return 1;
    }
    setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/syno/bin:/usr/syno/sbin", 1);
    setenv("HOME", "/root", 1);

    /* Open the script once. No O_CLOEXEC: the kernel runs a script through
     * /dev/fd/N, so the descriptor has to survive the exec. */
    int fd = open(TARGET_SCRIPT, O_RDONLY | O_NOFOLLOW);
    if (fd < 0) {
        perror("appmover-helper: cannot open script");
        return 1;
    }
    struct stat st;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        fprintf(stderr, "appmover-helper: script is not a regular file\n");
        return 1;
    }
    /* postinst runs as the package user, so on a fresh install the script is
     * owned by it. Lock it now, through the open descriptor. From here on
     * only root can change it. */
    if (st.st_uid != 0) {
        if (fchown(fd, 0, st.st_gid) != 0 || fchmod(fd, 0555) != 0 ||
            fstat(fd, &st) != 0) {
            perror("appmover-helper: cannot secure script");
            return 1;
        }
    }
    if (st.st_uid != 0 || (st.st_mode & (S_IWGRP | S_IWOTH)) != 0) {
        fprintf(stderr, "appmover-helper: script is not root owned and write protected\n");
        return 1;
    }

    char *args[7];
    int n = 0;
    args[n++] = (char *)TARGET_SCRIPT;
    args[n++] = (char *)cmd;
    for (int i = 2; i < argc; i++)
        args[n++] = argv[i];
    args[n] = NULL;

    extern char **environ;
    fexecve(fd, args, environ);

    perror("appmover-helper: exec failed");
    return 1;
}
