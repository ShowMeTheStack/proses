/* An off-by-one loop writes one element past the end of a local array. */
// expect: ub oob line 9
#include <stdio.h>

int main(void) {
    int ready[5];
    int i;
    for (i = 0; i <= 5; i++)
        ready[i] = i * 10;
    printf("%d\n", ready[4]);
    return 0;
}
