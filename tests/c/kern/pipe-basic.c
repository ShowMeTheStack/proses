/* A parent writes a message into a pipe; the child reads it until end of file and prints what it got. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int fd[2];
    char buf[32];
    pipe(fd);
    if (fork() == 0) {
        close(fd[1]);
        int n, total = 0;
        while ((n = read(fd[0], buf, 8)) > 0)
            total += n;
        printf("child read %d bytes\n", total);
        exit(0);
    }
    close(fd[0]);
    write(fd[1], "twelve bytes", 12);
    close(fd[1]);
    wait(NULL);
    printf("parent done\n");
    return 0;
}
