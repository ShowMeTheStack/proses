/* The child replaces itself with echo; the parent waits and reports its exit code. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    printf("before exec\n");
    pid_t k = fork();
    if (k == 0) {
        execlp("echo", "echo", "hello", "from", "echo", NULL);
        printf("exec failed\n");
        exit(1);
    }
    int st;
    waitpid(k, &st, 0);
    printf("echo exited with %d\n", WEXITSTATUS(st));
    return 0;
}
