/* After fork each process has its own memory: the child's changes to the global and the array stay its own. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int count = 0;
char word[8] = "fork";

int main(void) {
    if (fork() == 0) {
        count = 41;
        word[0] = 'w';
        printf("child: %d %s\n", count + 1, word);
        exit(0);
    }
    wait(NULL);
    printf("parent: %d %s\n", count, word);
    return 0;
}
