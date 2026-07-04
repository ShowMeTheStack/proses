/* sscanf: reading numbers and words out of a line of text. */
#include <stdio.h>

int main(void) {
    int pid, prio;
    char state;
    char name[16];
    int n = sscanf("pid=4021 state=R prio=-3 cmd=make", "pid=%d state=%c prio=%d cmd=%15s", &pid, &state, &prio, name);
    printf("%d: %d %c %d %s\n", n, pid, state, prio, name);
    unsigned addr;
    double load;
    n = sscanf("0x7f00 1.25", "%x %lf", &addr, &load);
    printf("%d: %u %.2f\n", n, addr, load);
    int a = -1, b = -1;
    n = sscanf("12 abc", "%d %d", &a, &b);
    printf("%d: %d %d\n", n, a, b);
    char word[8], rest[32];
    n = sscanf("  first   second third", "%7s %[^\n]", word, rest);
    printf("%d: [%s] [%s]\n", n, word, rest);
    long big;
    n = sscanf("9000000000", "%ld", &big);
    printf("%d: %ld\n", n, big);
    return 0;
}
