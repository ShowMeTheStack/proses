/* A handler for SIGUSR1, then a signal to itself: the handler runs before kill returns. */
#include <stdio.h>
#include <signal.h>
#include <unistd.h>

int hits = 0;

void on_usr1(int sig) {
    hits++;
    printf("handler: signal %d\n", sig == SIGUSR1);
}

int main(void) {
    signal(SIGUSR1, on_usr1);
    printf("before\n");
    kill(getpid(), SIGUSR1);
    printf("after, hits = %d\n", hits);
    raise(SIGUSR1);
    printf("hits = %d\n", hits);
    return 0;
}
