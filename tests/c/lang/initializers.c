/* Initializers: partial lists fill the rest with zeros, designated members and indices, nested lists, strings. */
#include <stdio.h>

struct opts { int verbose; int depth; const char *out; double scale; };
struct pair { int k, v; };

int main(void) {
    int a[6] = {1, 2};
    int b[] = {[4] = 9, [1] = 3, 7};
    char s1[8] = "hi";
    char s2[] = {'o', 'k', '\0'};
    struct opts o = {.depth = 3, .out = "trace.log"};
    struct pair ps[3] = {{1, 10}, [2] = {.v = 30}};
    int grid[2][3] = {1, 2, 3, 4};
    int z[4] = {0};
    printf("%d %d %d %d\n", a[0], a[1], a[2], a[5]);
    printf("%lu: %d %d %d %d %d\n", sizeof b / sizeof b[0], b[0], b[1], b[2], b[3], b[4]);
    printf("%s %d %d %s %lu\n", s1, s1[3], s1[7], s2, sizeof s2);
    printf("%d %d %s %.1f\n", o.verbose, o.depth, o.out, o.scale);
    printf("%d %d %d %d %d %d\n", ps[0].k, ps[0].v, ps[1].k, ps[1].v, ps[2].k, ps[2].v);
    printf("%d %d %d %d\n", grid[0][2], grid[1][0], grid[1][1], grid[1][2]);
    printf("%d %d\n", z[0], z[3]);
    struct opts copy = o;
    copy.verbose = 1;
    printf("%d %d\n", o.verbose, copy.verbose);
    const char *words[] = {"alpha", "beta", "gamma"};
    printf("%s %c %lu\n", words[2], words[1][0], sizeof words / sizeof *words);
    int x = {5};
    printf("%d\n", x);
    return 0;
}
