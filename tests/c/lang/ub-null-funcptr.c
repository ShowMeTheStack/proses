/* A handler table entry was never filled in, and calling it calls through NULL. */
// expect: ub null-call line 12
#include <stdio.h>

void on_child(int sig) { printf("child signal %d\n", sig); }

int main(void) {
    void (*handlers[4])(int) = {0};
    handlers[1] = on_child;
    handlers[1](17);
    int sig = 2;
    handlers[sig](sig);
    return 0;
}
