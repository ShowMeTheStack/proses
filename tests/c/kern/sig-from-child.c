/* The child signals its parent while the parent sleeps; the handler has run by the time the parent reads the flag. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

int got = 0;

void on_usr1(int sig) {
    got = 1;
}

int main(void) {
    signal(SIGUSR1, on_usr1);
    if (fork() == 0) {
        kill(getppid(), SIGUSR1);
        _exit(0);
    }
    sleep(1);
    int g = got;
    printf("got %d\n", g);
    wait(NULL);
    return 0;
}
