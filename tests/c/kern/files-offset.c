/* After fork, parent and child share one open file and its offset: their writes never overwrite each other. */
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int fd = open("log.txt", O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fork() == 0) {
        write(fd, "child\n", 6);
        exit(0);
    }
    wait(NULL);
    write(fd, "parent\n", 7);
    close(fd);
    char buf[64];
    fd = open("log.txt", O_RDONLY);
    int n = read(fd, buf, 63);
    buf[n] = 0;
    printf("%s", buf);
    printf("size %ld\n", lseek(fd, 0, SEEK_END));
    close(fd);
    unlink("log.txt");
    return 0;
}
