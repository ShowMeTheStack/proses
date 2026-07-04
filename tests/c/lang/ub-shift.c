/* Shifting an int by 32 or more bits is undefined. */
// expect: warn shift line 8
// cc: skip (undefined behaviour)
#include <stdio.h>

int main(void) {
    int bits = 33;
    int x = 1 << bits;
    unsigned long ok = 1UL << bits;
    printf("%lu\n", ok);
    printf("%d\n", x != 0 || x == 0);
    return 0;
}
/* output:
8589934592
1
*/
