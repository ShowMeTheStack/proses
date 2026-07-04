/* A function returns the address of its own local buffer, which is gone when it returns. */
// expect: warn ret-local line 10
// expect: ub dead-stack line 15
#include <stdio.h>
#include <string.h>

char *label(int pid) {
    char buf[16];
    sprintf(buf, "proc-%d", pid);
    return buf;
}

int main(void) {
    char *s = label(42);
    printf("%c\n", s[0]);
    return 0;
}
