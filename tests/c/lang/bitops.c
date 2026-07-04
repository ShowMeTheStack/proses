/* Bit operations: permission bits, flag sets, counting bits, extracting fields of a page-table entry. */
#include <stdio.h>

#define R 4
#define W 2
#define X 1
#define PTE_PRESENT 0x1UL
#define PTE_WRITE 0x2UL
#define PTE_USER 0x4UL
#define FRAME_SHIFT 12

void perms(unsigned mode, char out[10]) {
    const char *letters = "rwxrwxrwx";
    for (int i = 0; i < 9; i++) out[i] = (mode >> (8 - i)) & 1 ? letters[i] : '-';
    out[9] = '\0';
}
int popcount(unsigned long x) { int n = 0; while (x) { x &= x - 1; n++; } return n; }

int main(void) {
    char buf[10];
    unsigned modes[] = {0755, 0644, 0600, 0777, 0};
    for (int i = 0; i < 5; i++) { perms(modes[i], buf); printf("%04o %s\n", modes[i], buf); }
    unsigned m = (R | W) << 6 | R << 3 | R;
    printf("%o %d %d\n", m, (m >> 6 & W) != 0, (m & X) != 0);
    unsigned long pte = (0x1a2bUL << FRAME_SHIFT) | PTE_PRESENT | PTE_USER;
    printf("frame %#lx present %lu write %lu user %lu\n", pte >> FRAME_SHIFT, pte & PTE_PRESENT, (pte & PTE_WRITE) >> 1, (pte & PTE_USER) >> 2);
    pte |= PTE_WRITE; pte &= ~PTE_USER;
    printf("%#lx %d\n", pte, popcount(pte));
    unsigned long va = 0x7f3a12345678UL;
    printf("%lu %lu %lu %lu %#lx\n", (va >> 39) & 511, (va >> 30) & 511, (va >> 21) & 511, (va >> 12) & 511, va & 0xfff);
    printf("%d %d\n", popcount(0xffffffffffffffffUL), popcount(0));
    unsigned x = 0x80000000u;
    printf("%u %u\n", x >> 31, x << 1);
    return 0;
}
