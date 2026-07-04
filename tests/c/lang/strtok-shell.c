/* Splitting a command line into words with strtok, the way a tiny shell does. */
#include <stdio.h>
#include <string.h>

int split(char *line, char *argv[], int max) {
    int n = 0;
    for (char *w = strtok(line, " \t"); w && n < max - 1; w = strtok(NULL, " \t"))
        argv[n++] = w;
    argv[n] = NULL;
    return n;
}

int main(void) {
    char line[] = "  grep -n  main\tsched.c   ";
    char *argv[8];
    int n = split(line, argv, 8);
    printf("%d words\n", n);
    for (int i = 0; argv[i]; i++)
        printf("argv[%d] = \"%s\"\n", i, argv[i]);
    char pipeline[] = "cat f|sort|uniq -c";
    char *stage = strtok(pipeline, "|");
    while (stage) {
        printf("stage: %s\n", stage);
        stage = strtok(NULL, "|");
    }
    char empty[] = ";;;";
    printf("%d\n", strtok(empty, ";") == NULL);
    return 0;
}
