/* Nested structs, arrays inside structs, arrays of structs and pointers walking them. */
#include <stdio.h>

struct point { int x, y; };
struct rect { struct point lo, hi; };
struct segment { const char *name; unsigned long base, limit; };
struct table { int count; struct segment seg[4]; };

int area(const struct rect *r) { return (r->hi.x - r->lo.x) * (r->hi.y - r->lo.y); }

int main(void) {
    struct rect r = {{1, 2}, {6, 10}};
    printf("%d %d %d\n", r.lo.y, r.hi.x, area(&r));
    struct rect *rp = &r;
    rp->hi.y += 2;
    printf("%d\n", area(rp));
    struct table t = {3, {{"code", 0x400000, 0x1000}, {"data", 0x600000, 0x800}, {"stack", 0x7ff000, 0x2000}}};
    for (struct segment *s = t.seg; s < t.seg + t.count; s++)
        printf("%-6s %#lx-%#lx\n", s->name, s->base, s->base + s->limit);
    struct point pts[4] = {{0, 0}, {3, 4}, {-1, 2}, {5, -5}};
    int best = 0;
    for (int i = 1; i < 4; i++)
        if (pts[i].x * pts[i].x + pts[i].y * pts[i].y > pts[best].x * pts[best].x + pts[best].y * pts[best].y)
            best = i;
    printf("farthest %d (%d,%d)\n", best, pts[best].x, pts[best].y);
    struct table copy = t;
    copy.seg[1].limit = 0;
    printf("%lu %lu\n", t.seg[1].limit, copy.seg[1].limit);
    return 0;
}
