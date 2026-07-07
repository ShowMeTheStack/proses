/* SIGCHLD is blocked while two children end; once unblocked, the handler reaps them both. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

int reaped = 0;

void on_chld(int sig) {
    while (waitpid(-1, NULL, WNOHANG) > 0)
        reaped++;
}

int main(void) {
    sigset_t set;
    sigemptyset(&set);
    sigaddset(&set, SIGCHLD);
    signal(SIGCHLD, on_chld);
    sigprocmask(SIG_BLOCK, &set, NULL);
    if (fork() == 0) _exit(0);
    if (fork() == 0) _exit(0);
    sleep(1);
    sigprocmask(SIG_UNBLOCK, &set, NULL);
    printf("reaped %d\n", reaped);
    return 0;
}
