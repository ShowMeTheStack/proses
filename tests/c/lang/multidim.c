/* Two-dimensional arrays: a matrix product, row pointers, and an array passed as int (*)[N]. */
#include <stdio.h>
#define N 3

void mul(int a[N][N], int b[N][N], int c[N][N]) {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            c[i][j] = 0;
            for (int k = 0; k < N; k++) c[i][j] += a[i][k] * b[k][j];
        }
}

int trace(int (*m)[N]) { int t = 0; for (int i = 0; i < N; i++) t += m[i][i]; return t; }

int main(void) {
    int a[N][N] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
    int id[N][N] = {{1}, {0, 1}, {0, 0, 1}};
    int c[N][N];
    mul(a, a, c);
    for (int i = 0; i < N; i++) printf("%d %d %d\n", c[i][0], c[i][1], c[i][2]);
    mul(a, id, c);
    printf("%d %d\n", trace(c), trace(a));
    printf("%lu %lu %lu\n", sizeof a, sizeof a[0], sizeof a[0][0]);
    int *flat = &a[0][0];
    printf("%d %d\n", flat[4], *(*(a + 2) + 1));
    char grid[2][4][3];
    printf("%lu %ld\n", sizeof grid, (long)(&grid[1][2][0] - &grid[0][0][0]));
    int (*row)[N] = a + 1;
    printf("%d\n", (*row)[2]);
    return 0;
}
