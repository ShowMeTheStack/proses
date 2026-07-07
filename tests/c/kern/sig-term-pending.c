/* A worker blocks SIGTERM, and its own child sends it one: it waits as pending until the worker unblocks it,
   which ends the worker before its last line. The parent reports how the worker ended. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t w = fork();
    if (w == 0) {
        sigset_t set;
        sigemptyset(&set);
        sigaddset(&set, SIGTERM);
        sigprocmask(SIG_BLOCK, &set, NULL);
        if (fork() == 0) {
            kill(getppid(), SIGTERM);
            _exit(0);
        }
        sleep(1);
        printf("still here\n");
        fflush(stdout);
        sigprocmask(SIG_UNBLOCK, &set, NULL);
        printf("not printed\n");
        fflush(stdout);
        _exit(0);
    }
    int st;
    waitpid(w, &st, 0);
    printf("worker killed by SIGTERM: %d\n", WIFSIGNALED(st) && WTERMSIG(st) == SIGTERM);
    return 0;
}
