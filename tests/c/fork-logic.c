/* fork() && fork() || fork(): short-circuit evaluation decides who forks again. Five processes print. */
#include <stdio.h>
#include <unistd.h>

int main(void) {
    fork() && fork() || fork();
    printf("+\n");
    return 0;
}
