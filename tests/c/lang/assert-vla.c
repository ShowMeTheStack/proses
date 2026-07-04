/* assert that holds, and variable-length arrays sized at run time. */
#include <stdio.h>
#include <assert.h>

int sum_squares(int n) {
    int v[n];
    for (int i = 0; i < n; i++) v[i] = i * i;
    int s = 0;
    for (int i = 0; i < n; i++) s += v[i];
    assert(sizeof v == n * sizeof(int));
    return s;
}

int main(void) {
    for (int n = 1; n <= 5; n++) printf("%d ", sum_squares(n));
    printf("\n");
    int frames = 3;
    char used[frames + 1];
    for (int i = 0; i < frames; i++) used[i] = 'a' + i;
    used[frames] = '\0';
    printf("%s %lu\n", used, sizeof used);
    assert(frames == 3);
    assert(used[0] == 'a' && "frames start at a");
    printf("asserts hold\n");
    return 0;
}
