/* Opening a file that is not there: open returns -1, errno says why, and perror prints it on stderr. */
#include <stdio.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>

int main(void) {
    int fd = open("missing.txt", O_RDONLY);
    printf("fd %d, ENOENT %d\n", fd, errno == ENOENT);
    perror("open");
    fd = open("here.txt", O_CREAT | O_EXCL | O_WRONLY, 0600);
    int again = open("here.txt", O_CREAT | O_EXCL | O_WRONLY, 0600);
    printf("second open %d, EEXIST %d\n", again, errno == EEXIST);
    close(fd);
    unlink("here.txt");
    printf("close again %d, EBADF %d\n", close(fd), errno == EBADF);
    return 0;
}
