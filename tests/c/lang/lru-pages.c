/* Page replacement with LRU and FIFO on a reference string, counting faults per frame count. */
#include <stdio.h>

int faults(const int *ref, int n, int frames, int lru) {
    int page[8], stamp[8], used = 0, f = 0, clock = 0;
    for (int i = 0; i < n; i++) {
        int hit = -1;
        for (int j = 0; j < used; j++) if (page[j] == ref[i]) hit = j;
        clock++;
        if (hit >= 0) { if (lru) stamp[hit] = clock; continue; }
        f++;
        if (used < frames) { page[used] = ref[i]; stamp[used] = clock; used++; continue; }
        int victim = 0;
        for (int j = 1; j < used; j++) if (stamp[j] < stamp[victim]) victim = j;
        page[victim] = ref[i]; stamp[victim] = clock;
    }
    return f;
}

int main(void) {
    int ref[] = {1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5};
    int n = sizeof ref / sizeof ref[0];
    for (int frames = 1; frames <= 5; frames++)
        printf("%d frames: FIFO %2d LRU %2d\n", frames, faults(ref, n, frames, 0), faults(ref, n, frames, 1));
    return 0;
}
