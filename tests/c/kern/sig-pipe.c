/* Writing to a pipe nobody can read: SIGPIPE kills the writer; ignored, write fails with EPIPE instead. */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <errno.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int fd[2];
    pipe(fd);
    close(fd[0]);
    pid_t k = fork();
    if (k == 0) {
        write(fd[1], "x", 1);
        exit(0);
    }
    int st;
    waitpid(k, &st, 0);
    printf("child killed by SIGPIPE: %d\n", WIFSIGNALED(st) && WTERMSIG(st) == SIGPIPE);
    signal(SIGPIPE, SIG_IGN);
    int r = write(fd[1], "x", 1);
    printf("write returns %d, EPIPE: %d\n", r, errno == EPIPE);
    return 0;
}
