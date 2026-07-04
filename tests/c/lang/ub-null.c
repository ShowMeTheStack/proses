/* Walking one step too far down a list reaches NULL, and the next member access dereferences it. */
// expect: ub null line 14
#include <stdio.h>
#include <stddef.h>

struct node { int pid; struct node *next; };

int main(void) {
    struct node c = {3, NULL}, b = {2, &c}, a = {1, &b};
    struct node *p = &a;
    int i;
    for (i = 0; i < 3; i++)
        p = p->next;
    printf("%d\n", p->pid);
    return 0;
}
