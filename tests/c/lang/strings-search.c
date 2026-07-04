/* Searching strings: strchr, strrchr, strstr, strspn, strcspn, strpbrk. */
#include <stdio.h>
#include <string.h>

int main(void) {
    const char *path = "/home/user/notes/os.txt";
    const char *slash = strrchr(path, '/');
    const char *dot = strchr(path, '.');
    printf("%s %s %ld\n", slash + 1, dot, (long)(dot - path));
    printf("%s\n", strstr(path, "user"));
    printf("%d\n", strstr(path, "root") == NULL);
    printf("%lu %lu\n", strspn("   indent", " "), strcspn("key=value", "="));
    printf("%s\n", strpbrk("ls -l | wc", "|<>"));
    printf("%d\n", strchr("abc", '\0') - "abc" >= 0);
    const char *s = "a,b,,c";
    int commas = 0;
    for (const char *p = strchr(s, ','); p; p = strchr(p + 1, ','))
        commas++;
    printf("%d\n", commas);
    printf("[%s]\n", strstr("anything", ""));
    return 0;
}
