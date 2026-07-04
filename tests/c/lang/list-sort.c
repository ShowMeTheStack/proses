/* Merge sort on a linked list of heap nodes, then a search and cleanup. */
#include <stdio.h>
#include <stdlib.h>

struct item { int key; struct item *next; };

struct item *merge(struct item *a, struct item *b) {
    struct item head = {0, NULL}, *t = &head;
    while (a && b) { if (a->key <= b->key) { t->next = a; a = a->next; } else { t->next = b; b = b->next; } t = t->next; }
    t->next = a ? a : b;
    return head.next;
}
struct item *msort(struct item *h) {
    if (!h || !h->next) return h;
    struct item *slow = h, *fast = h->next;
    while (fast && fast->next) { slow = slow->next; fast = fast->next->next; }
    struct item *right = slow->next;
    slow->next = NULL;
    return merge(msort(h), msort(right));
}

int main(void) {
    int keys[] = {29, 3, 17, 8, 42, 1, 23, 15, 4};
    struct item *h = NULL;
    for (int i = 0; i < 9; i++) { struct item *n = malloc(sizeof *n); n->key = keys[i]; n->next = h; h = n; }
    h = msort(h);
    for (struct item *p = h; p; p = p->next) printf("%d ", p->key);
    printf("\n");
    while (h) { struct item *n = h->next; free(h); h = n; }
    return 0;
}
