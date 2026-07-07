/* Two threads each add one to a shared counter with count++, unprotected: a load, an add and a store, which can
   interleave, so the counter may end at 1. */
#include <stdio.h>
#include <pthread.h>

int count = 0;

void *bump(void *arg) {
    count++;
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, bump, NULL);
    pthread_create(&b, NULL, bump, NULL);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("count = %d\n", count);
    return 0;
}
