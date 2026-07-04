/* Unions: one storage for several types, sizes, and reading the bytes of an int (little-endian). */
#include <stdio.h>

union word {
    unsigned int u;
    unsigned char b[4];
    short s[2];
};

struct msg {
    int kind;
    union { int code; double ratio; char text[12]; } body;
};

int main(void) {
    union word w;
    w.u = 0x11223344;
    printf("%02x %02x %02x %02x\n", w.b[0], w.b[1], w.b[2], w.b[3]);
    printf("%x %x\n", w.s[0], w.s[1]);
    w.b[3] = 0xff;
    printf("%x\n", w.u);
    printf("%lu %lu\n", sizeof(union word), sizeof(struct msg));
    struct msg m[2];
    m[0].kind = 1; m[0].body.code = 404;
    m[1].kind = 2; m[1].body.ratio = 0.75;
    for (int i = 0; i < 2; i++) {
        if (m[i].kind == 1) printf("code %d\n", m[i].body.code);
        else printf("ratio %.2f\n", m[i].body.ratio);
    }
    union { float f; unsigned int bits; } fb;
    fb.f = 1.0f;
    printf("%08x\n", fb.bits);
    return 0;
}
