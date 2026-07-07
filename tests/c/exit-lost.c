/* _exit skips the stdio flush: the child's copy of "a" is thrown away; the parent's copy prints. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    printf("a");
    if (fork() == 0)
        _exit(0);
    wait(NULL);
    printf("b\n");
    return 0;
}
