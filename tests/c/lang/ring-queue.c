/* A ready queue as a ring buffer inside a struct, used for a round-robin schedule. */
#include <stdio.h>

#define CAP 8
struct queue { int items[CAP]; int head, tail, count; };

int put(struct queue *q, int x) { if (q->count == CAP) return 0; q->items[q->tail] = x; q->tail = (q->tail + 1) % CAP; q->count++; return 1; }
int get(struct queue *q, int *x) { if (!q->count) return 0; *x = q->items[q->head]; q->head = (q->head + 1) % CAP; q->count--; return 1; }

int main(void) {
    struct queue rq = {{0}, 0, 0, 0};
    int left[4] = {5, 3, 1, 6};
    int quantum = 2, t = 0, done[4];
    for (int p = 0; p < 4; p++) put(&rq, p);
    int p;
    while (get(&rq, &p)) {
        int run = left[p] < quantum ? left[p] : quantum;
        t += run; left[p] -= run;
        printf("t=%2d P%d ran %d\n", t, p, run);
        if (left[p]) put(&rq, p); else done[p] = t;
    }
    for (p = 0; p < 4; p++) printf("P%d finishes at %d\n", p, done[p]);
    return 0;
}
