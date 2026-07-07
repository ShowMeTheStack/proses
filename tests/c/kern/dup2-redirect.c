/* The child points its stdout at a pipe with dup2, so its printf goes to the parent, which prints it in capitals. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int fd[2];
    char buf[64];
    pipe(fd);
    if (fork() == 0) {
        dup2(fd[1], 1);
        close(fd[0]);
        close(fd[1]);
        printf("from the child\n");
        return 0;
    }
    close(fd[1]);
    int n = read(fd[0], buf, 63), i;
    for (i = 0; i < n; i++)
        if (buf[i] >= 'a' && buf[i] <= 'z')
            buf[i] = buf[i] - 32;
    buf[n] = 0;
    printf("parent got: %s", buf);
    wait(NULL);
    return 0;
}
