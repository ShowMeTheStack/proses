/* Constants from the standard headers that are the same on every Unix-like system. */
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <unistd.h>
#include <signal.h>
#include <stdint.h>
#include <stddef.h>
#include <errno.h>
#include <string.h>

int main(void) {
    printf("%d %d %d\n", EXIT_SUCCESS, EXIT_FAILURE, EOF);
    printf("%d %d %d %d\n", CHAR_BIT, SCHAR_MIN, UCHAR_MAX, SHRT_MAX);
    printf("%d %d %u\n", INT_MIN, INT_MAX, UINT_MAX);
    printf("%ld %lu\n", LONG_MAX, ULONG_MAX);
    printf("%d %d %d\n", SEEK_SET, SEEK_CUR, SEEK_END);
    printf("%d %d %d\n", STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO);
    printf("%d %d %d %d %d\n", SIGHUP, SIGINT, SIGKILL, SIGSEGV, SIGTERM);
    printf("%d %d %u\n", INT8_MIN, INT16_MAX, UINT32_MAX);
    printf("%d %d\n", NULL == 0, (int)sizeof(size_t));
    printf("%d %d %d\n", ENOENT, EINTR, EINVAL);
    printf("%s|%s\n", strerror(ENOENT), strerror(EINVAL));
    int16_t h = -2; uint8_t b = 200; int64_t w = -1; uintptr_t up = 4096;
    printf("%d %d %ld %lu\n", h, b, (long)w, (unsigned long)up);
    return 0;
}
