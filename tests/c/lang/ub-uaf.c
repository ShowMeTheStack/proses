/* Use after free: the job is freed, then its fields are read through the old pointer. */
// expect: ub uaf line 15
#include <stdio.h>
#include <stdlib.h>

struct job { int id; int priority; };

int main(void) {
    struct job *j = malloc(sizeof *j);
    j->id = 7;
    j->priority = 3;
    printf("job %d\n", j->id);
    free(j);
    int p;
    p = j->priority;
    printf("%d\n", p);
    return 0;
}
