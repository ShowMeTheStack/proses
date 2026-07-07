/* A two-stage pipeline built by hand: the first child prints words into a pipe, the second runs sort on them. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int fd[2];
    pipe(fd);
    if (fork() == 0) {
        dup2(fd[1], 1);
        close(fd[0]);
        close(fd[1]);
        printf("pear\napple\nfig\n");
        exit(0);
    }
    if (fork() == 0) {
        dup2(fd[0], 0);
        close(fd[0]);
        close(fd[1]);
        execlp("sort", "sort", NULL);
        exit(1);
    }
    close(fd[0]);
    close(fd[1]);
    while (wait(NULL) > 0)
        ;
    printf("pipeline done\n");
    return 0;
}
