/* A tiny scheduling exercise in C: waiting and turnaround times under FCFS and non-preemptive SJF. */
#include <stdio.h>
#include <string.h>

struct proc { char name[4]; int arrive, burst, start, finish; };

void run(struct proc *p, int n, int sjf) {
    int done[8] = {0}, t = 0;
    for (int k = 0; k < n; k++) {
        int pick = -1;
        for (int i = 0; i < n; i++) {
            if (done[i] || p[i].arrive > t) continue;
            if (pick < 0 || (sjf && p[i].burst < p[pick].burst)) pick = i;
        }
        if (pick < 0) { t++; k--; continue; }
        p[pick].start = t; t += p[pick].burst; p[pick].finish = t; done[pick] = 1;
    }
}

void report(const char *title, struct proc *p, int n) {
    double w = 0, ta = 0;
    printf("%s:", title);
    for (int i = 0; i < n; i++) { printf(" %s[%d-%d]", p[i].name, p[i].start, p[i].finish); w += p[i].start - p[i].arrive; ta += p[i].finish - p[i].arrive; }
    printf("\n  average wait %.2f, average turnaround %.2f\n", w / n, ta / n);
}

int main(void) {
    struct proc base[] = {{"P1", 0, 7}, {"P2", 2, 4}, {"P3", 4, 1}, {"P4", 5, 4}};
    struct proc p[4];
    memcpy(p, base, sizeof base);
    run(p, 4, 0); report("FCFS", p, 4);
    memcpy(p, base, sizeof base);
    run(p, 4, 1); report("SJF", p, 4);
    return 0;
}
