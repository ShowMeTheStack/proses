/* On a terminal the newline flushes "begin" before fork, so it prints once; through a pipe stdout is fully
   buffered, the buffer is copied, and it prints twice. */
#include <stdio.h>
#include <unistd.h>

int main(void) {
    printf("begin\n");
    fork();
    printf("after\n");
    return 0;
}
