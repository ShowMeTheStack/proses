/* Three forks in a row: every process that exists forks again, so 2 * 2 * 2 = 8 processes print. */
#include <stdio.h>
#include <unistd.h>

int main(void) {
    fork();
    fork();
    fork();
    printf("hello\n");
    return 0;
}
