/* Two owners each free the same buffer. */
// expect: ub double-free line 13
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    char *buf = malloc(32);
    char *alias = buf;
    strcpy(buf, "shared");
    printf("%s\n", alias);
    free(buf);
    free(alias);
    return 0;
}
