/* Integer promotions and the usual arithmetic conversions, including the signed/unsigned traps. */
#include <stdio.h>

int main(void) {
    unsigned char a = 200, b = 100;
    printf("%d\n", a + b);
    unsigned int u = 1;
    int i = -1;
    printf("%d %d\n", i < u, i < (int)u);
    long l = -1;
    printf("%d\n", l < u);
    unsigned short us = 65535;
    printf("%d\n", us + 1);
    char c = -1;
    unsigned int cu = c;
    printf("%u %d\n", cu, (unsigned char)c);
    printf("%lu\n", sizeof(a + b));
    printf("%lu %lu\n", sizeof('x'), sizeof((char)'x'));
    short s1 = 200, s2 = 300;
    int prod = s1 * s2;
    printf("%d\n", prod);
    unsigned x = 3;
    printf("%u %d\n", x - 5, (int)(x - 5));
    int neg = -7;
    printf("%u %ld\n", (unsigned)neg, (long)(unsigned)neg);
    printf("%d\n", -3 / 2 + (-3 % 2));
    return 0;
}
