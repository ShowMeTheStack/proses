/* find falls off its end without a return when the key is missing, and the caller uses the result. */
// expect: ub noret line 14
#include <stdio.h>

int find(const int *v, int n, int key) {
    for (int i = 0; i < n; i++)
        if (v[i] == key)
            return i;
}

int main(void) {
    int pids[3] = {7, 8, 9};
    printf("%d\n", find(pids, 3, 8));
    int at = find(pids, 3, 5);
    printf("%d\n", at);
    return 0;
}
