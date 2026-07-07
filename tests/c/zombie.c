/* The child exits at once; it stays a zombie until the parent, back from sleep, waits for it. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    pid_t kid = fork();
    if (kid == 0) {
        printf("kid: done\n");
        exit(4);
    }
    sleep(1);
    int st = 0;
    pid_t got = waitpid(kid, &st, 0);
    printf("parent: reaped the kid: %d, code %d\n", got == kid, WEXITSTATUS(st));
    return 0;
}
