/* _Bool and <stdbool.h>, const variables and pointers, volatile accepted. */
#include <stdio.h>
#include <stdbool.h>

bool is_power_of_two(unsigned long x) { return x && !(x & (x - 1)); }

int main(void) {
    bool flags[4] = {true, false, 5, 0.0};
    printf("%d %d %d %d %lu\n", flags[0], flags[1], flags[2], flags[3], sizeof(bool));
    _Bool b = 256;
    printf("%d\n", b);
    int ok = 0;
    for (unsigned long x = 1; x < 70; x++) ok += is_power_of_two(x);
    printf("%d\n", ok);
    const int max_proc = 64;
    const char *msg = "read-only text";
    char *const fixed = (char *)"x";
    volatile int ticks = 0;
    for (int i = 0; i < 5; i++) ticks++;
    printf("%d %s %d %c\n", max_proc, msg, ticks, *fixed);
    const struct { int a, b; } pair = {1, 2};
    printf("%d\n", pair.a + pair.b);
    bool done = false;
    done = !done;
    printf("%s\n", done ? "true" : "false");
    return 0;
}
