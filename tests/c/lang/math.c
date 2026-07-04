/* Functions from <math.h>, printed with a few decimals. */
#include <stdio.h>
#include <math.h>

int main(void) {
    printf("%.4f %.4f %.4f\n", sqrt(2.0), pow(2.0, 10.0), pow(9.0, 0.5));
    printf("%.1f %.1f %.1f %.1f\n", floor(-2.5), ceil(-2.5), floor(2.5), ceil(2.1));
    printf("%.1f %.1f %.1f\n", round(2.5), round(-2.5), trunc(-2.7));
    printf("%.3f %.3f\n", fabs(-3.25), fmod(10.5, 3.0));
    printf("%.4f %.4f %.4f\n", exp(1.0), log(10.0), log10(1000.0));
    double pi = 4 * atan(1.0);
    printf("%.6f %.4f %.4f\n", pi, sin(pi / 6), cos(pi / 3));
    double ratios[] = {0.5, 0.75, 0.9};
    for (int i = 0; i < 3; i++) printf("%.2f ", 1 / (1 - ratios[i]));
    printf("\n");
    return 0;
}
