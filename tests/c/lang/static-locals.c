/* static locals keep their value between calls; static globals are private to the file. */
#include <stdio.h>

static int next_pid = 100;

int alloc_pid(void) { return next_pid++; }

int counter(void) {
    static int n = 0;
    return ++n;
}

const char *ticket(void) {
    static char buf[16];
    static int seq;
    sprintf(buf, "T%03d", ++seq);
    return buf;
}

int fib_memo(int k) {
    static long memo[50];
    if (k < 2) return k;
    if (memo[k]) return memo[k];
    return memo[k] = fib_memo(k - 1) + fib_memo(k - 2);
}

int main(void) {
    for (int i = 0; i < 3; i++) printf("%d ", counter());
    int a = alloc_pid(), b = alloc_pid(), c = alloc_pid();
    printf("\n%d %d %d\n", a, b, c);
    printf("%s ", ticket());
    printf("%s\n", ticket());
    printf("%d\n", fib_memo(40));
    return 0;
}
