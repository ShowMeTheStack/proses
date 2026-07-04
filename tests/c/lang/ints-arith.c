/* Integer arithmetic: division and remainder of negatives, unsigned wrap-around, shifts, narrowing casts. */
#include <stdio.h>

int main(void) {
    int a = -17, b = 5;
    unsigned int u = 3;
    short s = 30000;
    unsigned char uc = 250;
    signed char sc = -3;
    printf("%d %d %d %d\n", a / b, a % b, -a / b, a % -b);
    printf("%u %u\n", u - 5, 0u - 1);
    printf("%d %d\n", s + s, (short)(s + s));
    printf("%d %d\n", uc + 10, (unsigned char)(uc + 10));
    printf("%d %u\n", sc, (unsigned char)sc);
    printf("%d %d %d\n", 1 << 10, -16 >> 2, 255 >> 3);
    printf("%u %d %d\n", (unsigned)-1 >> 28, (int)(3.99), (int)-3.99);
    printf("%d %d\n", 7 & 3, 7 | 8);
    printf("%d %d %d\n", (int)(char)200, (int)(unsigned short)-1, (int)(short)70000);
    printf("%d\n", 10 - 3 * 2 + 8 / 4 % 3);
    return 0;
}
