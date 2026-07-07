/* "start " has no newline, so it is still in the stdio buffer when fork copies the process: it prints twice. */
#include <stdio.h>
#include <unistd.h>

int main(void) {
    printf("start ");
    fork();
    printf("end\n");
    return 0;
}
