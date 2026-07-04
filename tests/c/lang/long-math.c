/* 64-bit integers: a string hash that overflows unsigned long on purpose, big products, and the limits. */
#include <stdio.h>
#include <limits.h>

unsigned long hash(const char *s) {
    unsigned long h = 5381;
    while (*s)
        h = h * 33 + (unsigned char)*s++;
    return h;
}

int main(void) {
    long big = 3000000000L;
    unsigned long mask = 0xFFFFFFFFFFFFFFFFUL;
    printf("%lu\n", hash("the quick brown fox jumps over the lazy dog"));
    printf("%lu\n", hash("init"));
    printf("%ld %ld\n", big * 3, big * -3);
    printf("%ld %ld\n", LONG_MAX, LONG_MIN);
    printf("%lu %lx\n", mask, mask >> 4);
    printf("%ld %ld\n", (long)1 << 62, ((long)1 << 62) / 7);
    printf("%lu\n", 123456789UL * 987654321UL);
    printf("%ld %ld\n", -9000000000000000000L / 7, -9000000000000000000L % 7);
    printf("%d %u\n", INT_MAX, UINT_MAX);
    printf("%lu\n", (unsigned long)-1 / 3);
    long x = 1;
    for (int i = 0; i < 40; i++) x = x * 3 % 1000000007;
    printf("%ld\n", x);
    return 0;
}
