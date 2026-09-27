// Part 4, threads: the chapters and the lessons. The exercises are in 041-threads-ex.js and 041-threads-ex2.js; the
// challenges, the guided tour, the course and the pages the diagram checker looks at are in 042-threads-ch.js. Each
// lesson opens with a question, runs the topic that shows the idea at a frame chosen for the point being made, asks
// for a prediction, sums up, and leads to its exercises. Every value quoted here was worked out by the engines
// (S.Kern running the topics' C programs, and the models in S.P04) on the topics' own inputs.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.chapters.some((c) => c.id === 'thr-basics')) return;

  C.chapter({ id: 'thr-basics', part: 'threads', n: 1, title: 'Threads and the address space', blurb: 'Several threads in one process: what they share, what each keeps, and who schedules them, a library or the kernel.' });
  C.chapter({ id: 'thr-api', part: 'threads', n: 2, title: 'The thread API', blurb: 'pthread_create and pthread_join, a variable of each thread\'s own, stopping a thread safely, and what fork and exec do to a threaded program.' });
  C.chapter({ id: 'thr-patterns', part: 'threads', n: 3, title: 'Putting threads to work', blurb: 'Thread pools, fork-join, parallel loops and implicit threading, and the ceiling Amdahl\'s law puts on all of them.' });
  const X = (id) => ({ exercise: id });
  const lab = (title, text, src, more) => ({ lab: 'process', title, text, setup: Object.assign({ src, policy: 'random' }, more || {}) });
  const FIRST = '#include <stdio.h>\n#include <pthread.h>\n\nvoid *hello(void *arg) {\n    printf("worker\\n");\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t;\n    pthread_create(&t, NULL, hello, NULL);\n    printf("main\\n");\n    pthread_join(t, NULL);\n    printf("joined\\n");\n    return 0;\n}\n';
  const ARG = '#include <stdio.h>\n#include <pthread.h>\n\nvoid *show(void *arg) {\n    int *p = arg;\n    int v = *p;\n    printf("got %d\\n", v);\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t[2];\n    int i;\n    for (i = 0; i < 2; i++)\n        pthread_create(&t[i], NULL, show, &i);\n    for (int k = 0; k < 2; k++)\n        pthread_join(t[k], NULL);\n    return 0;\n}\n';
  const FORKLOCK = '#include <stdio.h>\n#include <pthread.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\npthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;\n\nvoid *saver(void *arg) {\n    pthread_mutex_lock(&m);\n    sleep(2);\n    pthread_mutex_unlock(&m);\n    return NULL;\n}\n\nint main(void) {\n    pthread_t t;\n    pthread_create(&t, NULL, saver, NULL);\n    sleep(1);\n    if (fork() == 0) {\n        pthread_mutex_lock(&m);\n        printf("child got m\\n");\n        return 0;\n    }\n    waitpid(-1, NULL, 0);\n    printf("parent: child done\\n");\n    return 0;\n}\n';

  // =========================================================================================================
  // Chapter 1: threads and the address space
  // =========================================================================================================
  C.lesson({
    id: 'thr-why', chapter: 'thr-basics', title: 'One address space, several stacks', minutes: 7,
    summary: 'A thread is a flow of control inside a process. The threads of one process share its code, globals, heap and open files; each has its own stack, registers and program counter. Forked children, by contrast, each get a copy of everything, so what one writes the others never see.',
    blocks: [
      'Two workers must add their results into one total. With fork, each child gets its own copy of memory: when a child writes the total, the parent never sees it. Is there a way for several flows of control to run inside one address space, so a write by one is a write for all?',
      { def: 'thread', text: 'one flow of control inside a process: its own program counter, registers and stack, sharing everything else (code, globals, heap, open files) with the other threads of the same process.' },
      { topic: 'thr-space', input: { how: 'threads', k: '2' }, frame: 0, caption: 'Process 100 is about to start 2 workers; each adds id × 10 to the global total. On the left, the one address space: code, globals, heap, and main\'s stack at the top.' },
      { topic: 'thr-space', input: { how: 'threads', k: '2' }, frame: 2, caption: 'Each new thread gets a stack of its own, a block carved from the heap: thread 101\'s runs from 0x2010 to 0x4010, thread 102\'s from 0x4020 to 0x6020. The code and the globals are not copied.' },
      { predict: { q: 'Now the same program with fork instead: two children each add id × 10 to total, and the parent waits for both, then prints total. What does it print?', options: ['total = 30', 'total = 0', 'total = 10 or 20, whichever child ends last'], answer: 1, explain: 'Each child adds to its own copy of total, and that copy vanishes when the child exits. The parent\'s total is never touched: it prints total = 0.' } },
      { topic: 'thr-space', input: { how: 'fork', k: '2' }, frame: 13, caption: 'With fork, the parent prints total = 0. Every child\'s mine had the same address, 0x9fb4: the same virtual address in different address spaces names different memory.' },
      { topic: 'thr-space', input: { how: 'threads', k: '2' }, frame: 13, caption: 'With threads, main prints total = 30: both additions, 10 and 20, landed in the one total. Each worker\'s mine lived at a different address, on its own stack.' },
      { table: [['', 'Two threads', 'Two forked children'], ['Code, globals, heap', 'one copy, shared', 'a copy each'], ['Stack, registers, PC', 'one each', 'one each'], ['Open files', 'one table, shared', 'a copy of the table each'], ['Cost to start', 'a stack and a few registers', 'a whole process (copy-on-write)'], ['A crash in one', 'ends them all', 'ends that one only']], caption: 'Threads against processes.' },
      { warn: 'Sharing is the point of threads, and also their danger: two threads writing one variable without care can lose an update. Part 7 shows why, and how to prevent it.' },
      { h: 'Recap' },
      { list: ['A thread is a flow of control: a program counter, registers and a stack.', 'Threads of one process share code, globals, heap and open files.', 'Forked children share nothing writable: each writes its own copy.'] },
      X('thr-x-shared'), X('thr-x-first'), X('thr-x-fork-global'),
    ],
  });

  C.lesson({
    id: 'thr-shared', chapter: 'thr-basics', title: 'What each thread keeps', minutes: 6,
    summary: 'Every thread can name the same global, the same heap block and the same open file, at the same address. A local variable, though, lives in the frame of a call on the calling thread\'s stack, so two threads running the same function have two copies of each local.',
    blocks: [
      'Two threads run the very same function, `work`, with a local called `local`. Is there one `local` or two? And if a thread passes the address of its local to another thread, can that thread use it?',
      { topic: 'thr-share', input: { k: '2', policy: 'rr' }, frame: 0, caption: 'main starts 2 workers that all use the same names: the global shared, the heap block box, their own id and local. The table fills in each name\'s address as the threads touch it.' },
      { topic: 'thr-share', input: { k: '2', policy: 'rr' }, frame: 2, caption: 'Thread 101\'s local is at 0x4024, on its own stack, holding 100.' },
      { predict: { q: 'Thread 102 now runs the same line of work. Where is its local?', options: ['At 0x4024 too: it is the same function', 'At a different address, on thread 102\'s stack', 'It has none: locals are shared'], answer: 1, explain: 'Each call of work gets a frame on the stack of the thread making the call. Thread 102\'s local is at 0x6034, holding 200.' } },
      { topic: 'thr-share', input: { k: '2', policy: 'rr' }, frame: 6, caption: 'Thread 102\'s local is at 0x6034, holding 200: same name, same line of code, another stack.' },
      { topic: 'thr-share', input: { k: '2', policy: 'rr' }, frame: 14, caption: 'At the end: every thread reached shared at the one address 0x1000 and the heap block at 0x2010, but each local had an address of its own. main prints shared = 2.' },
      { tip: 'A stack is still memory of the process. A pointer to a local can be handed to another thread and used there, as long as the owning call has not returned. Shared by address, not by name.' },
      { h: 'Recap' },
      { list: ['Globals and heap blocks: one copy, the same address in every thread.', 'Locals: one copy per call, on the calling thread\'s stack.', 'Registers and the program counter are saved and restored per thread at each switch.'] },
      X('thr-x-locals'), X('thr-x-shared'),
    ],
  });

  C.lesson({
    id: 'thr-models', chapter: 'thr-basics', title: 'User threads and kernel threads', minutes: 8,
    summary: 'A thread can be scheduled by a library inside the process (a user thread) or by the kernel (a kernel thread). Many-to-one puts every user thread on one kernel thread: cheap, but one blocking call stops them all and only one core is used. One-to-one gives each user thread a kernel thread. Many-to-many multiplexes user threads over a pool of kernel threads.',
    blocks: [
      'A thread library could switch threads itself, entirely in user space, with no system call: fast and simple. Then why do almost all systems today make every thread known to the kernel?',
      { def: 'user thread, kernel thread', text: 'a user thread is created and switched by a library in the process; the kernel does not see it. A kernel thread is one the kernel knows about and schedules onto a core. A model says how user threads are mapped onto kernel threads.' },
      { topic: 'thr-models', input: { model: 'many-to-one' }, frame: 0, caption: 'Many-to-one: 3 user threads with 10 ticks of computing between them, on 2 cores, all on one kernel thread. The kernel sees a single thread.' },
      { predict: { q: 'At tick 2, U0 makes a blocking call (it waits 4 ticks). U1 and U2 are ready. What runs during the wait?', options: ['U1 and U2, on the two cores', 'U1 only, on one core', 'Nothing of this process'], answer: 2, explain: 'The one kernel thread is blocked inside the kernel with U0, so the library, which would switch to U1, is not running either. Ticks 2 to 5 are lost.' } },
      { topic: 'thr-models', input: { model: 'many-to-one' }, frame: 3, caption: 'Tick 2: no core has anything to run. U0 holds the only kernel thread while it waits, so U1 and U2 wait too.' },
      { topic: 'thr-models', input: { model: 'many-to-one' }, frame: 15, caption: 'Many-to-one ends at tick 14 with the cores busy for 10 of 28 core-ticks: one core at most, and nothing while U0 waits.' },
      { topic: 'thr-models', input: { model: 'one-to-one' }, frame: 9, caption: 'One-to-one: each user thread is a kernel thread. The same work ends at tick 8, the cores busy 10 of 16 core-ticks. Many-to-many with a pool of 2 kernel threads also ends at 8 here.' },
      { table: [['Model', 'A blocking call stops', 'Cores used', 'Cost of a switch'], ['many-to-one', 'every thread of the process', 'one', 'a function call in the library'], ['one-to-one', 'only the caller', 'all', 'a trip into the kernel'], ['many-to-many', 'the caller and its kernel thread', 'up to the pool size', 'either, depending']], caption: 'The three models side by side.' },
      'One-to-one is what most systems use: kernel threads have become cheap, and it is simple to get right. Many-to-many survives in runtimes that keep huge numbers of light tasks and spread them over a few kernel threads per core.',
      { h: 'Recap' },
      { list: ['User threads are switched by a library; kernel threads by the kernel.', 'Many-to-one: one blocking call stops all, and one core at most.', 'One-to-one: each thread blocks alone and every core can be used.', 'Many-to-many: a pool of kernel threads shared by many user threads.'] },
      X('thr-x-model-block'), X('thr-x-model-finish'), X('thr-x-model-which'), X('thr-x-m2m-end'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: the thread API
  // =========================================================================================================
  C.lesson({
    id: 'thr-create', chapter: 'thr-api', title: 'pthread_create and pthread_join', minutes: 7,
    summary: 'pthread_create starts a thread in a function of one void * argument; pthread_join waits for a thread to end and collects the void * it returned. A thread that ends before anyone joins it keeps its value until the join, much as a zombie keeps its exit status.',
    blocks: [
      'A program starts three threads to square three numbers. How does main get the squares back, and how does it know they are ready?',
      { code: 'pthread_t t;\npthread_create(&t, NULL, fn, arg);   /* run fn(arg) in a new thread */\nvoid *ret;\npthread_join(t, &ret);               /* wait for t to end; ret = what fn returned */', lang: 'c' },
      { topic: 'thr-join', input: { k: '3', policy: 'fifo' }, frame: 0, caption: 'main creates 3 threads, the i-th squaring i + 2, then joins them in order and adds up what they return. The scheduler lets the running thread go on until it blocks.' },
      { predict: { q: 'main has created all three and calls pthread_join(101). Thread 101 has not run yet. What does main do?', options: ['It blocks until 101 ends', 'It gets 0 back at once', 'It skips to 102'], answer: 0, explain: 'Join waits: main blocks, and the scheduler runs the threads. When 101 ends with 4, main is woken.' } },
      { topic: 'thr-join', input: { k: '3', policy: 'fifo' }, frame: 4, caption: 'main calls pthread_join(101) while 101 has not finished: main blocks.' },
      { topic: 'thr-join', input: { k: '3', policy: 'fifo' }, frame: 7, caption: 'All three have ended, with 4, 9 and 16. 102 and 103 ended before anyone joined them: each keeps its value until its join.' },
      { topic: 'thr-join', input: { k: '3', policy: 'fifo' }, frame: 14, caption: 'Join collected 4, 9 and 16, and main printed sum of squares = 29. The order of the joins does not matter for the sum; each join only waits for its own thread.' },
      { warn: 'Hand each thread its own argument. Passing &i, the address of a loop variable, lets every thread read i whenever it gets round to it, after the loop has moved on: the exercise "Passing &i to a thread" lists all 8 outputs that can follow.' },
      lab('Run it in the Process lab', 'The &i program, scheduled at random: change the seed and list every output.', ARG),
      lab('Who prints first?', 'A worker and main both print; the join decides only where "joined" goes.', FIRST),
      { h: 'Recap' },
      { list: ['pthread_create(&t, NULL, fn, arg) runs fn(arg) in a new thread.', 'pthread_join(t, &ret) waits for t and collects its return value.', 'Creating threads in an order does not make them run in that order.', 'Give each thread its own argument, by value or in a slot of its own.'] },
      X('thr-x-three-count'), X('thr-x-code-squares'), X('thr-x-code-primes'), X('thr-x-arg'),
    ],
  });

  C.lesson({
    id: 'thr-own', chapter: 'thr-api', title: 'A variable of each thread\'s own', minutes: 6,
    summary: 'Some state is global in form but belongs to a thread in meaning: the last error code is the classic case. Shared by every thread, it can be overwritten between a thread\'s write and its read. Thread-local storage gives each thread its own copy under the same name; an array indexed by the thread\'s id does the same by hand.',
    blocks: [
      'A library function records why it failed in a global, last_error, and the caller reads it right after. In a single-threaded program that is fine. What can go wrong when two threads fail at nearly the same time?',
      { topic: 'thr-tls', input: { own: 'shared', seed: 25 }, frame: 0, caption: 'Two threads call fail() with codes of their own (T0 uses 1, T1 uses 11), then read last_error back. Both use the one global.' },
      { topic: 'thr-tls', input: { own: 'shared', seed: 25 }, frame: 8, caption: 'T0 has just set last_error to 1, and before it reads it back, T1 sets it to 11.' },
      { predict: { q: 'What does T0 read back?', options: ['1, its own code', '11, T1\'s code', '0'], answer: 1, explain: 'There is only one last_error, and T1 wrote it last: T0 prints "T0 set 1, read 11".' } },
      { topic: 'thr-tls', input: { own: 'shared', seed: 25 }, frame: 22, caption: 'This schedule went wrong. Over every schedule the kernel can produce there are 6 outputs, and 4 of them show a thread reading the other\'s code: a few test runs could easily miss it.' },
      { topic: 'thr-tls', input: { own: 'own', seed: 25 }, frame: 22, caption: 'With a copy per thread (an array indexed by the thread\'s id), there are 2 outputs, and in neither does a thread read the other\'s code: only the order of the lines varies.' },
      { def: 'thread-local storage', text: 'a variable with one copy per thread under one name. C11 writes it `_Thread_local int last_error;` and many compilers accept `__thread`. The C subset here does not, so the exercises keep one slot per thread instead.' },
      { h: 'Recap' },
      { list: ['A global written and read back by several threads can change in between.', 'Thread-local storage gives each thread its own copy under one name.', 'By hand: an array indexed by the thread\'s id, or state passed through the thread\'s argument.'] },
      X('thr-x-status-count'), X('thr-x-code-status'),
    ],
  });

  C.lesson({
    id: 'thr-cancel', chapter: 'thr-api', title: 'Stopping a thread safely', minutes: 6,
    summary: 'Cancelling a thread asynchronously can stop it anywhere, even holding a lock with its data half written. Deferred cancellation only stops a thread at its cancellation points, places where it holds nothing; cleanup handlers release what it does hold.',
    blocks: [
      'A user presses Stop and a worker must end now. The worker is in the middle of updating an account, holding a lock. What does "now" mean, and what is left behind?',
      { topic: 'thr-cancel', input: { mode: 'async' }, frame: 0, caption: 'W updates acct under the lock m; C cancels W; R then reads acct under m. Asynchronous cancellation may stop W after any of its steps.' },
      { topic: 'thr-cancel', input: { mode: 'async' }, frame: 4, caption: 'W locks m: it was free, so W now owns it.' },
      { predict: { q: 'C now cancels W, and W stops right here, owning m. R then tries to lock m. What happens?', options: ['R gets m: the kernel freed it when W stopped', 'R blocks for ever', 'R gets m once W\'s stack is freed'], answer: 1, explain: 'Nobody unlocks a mutex for a thread that has gone. R waits for good, and acct is left old.' } },
      { topic: 'thr-cancel', input: { mode: 'async' }, frame: 10, caption: 'Deadlock, found by the checker after 33 states: W was cancelled between lock(m) and unlock(m), so m stays locked by a thread that no longer exists.' },
      { topic: 'thr-cancel', input: { mode: 'deferred' }, frame: 1, caption: 'Deferred: W looks for a cancel only before taking m and after releasing it. The checker explores all 94 reachable states: no thread is ever stuck, and R never sees a half-updated account.' },
      { list: ['**Asynchronous**: the thread may stop between any two instructions. Safe only for code that holds nothing, like a pure computation.', '**Deferred** (the default): a cancel is recorded and acted on at the next cancellation point, such as pthread_testcancel, a sleep or a blocking read.', '**Cleanup handlers** (pthread_cleanup_push) run as the thread stops, to unlock what it holds.'] },
      { h: 'Recap' },
      { list: ['Asynchronous cancellation can leave locks held and data torn.', 'Deferred cancellation stops a thread only at its cancellation points.', 'Put cancellation points where the thread holds nothing, or release with a cleanup handler.'] },
      X('thr-x-cancel-async'), X('thr-x-cancel-point'),
    ],
  });

  C.lesson({
    id: 'thr-forkexec', chapter: 'thr-api', title: 'fork and exec in a threaded program', minutes: 7,
    summary: 'fork in a threaded program copies all the memory but only the calling thread. Locks held by the other threads are copied held, with no owner in the child to release them. exec ends every thread of the process and loads the new program into a single thread, with the same pid.',
    blocks: [
      'A threaded server forks a child to run a helper program. The parent had four threads. How many does the child have, and what has happened to the locks those threads were holding?',
      { topic: 'thr-fork', input: { v: 'lock' }, frame: 0, caption: 'main starts a thread, saver, that locks m and holds it for 2 seconds. main sleeps 1 second, so it forks while saver holds m.' },
      { topic: 'thr-fork', input: { v: 'lock' }, frame: 6, caption: 'fork copies process 100 into 102. The child has one thread, a copy of the caller; its copy of m is still marked held by thread 101, which was not copied.' },
      { predict: { q: 'The child now locks m. At 2 seconds, saver unlocks m in the parent. Does the child get it?', options: ['Yes, when saver unlocks', 'No: saver unlocks the parent\'s m, and the child\'s copy has no owner to release it', 'Yes at once, since the child has only one thread'], answer: 1, explain: 'After fork, the two m\'s are separate memory. The child waits on its own copy for ever, and the parent waits for the child: the program hangs.' } },
      { topic: 'thr-fork', input: { v: 'lock' }, frame: 12, caption: 'Nothing can run again: the child waits for its copy of m, which only thread 101 could unlock, and the parent waits for the child.' },
      { topic: 'thr-fork', input: { v: 'exec' }, frame: 19, caption: 'The safe pattern: the child calls exec straight away. exec throws away the copied memory, the stuck lock with it.' },
      { topic: 'thr-exec', input: { k: '2', who: 'main' }, frame: 12, caption: 'exec in a threaded program: main calls execl("/bin/echo"). Every other thread of process 100 is gone with the old image, 101 and 102 with it.' },
      { topic: 'thr-exec', input: { k: '2', who: 'main' }, frame: 15, caption: 'The output: ticks = 4, then a new image. echo ran as the single thread of process 100, the same pid.' },
      lab('Fork with a lock held', 'The hanging program, in the Process lab: step through it and watch the child block.', FORKLOCK, { policy: 'fifo' }),
      { h: 'Recap' },
      { list: ['fork copies every byte but only the calling thread.', 'Locks held by other threads are copied held, with no owner in the child.', 'After fork in a threaded program, a child should do only simple, safe calls, then exec.', 'exec ends every thread and starts the new program as one thread, same pid.'] },
      X('thr-x-fork-threads'), X('thr-x-fork-lock'), X('thr-x-exec-out'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: putting threads to work
  // =========================================================================================================
  C.lesson({
    id: 'thr-pool', chapter: 'thr-patterns', title: 'A thread pool', minutes: 7,
    summary: 'A pool creates a fixed number of worker threads once. Work goes into a queue guarded by a mutex and a condition variable; an idle worker takes the next task, runs it with the lock released, and comes back for more. The number of threads stays bounded however much work arrives.',
    blocks: [
      'A server that starts a thread for every request pays for a create and an exit each time, and a sudden flood of ten thousand requests means ten thousand stacks. What if a few threads were made once and kept busy instead?',
      { topic: 'thr-pool', frame: 0, caption: 'main queues 5 tasks of 3, 1, 4, 2 and 2 steps for a pool of 2 workers, then marks the queue closed. A worker holds m only while it looks at the queue.' },
      { topic: 'thr-pool', frame: 7, caption: 'W1 takes task 0 (3 steps) from the front of the queue, under m.' },
      { predict: { q: 'W1 is about to run task 0, 3 steps long. Should it keep m while it runs?', options: ['Yes, so nobody touches the queue meanwhile', 'No: it releases m first, so the other worker can take a task in the meantime'], answer: 1, explain: 'Holding m through the task would let only one worker run at a time: the pool would be no faster than one thread. The lock guards the queue, not the work.' } },
      { topic: 'thr-pool', frame: 28, caption: 'main signals c, but nobody waits: the signal is lost, since a condition variable keeps no count. That is why a worker checks the queue itself before waiting.' },
      { topic: 'thr-pool', frame: 42, caption: 'Every thread finished after 172 steps. W1 ran 3 tasks and W2 ran 2: 5 tasks with 2 threads made once, where a thread per task would have made 5.' },
      { topic: 'thr-pool', input: { workers: '3', costs: ['8', '1', '1', '1', '1', '1'], seed: 5 }, frame: 0, caption: 'Try the preset "Three workers, a long task": while one worker is stuck on the 8-step task, the others drain the short ones.' },
      { h: 'Recap' },
      { list: ['A pool makes its threads once; the number of threads stays bounded.', 'The queue is shared: a mutex guards it, a condition variable lets idle workers sleep.', 'A worker holds the lock only to take a task, never while running it.'] },
      X('thr-x-pool-why'), X('thr-x-pool-finish'), X('thr-x-pool-table'),
    ],
  });

  C.lesson({
    id: 'thr-forkjoin', chapter: 'thr-patterns', title: 'Fork-join: split, work, join, combine', minutes: 6,
    summary: 'Fork-join splits a job into parts, runs each part in its own thread, waits for every part with join, then combines the results. If each part writes only its own result slot, no locking is needed: the join is the synchronisation.',
    blocks: [
      'Summing nine numbers takes nine additions in a row. With three threads, each could sum three of them at the same time. How do the threads split the work, and when may main add up their partial sums?',
      { topic: 'thr-forkjoin', frame: 0, caption: '9 numbers, 3 threads: thread id sums from data[id·9/3] up to, but not including, data[(id + 1)·9/3]. The slices are 0–2, 3–5 and 6–8.' },
      { topic: 'thr-forkjoin', frame: 14, caption: 'Thread 101 stores its partial sum, 27, in part[0]. The other two are still adding: part[] is [27, 0, 0].' },
      { predict: { q: 'main is about to add part[1] into total. Thread 102 has not stored its sum yet. What must main do first?', options: ['Join thread 102', 'Lock a mutex around part', 'Nothing: part[1] will be right by then'], answer: 0, explain: 'part[1] holds its final value only once thread 102 has finished, and pthread_join(102) is how main knows that. No lock is needed: no two threads write the same slot.' } },
      { topic: 'thr-forkjoin', frame: 33, caption: 'main printed total = 125. With a core per thread the sums take as long as the longest slice, 3 additions instead of 9, plus the cost of creating and joining 3 threads.' },
      { topic: 'thr-forkjoin', input: { k: '4', data: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] }, frame: 0, caption: 'Ten over four does not divide: the integer division gives slices of 2, 3, 2 and 3, covering every index once.' },
      { h: 'Recap' },
      { list: ['Split the work into parts, one per thread.', 'Each thread writes only its own result slot.', 'Join each thread before reading its result; then combine.'] },
      X('thr-x-slices'), X('thr-x-code-sum'),
    ],
  });

  C.lesson({
    id: 'thr-parfor', chapter: 'thr-patterns', title: 'Parallel loops and implicit threading', minutes: 7,
    summary: 'A parallel loop hands its iterations to a few workers. Static blocks give each worker one run of iterations; cyclic deals them out in turn; dynamic lets an idle worker take the next chunk. When costs are uneven, dynamic sharing finishes sooner. Implicit threading lets a runtime make these choices: the programmer only says what may run in parallel.',
    blocks: [
      'A loop of 9 iterations, three workers. If every iteration cost the same, any fair split would do. But the costs grow along the loop, from 1 to 6. Which split ends first?',
      { topic: 'thr-parfor', input: { policy: 'static' }, frame: 0, caption: '9 iterations costing 27 in all, for 3 workers: a perfect split would end at 9.' },
      { topic: 'thr-parfor', input: { policy: 'static' }, frame: 10, caption: 'Static blocks: W2 gets the three most expensive iterations and works until 15, while W0 is idle from 4. The loop ends when its busiest worker does.' },
      { predict: { q: 'With dynamic sharing, an idle worker takes the next iteration. Will the loop end before 15?', options: ['Yes', 'No, it ends at 15 too', 'It ends later'], answer: 0, explain: 'It ends at 11: as soon as a worker is free it takes more work, so no one sits idle while others are loaded. Cyclic happens to end at 11 too on these costs.' } },
      { topic: 'thr-parfor', input: { policy: 'dynamic' }, frame: 10, caption: 'Dynamic, one at a time: the loop ends at 11, the workers busy for 7, 9 and 11. The best possible was 9; static ended at 15.' },
      'Dynamic sharing costs a little: every handout is a trip to a shared counter under a lock. Bigger chunks make fewer trips but can leave the last worker with a long tail. The exercises compare chunk sizes on one loop.',
      { h: 'Implicit threading' },
      'Writing pthread_create for every loop is tedious and easy to get wrong. In implicit threading the programmer marks what may run in parallel, a loop or a set of tasks, and a runtime does the rest: it keeps a pool of about one thread per core and chooses the split, static or dynamic. Compiler directives for parallel loops, task queues served by a pool, and fork-join frameworks with work stealing all follow this idea.',
      { h: 'Recap' },
      { list: ['Static blocks: cheap, but uneven costs leave workers idle.', 'Cyclic: deals iterations out in turn; good when cost grows smoothly.', 'Dynamic: an idle worker takes the next chunk; balances uneven work.', 'Implicit threading: say what may run in parallel; a runtime decides how.'] },
      X('thr-x-parfor-static'), X('thr-x-cyclic-set'), X('thr-x-parfor-three'), X('thr-x-parfor-chunk'), X('thr-x-implicit'), X('thr-x-code-dynamic'),
    ],
  });

  C.lesson({
    id: 'thr-amdahl', chapter: 'thr-patterns', title: 'Concurrency, parallelism and Amdahl\'s law', minutes: 6,
    summary: 'Concurrency is a structure, several things in progress; parallelism is several things at the same instant, which needs cores. When a fraction s of a program must run alone, n cores give a speed-up of 1 / (s + (1 − s)/n), which can never pass 1/s.',
    blocks: [
      'A program spends a fifth of its time reading its input, which cannot be split, and the rest crunching numbers, which splits perfectly. Sixteen cores: sixteen times faster?',
      { topic: 'thr-amdahl', frame: 0, caption: 'On one core, the 4 threads take turns: concurrent, not parallel, and the whole still takes 100. Concurrency only speeds things up when there are cores to run on.' },
      { topic: 'thr-amdahl', frame: 2, caption: '2 cores: the serial 20 stays, the parallel 80 becomes 40, so the time is 60 and the speed-up 1.67.' },
      { predict: { q: 'On 16 cores, what speed-up does this program reach?', options: ['16', '8', '4'], answer: 2, explain: 'The serial 20 stays, the parallel 80 becomes 5: the time is 25, a speed-up of 4, just 25% of the 16 that perfect scaling would give.' } },
      { topic: 'thr-amdahl', frame: 5, caption: '16 cores: time 25, speed-up 4.' },
      { math: 'speed-up(n) = 1 / (s + (1 − s) / n)\nas n grows:  speed-up → 1 / s' },
      { topic: 'thr-amdahl', frame: 6, caption: 'With s = 0.2 the speed-up creeps up towards 1/s = 5 however many cores are added. To go faster, shrink the serial part.' },
      { topic: 'thr-amdahl', input: { serial: 5, max: '64' }, frame: 8, caption: 'With 5% serial, 64 cores give 15.42, and no number of cores can beat 20.' },
      { h: 'Recap' },
      { list: ['Concurrency is structure; parallelism needs cores.', 'Amdahl: speed-up(n) = 1 / (s + (1 − s)/n), at most 1/s.', 'A small serial part caps a large machine: shrink it first.'] },
      X('thr-x-concurrent'), X('thr-x-amdahl'), X('thr-x-amdahl-cores'), X('thr-x-amdahl-limit'),
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
