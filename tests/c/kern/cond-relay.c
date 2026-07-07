/* Two threads take turns through a condition variable: each waits for its turn, prints, and passes it on. */
#include <stdio.h>
#include <pthread.h>

int turn = 0;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t c = PTHREAD_COND_INITIALIZER;

void *player(void *arg) {
    long me = (long)arg;
    int round;
    for (round = 0; round < 3; round++) {
        pthread_mutex_lock(&m);
        while (turn != me)
            pthread_cond_wait(&c, &m);
        printf("player %ld, round %d\n", me, round);
        turn = 1 - me;
        pthread_cond_broadcast(&c);
        pthread_mutex_unlock(&m);
    }
    return NULL;
}

int main(void) {
    pthread_t a, b;
    pthread_create(&a, NULL, player, (void *)0);
    pthread_create(&b, NULL, player, (void *)1);
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    printf("done\n");
    return 0;
}
