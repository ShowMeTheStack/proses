/* No processes: pointers, arrays, strings, recursion, integer arithmetic and printf's formats. */
#include <stdio.h>
#include <string.h>

#define N 6

long fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

int sum(int *a, int n) {
    int s = 0, *p;
    for (p = a; p < a + n; p++)
        s += *p;
    return s;
}

void reverse(char *s) {
    char *e = s + strlen(s) - 1;
    while (s < e) {
        char t = *s;
        *s++ = *e;
        *e-- = t;
    }
}

int main(void) {
    int a[N] = {3, 1, 4, 1, 5, 9};
    char name[16] = "process";
    unsigned int u = 0;
    char c = 200;
    int i;
    reverse(name);
    printf("sum %d, fib %ld, %s\n", sum(a, N), fib(20), name);
    printf("[%5d] [%-5d] [%05d] [%x] [%X] [%o] [%+d]\n", 42, 42, 42, 255, 255, 8, 7);
    printf("%u %d %d %d\n", u - 1, c, -7 / 2, -7 % 2);
    printf("%ld %c%c %s %.3s|%6s|\n", (long)1 << 40, 'o', 'k', "str", "abcdef", "ab");
    for (i = 0; i < N; i += 2)
        a[i] = a[i] * a[i + 1];
    printf("%d %d %d %lu\n", a[0], a[2], a[4], sizeof(a));
    return 0;
}
