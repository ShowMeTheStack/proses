/* An assertion that does not hold stops the program with SIGABRT. */
// expect: abort line 10
#include <stdio.h>
#include <assert.h>

int main(void) {
    int free_frames = 2;
    int wanted = 3;
    printf("checking\n");
    assert(wanted <= free_frames);
    printf("not reached\n");
    return 0;
}
