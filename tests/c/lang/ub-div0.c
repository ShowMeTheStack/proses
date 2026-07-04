/* The average of no samples divides by zero. */
// expect: ub div0 line 8
#include <stdio.h>

int average(const int *v, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += v[i];
    return s / n;
}

int main(void) {
    int samples[3] = {4, 5, 6};
    printf("%d\n", average(samples, 3));
    printf("%d\n", average(samples, 0));
    return 0;
}
