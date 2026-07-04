/* malloc gives exactly the bytes asked for: the eleventh int is past the end of the block. */
// expect: ub oob line 10
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n = 10;
    int *pids = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) pids[i] = 100 + i;
    pids[n] = 0;
    printf("%d\n", pids[0]);
    free(pids);
    return 0;
}
