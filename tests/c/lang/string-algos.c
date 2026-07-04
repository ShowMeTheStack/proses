/* String work by hand: reverse words in place, check a palindrome, count words, run-length encode. */
#include <stdio.h>
#include <string.h>
#include <ctype.h>

void reverse(char *a, char *b) { while (a < b) { char t = *a; *a++ = *b; *b-- = t; } }
void reverse_words(char *s) {
    reverse(s, s + strlen(s) - 1);
    for (char *w = s; *w; ) {
        while (*w == ' ') w++;
        char *e = w;
        while (*e && *e != ' ') e++;
        if (e > w) reverse(w, e - 1);
        w = e;
    }
}
int palindrome(const char *s) {
    const char *e = s + strlen(s) - 1;
    while (s < e) {
        if (!isalpha((unsigned char)*s)) { s++; continue; }
        if (!isalpha((unsigned char)*e)) { e--; continue; }
        if (tolower((unsigned char)*s++) != tolower((unsigned char)*e--)) return 0;
    }
    return 1;
}
void rle(const char *s, char *out) {
    while (*s) { int n = 1; while (s[n] == s[0]) n++; out += sprintf(out, "%d%c", n, s[0]); s += n; }
}

int main(void) {
    char line[] = "the kernel saves the registers";
    reverse_words(line);
    printf("%s\n", line);
    printf("%d %d\n", palindrome("Never odd or even"), palindrome("fork bomb"));
    char out[64];
    rle("aaabccddddd", out);
    printf("%s\n", out);
    int upper = 0, digits = 0, spaces = 0;
    for (const char *p = "PID 42 is RUNNING on CPU 3"; *p; p++) { upper += isupper(*p) != 0; digits += isdigit(*p) != 0; spaces += isspace(*p) != 0; }
    printf("%d %d %d %c%c\n", upper, digits, spaces, toupper('q'), tolower('Q'));
    return 0;
}
