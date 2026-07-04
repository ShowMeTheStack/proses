/* printf with doubles: %f %e %g, precision, rounding exactly as the C library does. */
#include <stdio.h>

int main(void) {
    double v[] = {0.0, 1.0, -1.5, 3.14159265358979, 2.675, 0.125, 1e-5, 123456789.0, 1e21, 0.1 + 0.2, 99.995, 5e-324, 1.0 / 3.0};
    int n = sizeof v / sizeof v[0];
    for (int i = 0; i < n; i++)
        printf("%f|%.2f|%.0f|%e|%.3e|%g|%.3g|%10.4f|%-10.1e|%+g\n", v[i], v[i], v[i], v[i], v[i], v[i], v[i], v[i], v[i], v[i]);
    printf("%.0f %.0f %.0f %.0f\n", 0.5, 1.5, 2.5, 3.5);
    printf("%.1f %.1f %.1f\n", 0.25, 0.35, 0.45);
    printf("%g %g %g %g %g\n", 100000.0, 1000000.0, 0.0001, 0.00001, 123456.0);
    printf("%#g %#.0f %#x\n", 2.0, 3.0, 0);
    printf("%E %G %G\n", 12345.678, 0.000012345, 1e100);
    printf("%010.3f|%-10.3f|%+.2e\n", -3.14159, 2.5, 12345.0);
    float f = 1.1f;
    printf("%f %.10f\n", f, f);
    printf("%.20f\n", 0.1);
    printf("%.15g %.17g\n", 0.1, 0.1);
    return 0;
}
