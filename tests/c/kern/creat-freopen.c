/* creat makes a file of two lines; freopen points stdin at it, and a child's stdout at another file, which the
   parent reads back. */
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    char line[64];
    int fd = creat("in.txt", 0644);
    write(fd, "hello\nworld\n", 12);
    close(fd);
    freopen("in.txt", "r", stdin);
    while (fgets(line, 64, stdin))
        printf("read: %s", line);
    if (fork() == 0) {
        freopen("out.txt", "w", stdout);
        printf("from the child\n");
        exit(0);
    }
    wait(NULL);
    fd = open("out.txt", O_RDONLY);
    int n = read(fd, line, 63);
    line[n] = 0;
    printf("out.txt holds: %s", line);
    return 0;
}
