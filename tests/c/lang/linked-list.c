/* A linked list on the heap: push, append, reverse, remove, and free every node. */
#include <stdio.h>
#include <stdlib.h>

struct node { int pid; struct node *next; };

struct node *push(struct node *head, int pid) {
    struct node *n = malloc(sizeof *n);
    n->pid = pid;
    n->next = head;
    return n;
}
void append(struct node **head, int pid) {
    while (*head) head = &(*head)->next;
    *head = malloc(sizeof(struct node));
    (*head)->pid = pid;
    (*head)->next = NULL;
}
struct node *reverse(struct node *h) {
    struct node *prev = NULL;
    while (h) { struct node *next = h->next; h->next = prev; prev = h; h = next; }
    return prev;
}
void remove_pid(struct node **h, int pid) {
    for (; *h; h = &(*h)->next)
        if ((*h)->pid == pid) { struct node *dead = *h; *h = dead->next; free(dead); return; }
}
void print(const struct node *h) { for (; h; h = h->next) printf("%d ", h->pid); printf("\n"); }

int main(void) {
    struct node *list = NULL;
    for (int i = 1; i <= 4; i++) list = push(list, 100 + i);
    append(&list, 200);
    print(list);
    list = reverse(list);
    print(list);
    remove_pid(&list, 102);
    remove_pid(&list, 200);
    remove_pid(&list, 999);
    print(list);
    int n = 0;
    while (list) { struct node *next = list->next; free(list); list = next; n++; }
    printf("freed %d\n", n);
    return 0;
}
