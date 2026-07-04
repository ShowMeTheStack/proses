/* Compound assignment, the comma operator, the ternary operator, increments in expressions. */
#include <stdio.h>

int main(void) {
    int x = 100;
    x += 5; printf("%d ", x);
    x -= 15; printf("%d ", x);
    x *= 3; printf("%d ", x);
    x /= 7; printf("%d ", x);
    x %= 10; printf("%d ", x);
    x <<= 4; printf("%d ", x);
    x >>= 2; printf("%d ", x);
    x &= 0x1c; printf("%d ", x);
    x |= 0x101; printf("%d ", x);
    x ^= 0xff; printf("%d\n", x);
    unsigned char c = 250;
    c += 10; printf("%d ", c);
    char sc = 120;
    sc += 10; printf("%d ", sc);
    double d = 1.5;
    d *= 4; d -= 0.5; printf("%.2f\n", d);
    int i = 0, j = (i++, i++, i * 10);
    printf("%d %d\n", i, j);
    int k = 5;
    int r = k++;
    r += ++k;
    printf("%d %d\n", k, r);
    int a = 3, b = 9;
    int max = a > b ? a : b, min = a < b ? a : b;
    const char *sign = a - b > 0 ? "pos" : a - b < 0 ? "neg" : "zero";
    printf("%d %d %s\n", max, min, sign);
    int arr[4] = {0}, idx = 0;
    arr[idx++] = 7; arr[idx++] = 8;
    printf("%d %d %d\n", arr[0], arr[1], idx);
    long l = 10; l *= l; l += l;
    printf("%ld\n", l);
    int *p = arr; *p++ += 1; *p += 100;
    printf("%d %d\n", arr[0], arr[1]);
    return 0;
}
