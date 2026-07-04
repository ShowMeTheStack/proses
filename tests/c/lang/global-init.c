/* Globals initialised with constants, addresses of other globals, strings and function pointers. */
#include <stdio.h>

int limit = 4 * 1024;
int counts[5] = {1, 1, 2, 3, 5};
int *third = &counts[2];
const char *banner = "kernel v" "0.1";
char version[] = "0.1";
double ratio = 1.0 / 8;
struct node { int id; struct node *next; };
struct node n3 = {3, 0}, n2 = {2, &n3}, n1 = {1, &n2};
struct node *head = &n1;
int square(int x) { return x * x; }
int (*op)(int) = square;
const char *states[] = {"ready", "running", "blocked"};
long big = 1L << 40;
unsigned char mask = (unsigned char)~0x0f;
int uninit_global;

int main(void) {
    printf("%d %d %d\n", limit, *third, counts[4]);
    printf("%s %s %.3f\n", banner, version, ratio);
    for (struct node *p = head; p; p = p->next) printf("%d ", p->id);
    printf("\n%d %s %ld %u %d\n", op(9), states[1], big, mask, uninit_global);
    *third = 20;
    printf("%d\n", counts[2]);
    return 0;
}
