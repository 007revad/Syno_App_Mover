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
 * It only checks the verb and how many arguments it has (and that none is
 * absurdly long). What the arguments contain is checked by
 * app_mover_api.sh, which is what runs as root.
 */

#define _GNU_SOURCE
#include <unistd.h>
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
    const char *no_arg[] = { "jobresults", "getsettings", "selfheal", "removeschedule", NULL };
    const char *one_arg[] = { "jobstatus", NULL };
    const char *three_arg[] = { "startjob", "setsettings", NULL };

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

    if (argc == 2) {
        execl(TARGET_SCRIPT, TARGET_SCRIPT, cmd, (char *)NULL);
    } else if (argc == 5) {
        execl(TARGET_SCRIPT, TARGET_SCRIPT, cmd, argv[2], argv[3], argv[4], (char *)NULL);
    } else {
        execl(TARGET_SCRIPT, TARGET_SCRIPT, cmd, argv[2], (char *)NULL);
    }

    perror("appmover-helper: execl failed");
    return 1;
}
