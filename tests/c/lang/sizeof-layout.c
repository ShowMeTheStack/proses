/* sizeof and offsetof: padding and alignment of structs and unions on a 64-bit system. */
#include <stdio.h>
#include <stddef.h>

struct a { char c; int i; };
struct b { char c; double d; char e; };
struct c { char x, y; short s; long l; };
struct d { int i; char name[5]; };
struct e { struct a inner; char tail; };
struct f { char c; struct { short s; char t; } pair; long double ld_unused_guard; };
struct g { char tag; union { int i; char bytes[6]; } u; };
struct h { void *p; char c; };
struct k { char c[3]; };
union u1 { char c; int i; double d; };
union u2 { char s[9]; int i; };

int main(void) {
    printf("%lu %lu %lu %lu %lu\n", sizeof(char), sizeof(short), sizeof(int), sizeof(long), sizeof(long long));
    printf("%lu %lu %lu %lu\n", sizeof(float), sizeof(double), sizeof(void *), sizeof(size_t));
    printf("a %lu %lu\n", sizeof(struct a), offsetof(struct a, i));
    printf("b %lu %lu %lu\n", sizeof(struct b), offsetof(struct b, d), offsetof(struct b, e));
    printf("c %lu %lu %lu\n", sizeof(struct c), offsetof(struct c, s), offsetof(struct c, l));
    printf("d %lu %lu\n", sizeof(struct d), offsetof(struct d, name));
    printf("e %lu %lu\n", sizeof(struct e), offsetof(struct e, tail));
    printf("f %lu\n", offsetof(struct f, pair));
    printf("g %lu %lu\n", sizeof(struct g), offsetof(struct g, u));
    printf("h %lu %lu\n", sizeof(struct h), offsetof(struct h, c));
    printf("k %lu\n", sizeof(struct k));
    printf("u %lu %lu\n", sizeof(union u1), sizeof(union u2));
    struct b arr[3];
    printf("%lu %ld\n", sizeof arr, (long)((char *)&arr[2] - (char *)&arr[0]));
    return 0;
}
