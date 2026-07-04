/* printf with integers: widths, precisions and flags. */
#include <stdio.h>

int main(void) {
    int v[] = {0, 7, -7, 42, -42, 12345, -2147483647 - 1};
    for (int i = 0; i < 7; i++)
        printf("[%d] [%5d] [%-5d] [%05d] [%+d] [% d] [%.3d] [%8.3d] [%-+6d]\n", v[i], v[i], v[i], v[i], v[i], v[i], v[i], v[i], v[i]);
    printf("[%x] [%X] [%#x] [%#o] [%o] [%08x] [%#08x]\n", 3054, 3054, 3054, 8, 8, 255, 255);
    printf("[%u] [%lu] [%ld] [%lx]\n", 4000000000u, 18000000000000000000UL, -5000000000L, 0xdeadbeefcafeUL);
    printf("[%c] [%3c] [%-3c]|\n", 'p', 'q', 'r');
    printf("[%s] [%8s] [%-8s] [%.2s] [%8.3s]\n", "fork", "fork", "fork", "fork", "fork");
    printf("[%*d] [%-*d] [%.*d] [%*.*d]\n", 6, 31, 6, 31, 4, 31, 7, 3, 31);
    printf("[%hhd] [%hd] [%hhu] [%hu]\n", 300, 70000, 300, 70000);
    printf("[%.0d] [%.0x] 100%%\n", 0, 0);
    printf("[%zu] [%%d]\n", sizeof(long));
    return 0;
}
