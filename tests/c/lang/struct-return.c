/* Structs holding arrays, returned by value through several calls, and compared member by member. */
#include <stdio.h>

struct regs { unsigned long pc, sp; long r[4]; };

struct regs save(unsigned long pc, unsigned long sp) {
    struct regs c = {pc, sp, {0}};
    for (int i = 0; i < 4; i++) c.r[i] = (long)pc * (i + 1);
    return c;
}
struct regs bump(struct regs c) { c.pc += 4; c.r[3] = -1; return c; }
int same(const struct regs *a, const struct regs *b) {
    if (a->pc != b->pc || a->sp != b->sp) return 0;
    for (int i = 0; i < 4; i++) if (a->r[i] != b->r[i]) return 0;
    return 1;
}

int main(void) {
    struct regs a = save(0x400, 0x7ff0);
    struct regs b = bump(bump(a));
    printf("%#lx %#lx %ld %ld\n", b.pc, b.sp, b.r[1], b.r[3]);
    printf("%d %d\n", same(&a, &b), same(&a, &a));
    printf("%lu\n", save(1, 2).r[2]);
    struct regs ctx[2];
    ctx[0] = a; ctx[1] = b;
    ctx[0] = ctx[1];
    printf("%d\n", same(&ctx[0], &b));
    return 0;
}
