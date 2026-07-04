/* rand and srand: the same seed gives the same numbers (these are the numbers glibc gives on Linux). */
// cc: skip (each C library has its own generator; the expected output below is glibc's)
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    for (int i = 0; i < 4; i++) printf("%d\n", rand());
    srand(42);
    int a = rand(), b = rand();
    srand(42);
    printf("%d %d\n", a == rand(), b == rand());
    srand(7);
    int dice[6] = {0};
    for (int i = 0; i < 600; i++) dice[rand() % 6]++;
    int total = 0;
    for (int i = 0; i < 6; i++) total += dice[i];
    printf("%d\n", total);
    return 0;
}
/* output:
1804289383
846930886
1681692777
1714636915
1 1
600
*/
