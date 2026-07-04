/* Pointer arithmetic, comparison and difference, and pointers to pointers. */
#include <stdio.h>

void swap(int **a, int **b) { int *t = *a; *a = *b; *b = t; }

int main(void) {
    int v[8] = {10, 20, 30, 40, 50, 60, 70, 80};
    int *p = v, *q = v + 7;
    printf("%d %d %ld\n", *p, *q, (long)(q - p));
    p += 3;
    printf("%d %d %d\n", *p, p[1], *(p - 2));
    printf("%d %d\n", p < q, p == &v[3]);
    int sum = 0;
    for (int *r = v; r != v + 8; r++) sum += *r;
    printf("%d\n", sum);
    int *x = &v[0], *y = &v[5];
    swap(&x, &y);
    printf("%d %d\n", *x, *y);
    int **pp = &x;
    **pp = 99;
    printf("%d\n", v[5]);
    char s[] = "pointer";
    char *e = s;
    while (*e) e++;
    printf("%ld\n", (long)(e - s));
    double d[3] = {1.5, 2.5, 3.5};
    double *dp = d;
    printf("%.1f %ld\n", *(dp + 2), (long)((char *)(dp + 2) - (char *)dp));
    void *vp = v;
    int *ip = (int *)vp + 2;
    printf("%d\n", *ip);
    return 0;
}
