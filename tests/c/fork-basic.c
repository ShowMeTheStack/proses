/* A parent and its child each change their own copy of x; the parent waits and reads the child's exit code. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int x = 10;
    pid_t pid = fork();
    if (pid == 0) {
        x += 5;
        printf("child: x = %d\n", x);
        return 7;
    }
    int status;
    wait(&status);
    printf("parent: x = %d, child exited with %d\n", x, WEXITSTATUS(status));
    return 0;
}
