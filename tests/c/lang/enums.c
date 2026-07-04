/* Enums: default and given values, enums in switches, and arithmetic on them. */
#include <stdio.h>

enum sig { HUP = 1, INTR, QUIT, KILL = 9, USR1, TERM = 15 };
enum dir { NORTH, EAST, SOUTH, WEST, NDIRS };
typedef enum { LOW = -1, MID, HIGH = 10 } level;

const char *name(enum sig s) {
    switch (s) {
    case HUP: return "hangup";
    case INTR: return "interrupt";
    case QUIT: return "quit";
    case KILL: return "kill";
    case TERM: return "terminate";
    default: return "other";
    }
}

int main(void) {
    printf("%d %d %d %d %d\n", HUP, INTR, QUIT, KILL, USR1);
    for (enum sig s = HUP; s <= TERM; s++)
        if (s < 4 || s == KILL || s == TERM || s == USR1)
            printf("%d:%s ", s, name(s));
    printf("\n");
    enum dir d = WEST;
    d = (d + 1) % NDIRS;
    printf("%d %d\n", d, NDIRS);
    level l = LOW;
    printf("%d %d %d %lu\n", l, MID, HIGH, sizeof(level));
    int counts[NDIRS] = {0};
    counts[SOUTH] = 3;
    printf("%d\n", counts[2]);
    return 0;
}
