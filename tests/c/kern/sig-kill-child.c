/* The parent kills a child that sleeps; the status says which signal ended it. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t k = fork();
    if (k == 0) {
        sleep(5);
        printf("not reached\n");
        exit(0);
    }
    kill(k, SIGTERM);
    int st;
    waitpid(k, &st, 0);
    printf("signaled %d, by SIGTERM %d\n", WIFSIGNALED(st), WTERMSIG(st) == SIGTERM);
    return 0;
}
