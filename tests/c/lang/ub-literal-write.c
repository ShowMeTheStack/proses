/* A string literal is read-only: changing its first letter crashes. */
// expect: ub ro-write line 8
#include <stdio.h>

int main(void) {
    char *msg = "hello";
    printf("%s\n", msg);
    msg[0] = 'H';
    printf("%s\n", msg);
    return 0;
}
