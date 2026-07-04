/* A growing array with realloc, calloc's zeroed memory, and a matrix of rows from malloc. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    int cap = 2, n = 0;
    int *v = malloc(cap * sizeof *v);
    for (int i = 0; i < 20; i++) {
        if (n == cap) { cap *= 2; v = realloc(v, cap * sizeof *v); }
        v[n++] = i * i;
    }
    printf("%d %d %d %d\n", n, cap, v[0], v[19]);
    free(v);
    long *z = calloc(8, sizeof(long));
    long s = 0;
    for (int i = 0; i < 8; i++) s += z[i];
    printf("%ld\n", s);
    free(z);
    int rows = 3, cols = 4;
    int **m = malloc(rows * sizeof(int *));
    for (int r = 0; r < rows; r++) {
        m[r] = malloc(cols * sizeof(int));
        for (int c = 0; c < cols; c++) m[r][c] = r * cols + c;
    }
    printf("%d %d\n", m[1][2], m[2][3]);
    for (int r = 0; r < rows; r++) free(m[r]);
    free(m);
    char *s1 = strdup("copy on write");
    s1 = realloc(s1, 64);
    strcat(s1, " (cow)");
    printf("%s\n", s1);
    free(s1);
    char *t = realloc(NULL, 10);
    strcpy(t, "fresh");
    printf("%s\n", t);
    free(t);
    free(NULL);
    return 0;
}
