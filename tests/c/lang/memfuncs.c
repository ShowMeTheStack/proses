/* memcpy, memmove (with overlap), memset, memcmp and memchr on bytes and on structs. */
#include <stdio.h>
#include <string.h>

struct entry { int fd; char name[12]; };

int sign(int x) { return (x > 0) - (x < 0); }

int main(void) {
    char buf[16] = "abcdefghij";
    memmove(buf + 2, buf, 5);
    printf("%s\n", buf);
    memmove(buf, buf + 3, 4);
    printf("%s\n", buf);
    int a[6] = {1, 2, 3, 4, 5, 6}, b[6];
    memcpy(b, a, sizeof a);
    memset(a, 0, 3 * sizeof(int));
    for (int i = 0; i < 6; i++) printf("%d%d ", a[i], b[i]);
    printf("\n");
    struct entry e1 = {3, "pipe"}, e2;
    memcpy(&e2, &e1, sizeof e1);
    printf("%d %s %d\n", e2.fd, e2.name, memcmp(&e1, &e2, sizeof e1));
    printf("%d %d\n", sign(memcmp("abcd", "abce", 4)), memcmp("abcd", "abce", 3));
    const char *s = "key:value";
    char *colon = memchr(s, ':', 9);
    printf("%ld\n", (long)(colon - s));
    unsigned char bytes[4];
    memset(bytes, 0xAB, 4);
    printf("%02x%02x%02x%02x\n", bytes[0], bytes[1], bytes[2], bytes[3]);
    return 0;
}
