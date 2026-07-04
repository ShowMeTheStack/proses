/* switch with fall-through and default, do-while, break and continue, goto out of nested loops. */
#include <stdio.h>

int classify(int c) {
    switch (c) {
    case ' ': case '\t': case '\n': return 0;
    case '0': case '1': case '2': case '3': case '4':
    case '5': case '6': case '7': case '8': case '9': return 1;
    case '|': case '<': case '>': case '&': return 2;
    default: return 3;
    }
}

int main(void) {
    const char *line = "ls -l 2> err | wc &";
    int counts[4] = {0};
    for (const char *p = line; *p; p++) counts[classify(*p)]++;
    printf("%d %d %d %d\n", counts[0], counts[1], counts[2], counts[3]);
    int n = 0;
    switch (3) {
    case 1: n += 1;
    case 3: n += 3;
    case 4: n += 4;
        break;
    case 5: n += 5;
    }
    printf("%d\n", n);
    int i = 10;
    do { i -= 3; } while (i > 0);
    printf("%d\n", i);
    int s = 0;
    for (int k = 0; k < 20; k++) {
        if (k % 2) continue;
        if (k > 12) break;
        s += k;
    }
    printf("%d\n", s);
    int found = -1;
    for (int r = 0; r < 5; r++)
        for (int c = 0; c < 5; c++)
            if (r * c == 12) { found = r * 10 + c; goto done; }
done:
    printf("%d\n", found);
    int w = 0;
    while (1) { if (++w == 4) break; }
    printf("%d\n", w);
    switch (7) { default: printf("default only\n"); }
    return 0;
}
