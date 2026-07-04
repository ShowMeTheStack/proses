/* bsearch over a sorted table of system calls by number. */
#include <stdio.h>
#include <stdlib.h>

struct sc { int nr; const char *name; };
static const struct sc table[] = {{0, "read"}, {1, "write"}, {2, "open"}, {3, "close"}, {9, "mmap"}, {39, "getpid"}, {57, "fork"}, {59, "execve"}, {60, "exit"}, {61, "wait4"}};

int by_nr(const void *k, const void *e) { return *(const int *)k - ((const struct sc *)e)->nr; }

int main(void) {
    int want[] = {57, 4, 0, 61, 39};
    for (int i = 0; i < 5; i++) {
        const struct sc *hit = bsearch(&want[i], table, sizeof table / sizeof table[0], sizeof table[0], by_nr);
        printf("%d: %s\n", want[i], hit ? hit->name : "(none)");
    }
    return 0;
}
