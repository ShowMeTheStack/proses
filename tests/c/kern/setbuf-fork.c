/* With stdout unbuffered by setbuf(stdout, NULL), "start " is written before fork, so it prints once, even
   through a pipe. */
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    setbuf(stdout, NULL);
    printf("start ");
    if (fork() == 0) {
        printf("child\n");
        return 0;
    }
    wait(NULL);
    printf("parent\n");
    return 0;
}
