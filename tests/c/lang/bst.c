/* A binary search tree: insert, search, in-order walk, height, and freeing it all. */
#include <stdio.h>
#include <stdlib.h>

typedef struct tnode { int key; struct tnode *left, *right; } tnode;

tnode *insert(tnode *t, int key) {
    if (!t) { t = malloc(sizeof *t); t->key = key; t->left = t->right = NULL; return t; }
    if (key < t->key) t->left = insert(t->left, key);
    else if (key > t->key) t->right = insert(t->right, key);
    return t;
}
int contains(const tnode *t, int key) {
    while (t) { if (key == t->key) return 1; t = key < t->key ? t->left : t->right; }
    return 0;
}
void inorder(const tnode *t) { if (!t) return; inorder(t->left); printf("%d ", t->key); inorder(t->right); }
int height(const tnode *t) { if (!t) return 0; int a = height(t->left), b = height(t->right); return 1 + (a > b ? a : b); }
int destroy(tnode *t) { if (!t) return 0; int n = destroy(t->left) + destroy(t->right) + 1; free(t); return n; }

int main(void) {
    int keys[] = {50, 30, 70, 20, 40, 60, 80, 35, 45, 65, 30};
    tnode *root = NULL;
    for (unsigned i = 0; i < sizeof keys / sizeof keys[0]; i++) root = insert(root, keys[i]);
    inorder(root);
    printf("\nheight %d, has 45: %d, has 55: %d\n", height(root), contains(root, 45), contains(root, 55));
    printf("freed %d nodes\n", destroy(root));
    return 0;
}
