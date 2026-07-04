// The C subset's system headers: the one table the compiler and the simulated kernel share. Values follow a
// typical 64-bit Linux (x86-64, glibc) so a program's numbers match what students see on their own machines.
//   S.CLang.CONSTS        name -> number: signals, errno values, open flags, wait options, seek origins, limits...
//                         The kernel reads its numbers from here (S.CLang.CONSTS.SIGCHLD), so both always agree.
//   S.CLang.MACRO_TEXT    macros whose spelling matters (INT_MIN, UINT_MAX, NULL, stdout...) and function-like
//                         macros (WEXITSTATUS(s), assert(e), offsetof(t, m)...): name -> {params?, body}
//   S.CLang.HEADERS       header name -> the C declarations it provides (typedefs, structs, prototypes)
//   S.CLang.LIBFNS        the calls the machine computes itself (strings, memory, ctype, stdlib, formatting,
//                         the heap); every other declared call traps to the kernel ('sys')
//   S.CLang.STRERROR      errno -> its message, as glibc words it
//   S.CLang.STREAMS       the FILE * values of the standard streams: stdin 3, stdout 1, stderr 2
//   S.CLang.FN_BASE       a function's address is FN_BASE + its index (functions with bodies, in source order);
//                         a library function's is FN_BASE + LIB_FN + its index in the prelude
// Opaque kernel objects (pthread_t, pthread_mutex_t, pthread_cond_t, sem_t) are one 8-byte word the kernel owns;
// sigset_t is a 4-byte mask (bit n - 1 for signal n); struct sigaction is {sa_handler | sa_sigaction at 0,
// sa_mask at 8, sa_flags at 12, sa_restorer at 16} (24 bytes).
// Calls the headers do not declare are taken from S.Kern.SYSCALLS (name: [return, fewest, most]) when it exists.
(function (S) {
  'use strict';
  const C = (S.CLang = S.CLang || {});
  C.FN_BASE = 1073741824;
  C.LIB_FN = 65536;
  C.STREAMS = { stdin: 3, stdout: 1, stderr: 2 };

  const SIG = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGSTKFLT: 16, SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19, SIGTSTP: 20, SIGTTIN: 21, SIGTTOU: 22, SIGURG: 23, SIGXCPU: 24, SIGXFSZ: 25, SIGVTALRM: 26, SIGPROF: 27, SIGWINCH: 28, SIGIO: 29, SIGPWR: 30, SIGSYS: 31 };
  const ERR = { EPERM: 1, ENOENT: 2, ESRCH: 3, EINTR: 4, EIO: 5, ENXIO: 6, E2BIG: 7, ENOEXEC: 8, EBADF: 9, ECHILD: 10, EAGAIN: 11, ENOMEM: 12, EACCES: 13, EFAULT: 14, EBUSY: 16, EEXIST: 17, EXDEV: 18, ENODEV: 19, ENOTDIR: 20, EISDIR: 21, EINVAL: 22, ENFILE: 23, EMFILE: 24, ENOTTY: 25, EFBIG: 27, ENOSPC: 28, ESPIPE: 29, EROFS: 30, EMLINK: 31, EPIPE: 32, EDOM: 33, ERANGE: 34, EDEADLK: 35, ENAMETOOLONG: 36, ENOSYS: 38, ENOTEMPTY: 39, ETIMEDOUT: 110 };
  C.CONSTS = Object.assign({}, SIG, ERR, {
    EWOULDBLOCK: 11, SIGIOT: 6, SIGPOLL: 29,
    EXIT_SUCCESS: 0, EXIT_FAILURE: 1, EOF: -1, BUFSIZ: 8192, RAND_MAX: 2147483647, PATH_MAX: 4096,
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_NOCTTY: 256, O_TRUNC: 512, O_APPEND: 1024, O_NONBLOCK: 2048, O_CLOEXEC: 524288,
    S_IRWXU: 448, S_IRUSR: 256, S_IWUSR: 128, S_IXUSR: 64, S_IRWXG: 56, S_IRGRP: 32, S_IWGRP: 16, S_IXGRP: 8, S_IRWXO: 7, S_IROTH: 4, S_IWOTH: 2, S_IXOTH: 1,
    SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2, STDIN_FILENO: 0, STDOUT_FILENO: 1, STDERR_FILENO: 2,
    WNOHANG: 1, WUNTRACED: 2, WCONTINUED: 8,
    SIG_DFL: 0, SIG_IGN: 1, SIG_ERR: -1, SIG_BLOCK: 0, SIG_UNBLOCK: 1, SIG_SETMASK: 2,
    SA_NOCLDSTOP: 1, SA_NOCLDWAIT: 2, SA_SIGINFO: 4, SA_RESTART: 268435456, SA_NODEFER: 1073741824, SA_RESETHAND: 2147483648, NSIG: 65,
    PTHREAD_MUTEX_INITIALIZER: 0, PTHREAD_COND_INITIALIZER: 0,
    _IOFBF: 0, _IOLBF: 1, _IONBF: 2,
    CHAR_BIT: 8, SCHAR_MIN: -128, SCHAR_MAX: 127, UCHAR_MAX: 255, CHAR_MIN: -128, CHAR_MAX: 127, SHRT_MIN: -32768, SHRT_MAX: 32767, USHRT_MAX: 65535,
    INT_MIN: -2147483648, INT_MAX: 2147483647, UINT_MAX: 4294967295,
    INT8_MIN: -128, INT8_MAX: 127, UINT8_MAX: 255, INT16_MIN: -32768, INT16_MAX: 32767, UINT16_MAX: 65535, INT32_MIN: -2147483648, INT32_MAX: 2147483647, UINT32_MAX: 4294967295,
  });
  const T = (body) => ({ body });
  C.MACRO_TEXT = {
    NULL: T('((void *)0)'), true: T('1'), false: T('0'), bool: T('_Bool'), __bool_true_false_are_defined: T('1'),
    stdin: T('((FILE *)3)'), stdout: T('((FILE *)1)'), stderr: T('((FILE *)2)'),
    SIG_DFL: T('((void (*)(int))0)'), SIG_IGN: T('((void (*)(int))1)'), SIG_ERR: T('((void (*)(int))-1)'),
    INT_MIN: T('(-2147483647 - 1)'), UINT_MAX: T('4294967295U'), INT32_MIN: T('(-2147483647 - 1)'), UINT32_MAX: T('4294967295U'),
    LONG_MIN: T('(-9223372036854775807L - 1)'), LONG_MAX: T('9223372036854775807L'), ULONG_MAX: T('18446744073709551615UL'),
    LLONG_MIN: T('(-9223372036854775807LL - 1)'), LLONG_MAX: T('9223372036854775807LL'), ULLONG_MAX: T('18446744073709551615ULL'),
    INT64_MIN: T('(-9223372036854775807L - 1)'), INT64_MAX: T('9223372036854775807L'), UINT64_MAX: T('18446744073709551615UL'), SIZE_MAX: T('18446744073709551615UL'),
    SA_RESETHAND: T('0x80000000'),
    PTHREAD_MUTEX_INITIALIZER: T('0'), PTHREAD_COND_INITIALIZER: T('0'),
    WEXITSTATUS: { params: ['s'], body: '(((s) & 0xff00) >> 8)' }, WTERMSIG: { params: ['s'], body: '((s) & 0x7f)' },
    WSTOPSIG: { params: ['s'], body: '(((s) & 0xff00) >> 8)' }, WIFEXITED: { params: ['s'], body: '(((s) & 0x7f) == 0)' },
    WIFSIGNALED: { params: ['s'], body: '((((s) & 0x7f) != 0) && (((s) & 0x7f) != 0x7f))' }, WIFSTOPPED: { params: ['s'], body: '(((s) & 0xff) == 0x7f)' },
    WIFCONTINUED: { params: ['s'], body: '((s) == 0xffff)' }, WCOREDUMP: { params: ['s'], body: '((s) & 0x80)' },
    sigmask: { params: ['n'], body: '(1UL << ((n) - 1))' },
    offsetof: { params: ['t', 'm'], body: '__builtin_offsetof(t, m)' },
    assert: { params: ['e'], body: '((e) ? (void)0 : __assert_fail(#e, __FILE__, __LINE__, __func__))' },
    va_start: { params: ['a', 'b'], body: '__va_unsupported()' },
    isnan: { params: ['x'], body: '((x) != (x))' },
    EXIT_SUCCESS: T('0'), EXIT_FAILURE: T('1'), EOF: T('(-1)'),
  };

  C.STRERROR = {
    0: 'Success', 1: 'Operation not permitted', 2: 'No such file or directory', 3: 'No such process', 4: 'Interrupted system call', 5: 'Input/output error',
    6: 'No such device or address', 7: 'Argument list too long', 8: 'Exec format error', 9: 'Bad file descriptor', 10: 'No child processes',
    11: 'Resource temporarily unavailable', 12: 'Cannot allocate memory', 13: 'Permission denied', 14: 'Bad address', 16: 'Device or resource busy',
    17: 'File exists', 18: 'Invalid cross-device link', 19: 'No such device', 20: 'Not a directory', 21: 'Is a directory', 22: 'Invalid argument',
    23: 'Too many open files in system', 24: 'Too many open files', 25: 'Inappropriate ioctl for device', 27: 'File too large', 28: 'No space left on device',
    29: 'Illegal seek', 30: 'Read-only file system', 31: 'Too many links', 32: 'Broken pipe', 33: 'Numerical argument out of domain',
    34: 'Numerical result out of range', 35: 'Resource deadlock avoided', 36: 'File name too long', 38: 'Function not implemented', 39: 'Directory not empty',
    110: 'Connection timed out',
  };

  // the calls the machine computes itself; the rest of what the headers declare trap to the kernel
  C.LIBFNS = new Set(('strlen strcpy strncpy strcat strncat strcmp strncmp strchr strrchr strstr strtok strdup strndup strspn strcspn strpbrk ' +
    'strcasecmp strncasecmp memcpy memmove memset memcmp memchr strerror ' +
    'malloc calloc realloc free atoi atol atoll strtol strtoul strtoll strtoull abs labs llabs rand srand qsort bsearch getenv ' +
    'isdigit isalpha isalnum isspace isupper islower isxdigit ispunct isprint iscntrl isgraph toupper tolower ' +
    'sprintf snprintf sscanf __assert_fail __va_unsupported ' +
    'sqrt pow fabs floor ceil round trunc fmod exp log log10 log2 sin cos tan atan atan2 fmin fmax').split(/\s+/));

  C.HEADERS = {
    'stddef.h': `typedef unsigned long size_t; typedef long ptrdiff_t; typedef int wchar_t;`,
    'stdint.h': `typedef signed char int8_t; typedef unsigned char uint8_t; typedef short int16_t; typedef unsigned short uint16_t;
      typedef int int32_t; typedef unsigned int uint32_t; typedef long int64_t; typedef unsigned long uint64_t;
      typedef long intptr_t; typedef unsigned long uintptr_t; typedef long intmax_t; typedef unsigned long uintmax_t;`,
    'stdbool.h': ``,
    'limits.h': ``,
    'stdarg.h': `typedef char *va_list;`,
    'sys/types.h': `typedef long ssize_t; typedef long off_t; typedef int pid_t; typedef unsigned int uid_t; typedef unsigned int gid_t;
      typedef unsigned int mode_t; typedef long time_t; typedef long clock_t; typedef unsigned int useconds_t;`,
    'stdio.h': `typedef struct __file FILE;
      int printf(const char *format, ...); int fprintf(FILE *stream, const char *format, ...); int dprintf(int fd, const char *format, ...);
      int sprintf(char *str, const char *format, ...); int snprintf(char *str, size_t size, const char *format, ...);
      int sscanf(const char *str, const char *format, ...);
      int puts(const char *s); int fputs(const char *s, FILE *stream); int putchar(int c); int fputc(int c, FILE *stream); int putc(int c, FILE *stream);
      int fflush(FILE *stream); void perror(const char *s); int getchar(void); int fgetc(FILE *stream); int getc(FILE *stream);
      char *fgets(char *s, int size, FILE *stream); FILE *freopen(const char *path, const char *mode, FILE *stream); int setvbuf(FILE *stream, char *buf, int mode, size_t size); void setbuf(FILE *stream, char *buf);`,
    'string.h': `size_t strlen(const char *s); char *strcpy(char *dst, const char *src); char *strncpy(char *dst, const char *src, size_t n);
      char *strcat(char *dst, const char *src); char *strncat(char *dst, const char *src, size_t n);
      int strcmp(const char *a, const char *b); int strncmp(const char *a, const char *b, size_t n);
      char *strchr(const char *s, int c); char *strrchr(const char *s, int c); char *strstr(const char *hay, const char *needle);
      char *strtok(char *s, const char *delim); char *strdup(const char *s); char *strndup(const char *s, size_t n);
      size_t strspn(const char *s, const char *accept); size_t strcspn(const char *s, const char *reject); char *strpbrk(const char *s, const char *accept);
      void *memcpy(void *dst, const void *src, size_t n); void *memmove(void *dst, const void *src, size_t n); void *memset(void *s, int c, size_t n);
      int memcmp(const void *a, const void *b, size_t n); void *memchr(const void *s, int c, size_t n); char *strerror(int errnum);`,
    'strings.h': `int strcasecmp(const char *a, const char *b); int strncasecmp(const char *a, const char *b, size_t n);`,
    'stdlib.h': `void *malloc(size_t size); void *calloc(size_t n, size_t size); void *realloc(void *p, size_t size); void free(void *p);
      int atoi(const char *s); long atol(const char *s); long long atoll(const char *s);
      long strtol(const char *s, char **end, int base); unsigned long strtoul(const char *s, char **end, int base);
      long long strtoll(const char *s, char **end, int base); unsigned long long strtoull(const char *s, char **end, int base);
      int abs(int x); long labs(long x); long long llabs(long long x); int rand(void); void srand(unsigned int seed);
      void qsort(void *base, size_t n, size_t size, int (*cmp)(const void *, const void *));
      void *bsearch(const void *key, const void *base, size_t n, size_t size, int (*cmp)(const void *, const void *));
      char *getenv(const char *name); void exit(int status); void _Exit(int status); void abort(void); int atexit(void (*fn)(void));`,
    'ctype.h': `int isdigit(int c); int isalpha(int c); int isalnum(int c); int isspace(int c); int isupper(int c); int islower(int c);
      int isxdigit(int c); int ispunct(int c); int isprint(int c); int iscntrl(int c); int isgraph(int c); int toupper(int c); int tolower(int c);`,
    'math.h': `double sqrt(double x); double pow(double x, double y); double fabs(double x); double floor(double x); double ceil(double x);
      double round(double x); double trunc(double x); double fmod(double x, double y); double exp(double x); double log(double x);
      double log10(double x); double log2(double x); double sin(double x); double cos(double x); double tan(double x);
      double atan(double x); double atan2(double y, double x); double fmin(double a, double b); double fmax(double a, double b);`,
    'assert.h': `void __assert_fail(const char *expr, const char *file, int line, const char *fn);`,
    'errno.h': `extern int errno;`,
    'unistd.h': `pid_t fork(void); pid_t getpid(void); pid_t getppid(void); unsigned int sleep(unsigned int s); int usleep(useconds_t us);
      void _exit(int status); int execl(const char *path, const char *arg, ...); int execlp(const char *file, const char *arg, ...);
      int execv(const char *path, char *const argv[]); int execvp(const char *file, char *const argv[]);
      int pipe(int fd[2]); int dup(int fd); int dup2(int fd, int fd2); ssize_t read(int fd, void *buf, size_t n);
      ssize_t write(int fd, const void *buf, size_t n); int close(int fd); off_t lseek(int fd, off_t off, int whence); int unlink(const char *path);
      int pause(void); unsigned int alarm(unsigned int s); int isatty(int fd); int setpgid(pid_t pid, pid_t pgid); pid_t getpgid(pid_t pid);
      pid_t getpgrp(void); int tcsetpgrp(int fd, pid_t pgrp); pid_t tcgetpgrp(int fd);`,
    'sys/wait.h': `pid_t wait(int *status); pid_t waitpid(pid_t pid, int *status, int options);`,
    'fcntl.h': `int open(const char *path, int flags, ...); int creat(const char *path, mode_t mode);`,
    'signal.h': `typedef unsigned int sigset_t; typedef int sig_atomic_t; typedef void (*sighandler_t)(int);
      typedef struct { int si_signo; int si_errno; int si_code; int si_pid; int si_uid; int si_status; } siginfo_t;
      struct sigaction { union { void (*sa_handler)(int); void (*sa_sigaction)(int, siginfo_t *, void *); }; sigset_t sa_mask; int sa_flags; void (*sa_restorer)(void); };
      sighandler_t signal(int sig, sighandler_t handler); int sigaction(int sig, const struct sigaction *act, struct sigaction *old);
      int kill(pid_t pid, int sig); int raise(int sig); int sigprocmask(int how, const sigset_t *set, sigset_t *old);
      int sigemptyset(sigset_t *set); int sigfillset(sigset_t *set); int sigaddset(sigset_t *set, int sig); int sigdelset(sigset_t *set, int sig);
      int sigismember(const sigset_t *set, int sig); int sigpending(sigset_t *set); int sigsuspend(const sigset_t *mask);`,
    'pthread.h': `typedef long pthread_t; typedef long pthread_attr_t; typedef long pthread_mutex_t; typedef long pthread_mutexattr_t;
      typedef long pthread_cond_t; typedef long pthread_condattr_t;
      int pthread_create(pthread_t *t, const pthread_attr_t *attr, void *(*start)(void *), void *arg); int pthread_join(pthread_t t, void **ret);
      void pthread_exit(void *ret); pthread_t pthread_self(void); int pthread_equal(pthread_t a, pthread_t b);
      int pthread_mutex_init(pthread_mutex_t *m, const pthread_mutexattr_t *a); int pthread_mutex_lock(pthread_mutex_t *m);
      int pthread_mutex_trylock(pthread_mutex_t *m); int pthread_mutex_unlock(pthread_mutex_t *m); int pthread_mutex_destroy(pthread_mutex_t *m);
      int pthread_cond_init(pthread_cond_t *c, const pthread_condattr_t *a); int pthread_cond_wait(pthread_cond_t *c, pthread_mutex_t *m);
      int pthread_cond_signal(pthread_cond_t *c); int pthread_cond_broadcast(pthread_cond_t *c); int pthread_cond_destroy(pthread_cond_t *c);`,
    'semaphore.h': `typedef long sem_t; int sem_init(sem_t *s, int shared, unsigned int value); int sem_wait(sem_t *s); int sem_trywait(sem_t *s);
      int sem_post(sem_t *s); int sem_getvalue(sem_t *s, int *value); int sem_destroy(sem_t *s);`,
    'sched.h': `int sched_yield(void);`,
    'time.h': `struct timespec { time_t tv_sec; long tv_nsec; }; time_t time(time_t *t); int nanosleep(const struct timespec *req, struct timespec *rem);`,
    'sys/stat.h': ``, 'sys/time.h': ``, 'stdnoreturn.h': ``, 'iso646.h': ``, 'float.h': ``, 'inttypes.h': ``,
  };
  // the headers a name comes from (for hints when a name is unknown)
  C.headerOf = function (name) {
    const hit = [];
    for (const [h, text] of Object.entries(C.HEADERS)) if (new RegExp('\\b' + name + '\\b').test(text)) hit.push(h);
    const where = { NULL: 'stddef.h', EXIT_SUCCESS: 'stdlib.h', EXIT_FAILURE: 'stdlib.h', EOF: 'stdio.h', RAND_MAX: 'stdlib.h', BUFSIZ: 'stdio.h', bool: 'stdbool.h', true: 'stdbool.h', false: 'stdbool.h', assert: 'assert.h', errno: 'errno.h', offsetof: 'stddef.h' };
    if (where[name]) hit.unshift(where[name]);
    if (/^SIG|^SA_/.test(name)) hit.push('signal.h');
    if (/^O_/.test(name)) hit.push('fcntl.h');
    if (/^E[A-Z]+$/.test(name) && name in C.CONSTS) hit.push('errno.h');
    if (/^W[A-Z]+$/.test(name)) hit.push('sys/wait.h');
    if (/^(INT|UINT|LONG|ULONG|CHAR|SCHAR|UCHAR|SHRT|USHRT|LLONG)_/.test(name)) hit.push('limits.h');
    if (/^SEEK_|_FILENO$/.test(name)) hit.push('unistd.h');
    return [...new Set(hit)];
  };
})(globalThis.Proses = globalThis.Proses || {});
