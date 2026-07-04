/* atoi, atol and strtol with bases and the end pointer. */
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    printf("%d %d %d %d\n", atoi("42"), atoi("  -17xyz"), atoi("+8"), atoi("abc"));
    printf("%ld\n", atol("1234567890123"));
    char *end;
    long v = strtol("0x1f rest", &end, 16);
    printf("%ld [%s]\n", v, end);
    v = strtol("0755", &end, 0);
    printf("%ld [%s]\n", v, end);
    v = strtol("0x10", &end, 0);
    printf("%ld [%s]\n", v, end);
    v = strtol("  -1010b", &end, 2);
    printf("%ld [%s]\n", v, end);
    v = strtol("zz", &end, 36);
    printf("%ld [%s]\n", v, end);
    const char *nums = "10 20 30 x";
    const char *p = nums;
    long sum = 0;
    for (;;) {
        char *q;
        long x = strtol(p, &q, 10);
        if (q == p) break;
        sum += x;
        p = q;
    }
    printf("sum %ld, stopped at [%s]\n", sum, p);
    printf("%lu\n", strtoul("4294967296", NULL, 10));
    return 0;
}
