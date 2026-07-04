/* The running total is never set to zero before the loop adds to it. */
// expect: ub uninit line 9
#include <stdio.h>

int main(void) {
    int bursts[4] = {3, 5, 2, 7};
    int total;
    for (int i = 0; i < 4; i++)
        total += bursts[i];
    printf("%d\n", total);
    return 0;
}
