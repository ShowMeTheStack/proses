/* typedef for structs, pointers, arrays and function pointers. */
#include <stdio.h>

typedef unsigned long addr_t;
typedef struct frame { addr_t number; int dirty; struct frame *next; } frame_t;
typedef frame_t *frame_ptr;
typedef int vec3[3];
typedef int (*binop)(int, int);
typedef void handler_t(int);

int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }
void report(int s) { printf("signal %d handled\n", s); }

int fold(const int *v, int n, binop f, int start) {
    for (int i = 0; i < n; i++) start = f(start, v[i]);
    return start;
}

int main(void) {
    frame_t f2 = {7, 0, NULL}, f1 = {3, 1, &f2};
    frame_ptr p = &f1;
    while (p) { printf("frame %lu dirty %d\n", p->number, p->dirty); p = p->next; }
    vec3 v = {2, 3, 4};
    printf("%d %d %lu\n", fold(v, 3, add, 0), fold(v, 3, mul, 1), sizeof(vec3));
    binop ops[2] = {add, mul};
    printf("%d %d\n", ops[0](6, 7), ops[1](6, 7));
    handler_t *h = report;
    h(2);
    addr_t a = 0x7fffffffe000UL;
    printf("%lx\n", a >> 12);
    return 0;
}
