/* A bitmap of free disk blocks: allocate the first free run, free blocks, and count what is left. */
#include <stdio.h>
#include <string.h>

#define NBLOCKS 64
static unsigned char bitmap[NBLOCKS / 8];

int test(int b) { return bitmap[b / 8] >> (b % 8) & 1; }
void set(int b) { bitmap[b / 8] |= 1 << (b % 8); }
void clear(int b) { bitmap[b / 8] &= ~(1 << (b % 8)); }

int alloc_run(int len) {
    for (int start = 0; start + len <= NBLOCKS; start++) {
        int ok = 1;
        for (int i = 0; i < len && ok; i++) if (test(start + i)) ok = 0;
        if (ok) { for (int i = 0; i < len; i++) set(start + i); return start; }
    }
    return -1;
}
int free_count(void) { int n = 0; for (int b = 0; b < NBLOCKS; b++) n += !test(b); return n; }

int main(void) {
    memset(bitmap, 0, sizeof bitmap);
    int a = alloc_run(10), b = alloc_run(5), c = alloc_run(20);
    printf("%d %d %d free %d\n", a, b, c, free_count());
    for (int i = 0; i < 5; i++) clear(b + i);
    int d = alloc_run(3), e = alloc_run(4), f = alloc_run(40);
    printf("%d %d %d free %d\n", d, e, f, free_count());
    for (int i = 0; i < 8; i++) printf("%02x", bitmap[i]);
    printf("\n");
    return 0;
}
