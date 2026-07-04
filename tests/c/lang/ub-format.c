/* printf's conversions do not match the values passed. */
// expect: warn format line 8
// expect: warn format line 9
// cc: skip (undefined behaviour)
#include <stdio.h>

int main(void) {
    printf("%d\n", 3.5);
    printf("%s has %d\n", "queue");
    long n = 5000000000L;
    printf("%ld ok\n", n);
    return 0;
}
