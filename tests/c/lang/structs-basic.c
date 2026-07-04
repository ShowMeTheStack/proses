/* A process control block as a struct: members with . and ->, assignment copies, passing and returning by value. */
#include <stdio.h>
#include <string.h>

enum state { NEW, READY, RUNNING, BLOCKED, ZOMBIE };

struct pcb {
    int pid;
    enum state state;
    int priority;
    char name[16];
    long cpu_time;
};

const char *state_name(enum state s) {
    static const char *names[] = {"new", "ready", "running", "blocked", "zombie"};
    return names[s];
}

struct pcb make(int pid, const char *name) {
    struct pcb p;
    p.pid = pid;
    p.state = NEW;
    p.priority = 20;
    strcpy(p.name, name);
    p.cpu_time = 0;
    return p;
}

void run_for(struct pcb *p, long ticks) {
    p->state = RUNNING;
    p->cpu_time += ticks;
}

int older(struct pcb a, struct pcb b) { return a.pid < b.pid; }

int main(void) {
    struct pcb a = make(101, "editor");
    struct pcb b = a;
    b.pid = 102;
    strcpy(b.name, "compiler");
    run_for(&b, 40);
    run_for(&b, 2);
    printf("%d %s %s %ld\n", a.pid, a.name, state_name(a.state), a.cpu_time);
    printf("%d %s %s %ld\n", b.pid, b.name, state_name(b.state), b.cpu_time);
    printf("%d %d\n", older(a, b), older(b, a));
    struct pcb *p = &a;
    p->priority -= 5;
    (*p).state = READY;
    printf("%d %s\n", a.priority, state_name(p->state));
    struct pcb table[3] = {make(1, "init"), make(2, "sh"), make(3, "cron")};
    table[2].state = ZOMBIE;
    for (int i = 0; i < 3; i++)
        printf("[%d %s %s]", table[i].pid, table[i].name, state_name(table[i].state));
    printf("\n");
    return 0;
}
