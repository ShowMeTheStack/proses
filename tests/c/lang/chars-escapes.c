/* Characters: escapes, octal and hex codes, char arithmetic and signedness. */
#include <stdio.h>

int main(void) {
    char tab = '\t', nl = '\n', q = '\'', dq = '"', bs = '\\';
    char oct = '\101', hx = '\x42', zero = '\0';
    char word[] = "a\tb\\c\"d\'e\x41\102";
    printf("%d %d %d %d %d\n", tab, nl, q, dq, bs);
    printf("%c%c %d\n", oct, hx, zero);
    printf("[%s] %d\n", word, (int)sizeof(word));
    printf("%c%c%c\n", 'a' + 1, 'z' - 25, '0' + 7);
    char c = '\xff';
    unsigned char d = '\xff';
    printf("%d %d %d\n", c, d, c == d);
    printf("%d\n", 'A' < 'a');
    for (char x = 'a'; x <= 'e'; x++)
        putchar(x - 32);
    putchar('\n');
    printf("bell\a? no: %d\n", '\a');
    return 0;
}
