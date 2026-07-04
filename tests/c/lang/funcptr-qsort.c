/* qsort with the program's own comparison functions: numbers, strings and structs by a key. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct job { const char *name; int burst; };

int up(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
int down(const void *a, const void *b) { return *(const int *)b - *(const int *)a; }
int by_name(const void *a, const void *b) { return strcmp(*(const char *const *)a, *(const char *const *)b); }
int by_burst(const void *a, const void *b) {
    const struct job *x = a, *y = b;
    return x->burst - y->burst;
}

int main(void) {
    int v[] = {42, 7, 19, 3, 88, 21, 64, 1};
    int n = sizeof v / sizeof v[0];
    qsort(v, n, sizeof v[0], up);
    for (int i = 0; i < n; i++) printf("%d ", v[i]);
    printf("\n");
    qsort(v, n, sizeof(int), down);
    for (int i = 0; i < n; i++) printf("%d ", v[i]);
    printf("\n");
    const char *cmds[] = {"wait", "fork", "exec", "pipe", "dup2", "kill"};
    qsort(cmds, 6, sizeof(char *), by_name);
    for (int i = 0; i < 6; i++) printf("%s ", cmds[i]);
    printf("\n");
    struct job jobs[] = {{"A", 8}, {"B", 2}, {"C", 5}, {"D", 1}};
    qsort(jobs, 4, sizeof jobs[0], by_burst);
    int t = 0, waited = 0;
    for (int i = 0; i < 4; i++) { waited += t; t += jobs[i].burst; printf("%s ", jobs[i].name); }
    printf("avg wait %.2f\n", waited / 4.0);
    int (*cmp)(const void *, const void *) = up;
    printf("%d\n", cmp(&v[0], &v[1]) > 0);
    return 0;
}
