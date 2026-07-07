/* Three children end three ways: a normal exit, an exit code, and a signal; the parent decodes each status. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t k[3];
    int i, st;
    for (i = 0; i < 3; i++) {
        k[i] = fork();
        if (k[i] == 0) {
            if (i == 0) return 0;
            if (i == 1) exit(42);
            kill(getpid(), SIGKILL);
        }
    }
    for (i = 0; i < 3; i++) {
        waitpid(k[i], &st, 0);
        if (WIFEXITED(st))
            printf("child %d exited with %d\n", i, WEXITSTATUS(st));
        else if (WIFSIGNALED(st))
            printf("child %d killed by signal %d\n", i, WTERMSIG(st));
    }
    return 0;
}
