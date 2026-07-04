/* Four letters copied into four bytes leave no room for the '\0', so strlen runs off the end. */
// expect: ub oob line 10
#include <stdio.h>
#include <string.h>

int main(void) {
    char word[4];
    char other[8] = "zzzzzzz";
    memcpy(word, "fork", 4);
    printf("%lu\n", strlen(word));
    printf("%s\n", other);
    return 0;
}
