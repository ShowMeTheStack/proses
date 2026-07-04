/* strlen, strcpy, strncpy, strcat, strncat, strcmp and strncmp. */
#include <stdio.h>
#include <string.h>

int sign(int x) { return (x > 0) - (x < 0); }

int main(void) {
    char a[32] = "proc", b[32];
    strcpy(b, a);
    strcat(b, "ess");
    printf("%s %lu %lu\n", b, strlen(a), strlen(b));
    char c[10];
    strncpy(c, "scheduler", 5);
    c[5] = '\0';
    printf("%s\n", c);
    char d[8];
    memset(d, 'x', sizeof d);
    strncpy(d, "ab", sizeof d);
    printf("%d %d %d\n", d[2], d[7], (int)strlen(d));
    strncat(b, "-table-entry", 6);
    printf("%s\n", b);
    printf("%d %d %d\n", sign(strcmp("abc", "abd")), sign(strcmp("b", "a")), strcmp("same", "same"));
    printf("%d %d\n", sign(strncmp("forked", "forks", 4)), sign(strncmp("forked", "forks", 5)));
    printf("%d\n", sign(strcmp("", "a")));
    char path[64] = "/usr";
    strcat(strcat(path, "/"), "bin");
    printf("%s\n", path);
    return 0;
}
