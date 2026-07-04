/* Signed overflow is reported, and the program goes on (it wraps here, as most machines do). */
// expect: warn overflow line 10
// expect: warn overflow line 15
// cc: skip (undefined behaviour: the compiler may do anything)
#include <stdio.h>
#include <limits.h>

int main(void) {
    int big = INT_MAX;
    int next = big + 1;
    printf("%d\n", next);
    unsigned int u = UINT_MAX;
    printf("%u\n", u + 1);
    long fact = 1;
    for (int i = 1; i <= 21; i++) fact *= i;
    printf("done\n");
    return 0;
}
/* output:
-2147483648
0
done
*/
