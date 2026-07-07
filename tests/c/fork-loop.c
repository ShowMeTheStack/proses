/* Three children, each printing its number; the parent reaps them all, then reports. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int i;
    for (i = 0; i < 3; i++) {
        if (fork() == 0) {
            printf("child %d\n", i);
            exit(0);
        }
    }
    int n = 0;
    while (wait(NULL) > 0)
        n++;
    printf("parent reaped %d\n", n);
    return 0;
}
