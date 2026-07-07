/* Three children sleep 3, 1 and 2 seconds before printing: with real timing they print in the order of their
   sleeps, and the parent, waiting for each in turn, reports last. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    int naps[3] = {3, 1, 2};
    int i;
    for (i = 0; i < 3; i++) {
        if (fork() == 0) {
            sleep(naps[i]);
            printf("child %d slept %d\n", i, naps[i]);
            exit(0);
        }
    }
    while (wait(NULL) > 0)
        ;
    printf("parent done\n");
    return 0;
}
