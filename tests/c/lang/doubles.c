/* float and double: precision, conversions to and from integers, mixed arithmetic. */
#include <stdio.h>

double average(const int *v, int n) { long s = 0; for (int i = 0; i < n; i++) s += v[i]; return (double)s / n; }

int main(void) {
    float f = 0.1f;
    double d = 0.1;
    printf("%.10f %.10f %d\n", f, d, f == d);
    printf("%d %d %d\n", (int)2.9, (int)-2.9, (int)(0.1 * 3 * 10));
    int burst[] = {6, 8, 7, 3};
    printf("%.2f\n", average(burst, 4));
    printf("%.3f %.3f\n", 7 / 2 * 1.0, 7 / 2.0);
    double tau = 0;
    double alpha = 0.5;
    int obs[] = {6, 4, 6, 4, 13, 13, 13};
    for (int i = 0; i < 7; i++) { tau = alpha * obs[i] + (1 - alpha) * tau; printf("%.3f ", tau); }
    printf("\n");
    long big = 9007199254740993L;
    double bd = (double)big;
    printf("%.0f %ld\n", bd, (long)bd);
    float acc = 0;
    for (int i = 0; i < 10; i++) acc += 0.1f;
    printf("%.7f %d\n", acc, acc == 1.0f);
    unsigned u = 4000000000u;
    printf("%.1f %.1f\n", (double)u, (double)(int)u);
    printf("%g %g\n", 1.0 / 0.0 > 1e308 ? 1.0 : 0.0, -0.0);
    double x = 1e300;
    printf("%e\n", x * 10);
    return 0;
}
