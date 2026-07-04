/* malloc's memory starts uninitialised: only half the array is filled before the sum reads all of it. */
// expect: ub uninit line 12
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *v = malloc(6 * sizeof(int));
    for (int i = 0; i < 3; i++)
        v[i] = i;
    long s = 0;
    for (int i = 0; i < 6; i++)
        s += v[i];
    printf("%ld\n", s);
    free(v);
    return 0;
}
