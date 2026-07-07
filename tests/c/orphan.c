/* The parent leaves first: the child is re-parented to init (pid 1), which reaps it when it ends. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
    if (fork() == 0) {
        sleep(1);
        printf("orphan: my parent is init: %d\n", getppid() == 1);
        exit(0);
    }
    printf("parent: leaving\n");
    return 0;
}
