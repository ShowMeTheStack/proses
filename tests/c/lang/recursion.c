/* Recursion: factorial, Fibonacci, the Towers of Hanoi's move count, Ackermann's function, and mutual recursion. */
#include <stdio.h>

long fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
long hanoi(int n, char from, char to, char via) {
    if (n == 0) return 0;
    return hanoi(n - 1, from, via, to) + 1 + hanoi(n - 1, via, to, from);
}
int ack(int m, int n) {
    if (m == 0) return n + 1;
    if (n == 0) return ack(m - 1, 1);
    return ack(m - 1, ack(m, n - 1));
}
int is_odd(int n);
int is_even(int n) { return n == 0 ? 1 : is_odd(n - 1); }
int is_odd(int n) { return n == 0 ? 0 : is_even(n - 1); }
int digits(unsigned long x) { return x < 10 ? 1 : 1 + digits(x / 10); }

int main(void) {
    printf("%ld %ld\n", fact(10), fact(20));
    printf("%d\n", fib(22));
    printf("%ld\n", hanoi(12, 'A', 'C', 'B'));
    printf("%d %d\n", ack(2, 3), ack(3, 3));
    printf("%d %d\n", is_even(17), is_odd(17));
    printf("%d\n", digits(18446744073709551615UL));
    return 0;
}
