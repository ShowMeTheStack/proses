/* free is given the address of a local array, which malloc never allocated. */
// expect: ub bad-free line 10
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    char name[16] = "local";
    char *p = name;
    printf("%s\n", p);
    free(p);
    return 0;
}
