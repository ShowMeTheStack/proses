/* A SIGCHLD handler counts its calls and reaps; the parent sleeps long enough for the child to end. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

int hits = 0, reaped = 0;

void on_chld(int sig) {
    hits++;
    if (waitpid(-1, NULL, WNOHANG) > 0)
        reaped++;
}

int main(void) {
    signal(SIGCHLD, on_chld);
    if (fork() == 0) _exit(0);
    sleep(1);
    printf("hits %d reaped %d\n", hits, reaped);
    return 0;
}
