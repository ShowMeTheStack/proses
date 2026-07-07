/* Three threads add to a shared counter under a mutex; main joins them in order and prints each result. */
#include <stdio.h>
#include <pthread.h>

int counter = 0;
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

void *work(void *arg) {
    long id = (long)arg;
    int i;
    for (i = 0; i < 3; i++) {
        pthread_mutex_lock(&lock);
        counter++;
        pthread_mutex_unlock(&lock);
    }
    return (void *)(id * 10);
}

int main(void) {
    pthread_t t[3];
    long i;
    for (i = 0; i < 3; i++)
        pthread_create(&t[i], NULL, work, (void *)i);
    for (i = 0; i < 3; i++) {
        void *r;
        pthread_join(t[i], &r);
        printf("thread %ld gave %ld\n", i, (long)r);
    }
    printf("counter = %d\n", counter);
    return 0;
}
