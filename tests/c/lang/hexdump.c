/* Looking at the bytes of values through an unsigned char pointer (a little-endian machine). */
#include <stdio.h>

void dump(const char *label, const void *p, unsigned long n) {
    const unsigned char *b = p;
    printf("%-6s", label);
    for (unsigned long i = 0; i < n; i++) printf(" %02x", b[i]);
    printf("\n");
}

int main(void) {
    int i = 0x01020304;
    short s = -2;
    long l = 0x1122334455667788L;
    double d = 1.5;
    char str[] = "OS!";
    struct { char c; int n; } pk = {'A', 258};
    dump("int", &i, sizeof i);
    dump("short", &s, sizeof s);
    dump("long", &l, sizeof l);
    dump("double", &d, sizeof d);
    dump("str", str, sizeof str);
    dump("c", &pk.c, 1);
    dump("n", &pk.n, sizeof pk.n);
    return 0;
}
