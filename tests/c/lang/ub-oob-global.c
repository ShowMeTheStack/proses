/* Reading one element past a global table. */
// expect: ub oob line 9
#include <stdio.h>

int quantum[4] = {1, 2, 4, 8};

int main(void) {
    int total = 0;
    for (int level = 0; level <= 4; level++) total += quantum[level];
    printf("%d\n", total);
    return 0;
}
