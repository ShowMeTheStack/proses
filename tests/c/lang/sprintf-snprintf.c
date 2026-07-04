/* sprintf and snprintf: formatting into buffers, truncation and the length snprintf reports. */
#include <stdio.h>
#include <string.h>

int main(void) {
    char buf[64], small[8];
    int n = sprintf(buf, "pid=%d state=%c prio=%02d", 4021, 'R', 7);
    printf("%d [%s]\n", n, buf);
    n = snprintf(small, sizeof small, "%s-%d", "worker", 12345);
    printf("%d [%s] %d\n", n, small, (int)strlen(small));
    n = snprintf(small, 1, "abc");
    printf("%d [%s]\n", n, small);
    n = snprintf(NULL, 0, "%d items at %.2f", 17, 3.5);
    printf("needs %d\n", n);
    char line[32];
    for (int i = 0; i < 3; i++) {
        sprintf(line, "slot[%d]=%*d;", i, 3, i * i * 11);
        printf("%s", line);
    }
    printf("\n");
    sprintf(buf, "%5.1f%%", 99.44);
    puts(buf);
    return 0;
}
