/* A dispatch table of function pointers, callbacks and functions returning function pointers. */
#include <stdio.h>
#include <string.h>

static int calls;
int do_open(const char *a) { calls++; return printf("open %s\n", a); }
int do_close(const char *a) { calls++; return printf("close %s\n", a); }
int do_read(const char *a) { calls++; return printf("read %s\n", a); }

struct cmd { const char *name; int (*fn)(const char *); };
static struct cmd table[] = { {"open", do_open}, {"close", do_close}, {"read", do_read} };

int (*lookup(const char *name))(const char *) {
    for (unsigned i = 0; i < sizeof table / sizeof table[0]; i++)
        if (strcmp(table[i].name, name) == 0) return table[i].fn;
    return NULL;
}

void each(int *v, int n, void (*f)(int *)) { for (int i = 0; i < n; i++) f(&v[i]); }
void twice(int *x) { *x *= 2; }

int main(void) {
    const char *script[] = {"open", "read", "write", "close"};
    for (int i = 0; i < 4; i++) {
        int (*f)(const char *) = lookup(script[i]);
        if (f) f("log.txt");
        else printf("no command %s\n", script[i]);
    }
    printf("%d calls\n", calls);
    int v[4] = {1, 2, 3, 4};
    each(v, 4, twice);
    printf("%d %d %d %d\n", v[0], v[1], v[2], v[3]);
    printf("%d\n", (*table[1].fn)("again") > 0);
    return 0;
}
