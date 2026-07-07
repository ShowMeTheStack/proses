/* An alarm interrupts pause: the handler runs, then pause returns -1. */
#include <stdio.h>
#include <signal.h>
#include <unistd.h>

void ring(int sig) {
    printf("ring\n");
}

int main(void) {
    signal(SIGALRM, ring);
    alarm(1);
    int r = pause();
    printf("pause returned %d\n", r);
    return 0;
}
