/* exec throws away the stdio buffer: "lost " never appears; the newline-ended line does. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    if (fork() == 0) {
        printf("kept\n");
        printf("lost ");
        execl("/bin/echo", "echo", "echoed", NULL);
        exit(1);
    }
    wait(NULL);
    return 0;
}
