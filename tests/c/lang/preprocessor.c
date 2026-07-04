/* The preprocessor: function-like macros (with the usual bracket traps), #if arithmetic, defined(), # and ##. */
#include <stdio.h>
#include <stdlib.h>

#define PAGE_SHIFT 12
#define PAGE_SIZE (1 << PAGE_SHIFT)
#define PAGES(bytes) (((bytes) + PAGE_SIZE - 1) / PAGE_SIZE)
#define BAD_SQUARE(x) x * x
#define SQUARE(x) ((x) * (x))
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define STR(x) #x
#define XSTR(x) STR(x)
#define FIELD(name) int name##_count
#define SWAP(t, a, b) do { t tmp_ = (a); (a) = (b); (b) = tmp_; } while (0)
#define LEVELS 4
#define DEBUG 0

struct stats { FIELD(fork); FIELD(exec); };

#if LEVELS * 9 + PAGE_SHIFT == 48
const char *mode = "four-level, 48-bit";
#elif LEVELS == 5
const char *mode = "five-level";
#else
const char *mode = "other";
#endif

#if defined(DEBUG) && DEBUG
#define LOG(msg) printf("debug: %s\n", msg)
#else
#define LOG(msg) ((void)0)
#endif

#ifndef NCPU
#define NCPU 2
#endif

#ifdef NCPU
int cpus = NCPU;
#endif

#undef DEBUG
#if !defined(DEBUG) && (1 << 3) == 8 && 7 / 2 == 3 && -1 < 0 && (10 % 4) == 2
int arithmetic_ok = 1;
#else
int arithmetic_ok = 0;
#endif

int main(void) {
    printf("%d %d %d\n", PAGE_SIZE, PAGES(1), PAGES(8193));
    printf("%d %d\n", BAD_SQUARE(2 + 1), SQUARE(2 + 1));
    int a = 3, b = 9;
    printf("%d\n", MAX(a, b));
    printf("%s %s %s\n", STR(PAGE_SHIFT), XSTR(PAGE_SHIFT), STR(a + b));
    struct stats s = {2, 5};
    printf("%d %d\n", s.fork_count, s.exec_count);
    SWAP(int, a, b);
    printf("%d %d\n", a, b);
    printf("%s %d %d\n", mode, cpus, arithmetic_ok);
    LOG("hidden");
    printf("line %d, %s\n", __LINE__, __func__);
    return EXIT_SUCCESS;
}
