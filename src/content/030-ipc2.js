// Part 3, inter-process communication and signals: the lessons of the second half. Clients, servers and remote calls
// close the chapter on messages; then signals, and a small shell built step by step. Every value quoted here was
// worked out by the engines on the topics' own inputs (S.Kern running the topics' C programs, and S.Ipc).
(function (S) {
  'use strict';
  const C = S.Content, P3 = S.P03;
  if (!C || !P3 || C.lessons.has('ipc-net')) return;
  const X = (id) => ({ exercise: id });
  // how the full-backlog scene ends for client2, from the topic's own frames
  const fullEnd = (() => { const t = S.byId && S.byId('p03-sockets'); const fr = t ? t.run(S.inputOf(t, { scene: 'full' })).frames : []; const f = fr.find((x) => x.meta && x.meta.phase === 'timeout'); const m = f && f.meta.backoff; return { err: f ? (/(E[A-Z]+)\.?$/.exec(f.say) || [, 'ETIMEDOUT'])[1] : 'ETIMEDOUT', waits: m ? m.waits : [1, 2, 4], spent: m ? m.total[m.total.length - 1] : 7 }; })();
  const shellLab = (title, text, session) => ({ lab: 'shell', title, text, setup: { session, policy: 'random', show: 'jobs' } });

  // =========================================================================================================
  // Chapter 2 (end): clients, servers and remote calls
  // =========================================================================================================
  C.lesson({
    id: 'ipc-net', chapter: 'ipc-talk', title: 'Clients, servers and remote calls', minutes: 9,
    summary: 'Between machines, processes talk through sockets: a server binds a port, listens and accepts, and each client connects. A remote procedure call hides the messages behind a stub that marshals the arguments into bytes. When a reply does not come, the client cannot tell a lost request from a lost reply, and sends again; an at-most-once server remembers request ids so a retried call does not run twice.',
    blocks: [
      'A program on your laptop calls `deposit(25)`, and the account lives on a server across the network. The reply does not come back. Did the deposit happen? Should the program call it again?',
      { def: 'socket', text: 'an end of a communication channel, named by a descriptor. A server\'s listening socket is bound to a port; each connection a client makes is accepted as a new socket, one per client.' },
      { topic: 'p03-sockets', input: { scene: 'one' }, frame: 5, caption: 'client1 connects to port 8080: SYN, SYN-ACK, ACK. The connection is set up and waits in the backlog (1 of 4) until the server accepts it.' },
      { topic: 'p03-sockets', input: { scene: 'one' }, frame: 6, caption: 'accept gives the server a new socket c for this client only; the listening socket keeps listening for the next one.' },
      { topic: 'p03-sockets', input: { scene: 'full' }, frame: 6, caption: 'A backlog of 1, already taken by client1: the server drops client2\'s SYN without a reply. client2 will retransmit after waits of ' + fullEnd.waits.join(', ').replace(/, (\d+)$/, ' and $1') + ' s; if there is still no room after ' + fullEnd.spent + ' s, connect fails with ' + fullEnd.err + '.' },
      { h: 'A call that looks local' },
      { topic: 'p03-rpc', input: { call: 'add', id: 5 }, frame: 2, caption: 'The client stub marshals b = -2 as a 4-byte two\'s-complement integer, most significant byte first: ff·ff·ff·fe.' },
      { topic: 'p03-rpc', input: { call: 'add', id: 5 }, frame: 3, caption: 'Request id 5 and procedure number 7 go in front: 16 bytes in all. The caller waits, as for any call.' },
      { topic: 'p03-rpc', input: { call: 'add', id: 5 }, frame: 9, caption: 'The client stub matches id 5 to the waiting call and returns {"sum":5}. The program never saw a byte.' },
      { h: 'When messages are lost' },
      { predict: { q: 'The server runs every request that arrives (at least once). It runs deposit(25), but the reply is lost on the way back, so the client times out and sends the same request again. What happens to the balance?', options: ['25 is added once: the server sees it is the same request', '25 is added twice', 'Nothing is added the second time: the first reply was already sent'], answer: 1, explain: 'An at-least-once server does not remember requests: the retry is just another request, and it runs deposit(25) again.' } },
      { topic: 'p03-rpc-retry', input: { calls: 'deposits', sem: 'at-least-once', loss: 0.3, dup: 0, seed: 1 }, frame: 5, caption: 'At least once: the reply to deposit(25) #101 was lost, so the client sent it again, and the server ran it a second time, from 135 to 160. The number ends at 165, where running each call once gives 140.' },
      { topic: 'p03-rpc-retry', input: { calls: 'deposits', sem: 'at-most-once', loss: 0.3, dup: 0, seed: 1 }, frame: 5, caption: 'At most once, same network: the retry of #101 is found in the server\'s table of ids, and the saved reply 135 goes back without running deposit again. The number ends at 140.' },
      'The network can also deliver one request twice, and the server cannot tell that copy from a retry either; the same table of ids handles both.',
      { tip: 'An idempotent call, one whose second run changes nothing (set the balance to 40, read it), is safe to retry under either rule. A deposit is not, so it needs at-most-once, or a request id the server can check.' },
      { h: 'Recap' },
      { list: ['Server: socket, bind, listen, accept (a new socket per client). Client: socket, connect.', 'An RPC stub marshals the arguments into bytes in a fixed order, sends them, and unmarshals the reply.', 'A lost reply looks like a lost request: the client retries; at-most-once servers answer repeats from a table.'] },
      X('ipc-x-backlog'), X('ipc-x-rpc-bytes'), X('ipc-x-idempotent'), X('ipc-x-retry-table'),
    ],
  });

  // =========================================================================================================
  // Chapter 3: signals
  // =========================================================================================================
  C.lesson({
    id: 'ipc-signals', chapter: 'ipc-signals', title: 'Signals, handlers and the mask', minutes: 8,
    summary: 'A signal is a small asynchronous notice to a process: ^C at the terminal, a child\'s exit, a kill from another process. Each signal has a default action (often to end the process); a process can ignore it or catch it with a handler, which the kernel runs on the process\'s own stack between two of its statements. A blocked signal stays pending until it is unblocked, and pending is one bit per signal: signals do not queue.',
    blocks: [
      'You press ^C while a long job runs, and it stops. The program never read a ^C from its input: what reached it, and could the program have chosen to carry on?',
      { def: 'signal', text: 'a numbered notice the kernel delivers to a process: SIGINT (2) for ^C, SIGKILL (9), SIGTERM (15), SIGCHLD (17 here) when a child ends, SIGALRM (14) when an alarm goes off. What the process does with it is its disposition: the default action, ignore, or a handler.' },
      { topic: 'p03-signal', input: { prog: 'deflt', presses: 1 }, frame: 5, caption: 'No handler: the default action of SIGINT ends the process. The shell\'s waitpid sees it was killed by SIGINT.' },
      { topic: 'p03-signal', input: { prog: 'handler', presses: 2 }, frame: 3, caption: 'This program set a handler for SIGINT and sleeps in pause. The user types ^C: the terminal sends SIGINT to the foreground group, 100.' },
      { topic: 'p03-signal', input: { prog: 'handler', presses: 2 }, frame: 5, caption: 'The kernel saves where process 100 was and runs on_int(2) on its own stack; the pause it was blocked in fails with EINTR.' },
      { topic: 'p03-signal', input: { prog: 'handler', presses: 2 }, frame: 7, caption: 'The handler returns, the kernel puts back the registers and mask, and the program carries on at line 12, where it was.' },
      { topic: 'p03-signal', input: { prog: 'ignore', presses: 2 }, frame: 4, caption: 'With SIG_IGN, SIGINT is dropped on arrival: the program ticks on as if nothing happened.' },
      { h: 'Holding a signal back' },
      { topic: 'p03-mask', input: { prog: 'once' }, frame: 3, caption: 'SIGUSR1 is blocked by the mask, so raise only marks it pending: the handler does not run yet.' },
      { topic: 'p03-mask', input: { prog: 'once' }, frame: 6, caption: 'sigprocmask unblocks it, and the pending SIGUSR1 is delivered at once: "in the handler" comes before "unblocked".' },
      { predict: { q: 'With SIGUSR1 blocked, the program raises it twice, then unblocks it. How many times does the handler run?', options: ['Twice', 'Once', 'Not at all'], answer: 1, explain: 'Pending is one bit per signal. The second raise finds the bit already set and changes nothing, so one delivery follows the unblock.' } },
      { topic: 'p03-mask', input: { prog: 'twice' }, frame: 8, caption: 'Two raises, one handler run: the program prints "ran 1 time".' },
      { warn: 'SIGKILL and SIGSTOP can be neither caught, nor ignored, nor blocked: they are how the system keeps control of any process.' },
      { h: 'Recap' },
      { list: ['A signal\'s disposition: the default action, ignore (SIG_IGN), or a handler.', 'A handler runs between two statements, on the process\'s stack; then the process carries on.', 'The mask holds signals pending; pending is a bit, so signals of one kind do not queue.'] },
      X('ipc-x-sig-default'), X('ipc-x-uncatchable'), X('ipc-x-mask-count'), X('ipc-x-alarm-race'),
    ],
  });

  C.lesson({
    id: 'ipc-sigchld', chapter: 'ipc-signals', title: 'SIGCHLD, kill and alarm', minutes: 9,
    summary: 'Whenever a child exits, the kernel sends its parent SIGCHLD. A parent with other work to do can reap in a SIGCHLD handler, calling waitpid with WNOHANG in a loop: several exits can arrive as one signal, and WNOHANG returns 0 rather than wait when no exited child is left. kill sends any signal to another process; SIGTERM can be caught, SIGKILL cannot. alarm sends the caller SIGALRM later.',
    blocks: [
      'A server forks a child for each job and cannot sit in wait: it has new requests to take. Yet every finished child must be reaped, or the process table fills with zombies. How does the parent learn that a child has ended, without stopping to ask?',
      { topic: 'p03-sigchld', input: { prog: 'loop' }, frame: 11, caption: 'Child 101 exits, and the kernel sends SIGCHLD to its parent. Process 100 was asleep in pause; it now runs its handler reap(17).' },
      { topic: 'p03-sigchld', input: { prog: 'loop' }, frame: 13, caption: 'The handler\'s first waitpid reaped 101; the second, with WNOHANG, returns 0 at once: no other child has exited yet, so the handler does not wait.' },
      { predict: { q: 'Children 102 and 103 now exit one right after the other, before the parent runs again. How many times does the handler run?', options: ['Twice, once per child', 'Once', 'Not at all'], answer: 1, explain: 'The second SIGCHLD finds the first still pending; the pending bit is already set, so the two exits arrive as one signal and the handler runs once.' } },
      { topic: 'p03-sigchld', input: { prog: 'loop' }, frame: 22, caption: 'One handler run, two reaps: the loop calls waitpid until none is left, reaping 102 and then 103. That is why the handler loops.' },
      { topic: 'p03-sigchld', input: { prog: 'once' }, frame: 23, caption: 'The same program with if instead of while: one handler run reaps only 102. Process 103 stays a zombie, and the parent waits in pause for a signal that will never come.' },
      { h: 'Signals between processes' },
      { topic: 'p03-kill', input: { prog: 'term' }, frame: 9, caption: 'kill(k, SIGTERM): the child caught it with bye, which called _exit(40 + 15). waitpid stores status 14080, and WEXITSTATUS gives 55.' },
      { topic: 'p03-kill', input: { prog: 'kill9' }, frame: 3, caption: 'The child tries to set a handler for signal 9: that signal cannot be caught, and signal fails with EINVAL.' },
      { topic: 'p03-kill', input: { prog: 'kill9' }, frame: 8, caption: 'SIGKILL ends the child whatever it does. WIFSIGNALED is true, and WTERMSIG gives 9.' },
      { topic: 'p03-kill', input: { prog: 'alarm' }, frame: 4, caption: 'alarm(2) at line 10: when the clock reaches 2.004 s the kernel sends the process SIGALRM, and its handler ring prints "ring 14".' },
      { tip: 'A handler may be called between any two statements of the program, so it should do little: set a flag, reap with WNOHANG, or call _exit. printf in a handler is not safe in real programs, since the program may itself be inside printf when the signal comes.' },
      { lab: 'process', title: 'Reap in a handler, in the Process lab', text: 'A SIGCHLD handler that reaps every child, with the signal view: each process\'s handlers, pending signals and mask.', setup: { src: P3.SIG_CHLD.loop.src, show: 'signals', policy: 'fifo', tty: true } },
      { h: 'Recap' },
      { list: ['A child\'s exit sends SIGCHLD to its parent.', 'Reap in the handler with while (waitpid(-1, &st, WNOHANG) > 0): exits can merge into one signal.', 'kill sends a signal; SIGTERM can be caught, SIGKILL cannot; alarm(n) sends SIGALRM n seconds later.'] },
      X('ipc-x-code-sigchld'), X('ipc-x-once-tree'), X('ipc-x-term-race'),
    ],
  });

  // =========================================================================================================
  // Chapter 4: building a shell
  // =========================================================================================================
  C.lesson({
    id: 'ipc-shell', chapter: 'ipc-shell', title: 'A shell: run, pipe, redirect', minutes: 9,
    summary: 'A shell is a loop: print a prompt, read a line, cut it into words, fork, and in the child exec the command; the shell waits for the child, then reads the next line. For cmd1 | cmd2 it makes a pipe, forks twice, and each child moves its end onto descriptor 0 or 1 with dup2 and closes the rest; the shell closes both ends too. For < and >, the child opens the file and moves it onto 0 or 1 before exec.',
    blocks: [
      'Every command you type at a terminal goes through a program that is itself a fairly small C loop. What does that loop do with `echo hi there`, and how can `ls | wc` join two programs that know nothing of each other?',
      { topic: 'p03-shell-run', input: { cmds: 'echo hi there; wc notes; frob' }, frame: 2, caption: 'The shell prints "$ " and its fgets reads the line "echo hi there".' },
      { topic: 'p03-shell-run', input: { cmds: 'echo hi there; wc notes; frob' }, frame: 5, caption: 'The child execs echo with argv "echo hi there": its image is replaced, but its pid and open descriptors stay. The shell meanwhile waits in waitpid.' },
      { topic: 'p03-shell-run', input: { cmds: 'echo hi there; wc notes; frob' }, frame: 24, caption: 'There is no program called frob: execvp returns, which it only does on failure, with ENOENT.' },
      { topic: 'p03-shell-run', input: { cmds: 'echo hi there; wc notes; frob' }, frame: 27, caption: 'The child reports the error and calls exit(127); the shell\'s waitpid gets exit code 127 and prints [exit 127].' },
      { h: 'Two commands and a pipe' },
      { topic: 'p03-shell-pipe', input: { pipe: 'lswc', closes: 'yes' }, frame: 7, caption: 'ls | wc: the first child calls dup2(4, 1), so its descriptor 1 names the write end of the pipe.' },
      { topic: 'p03-shell-pipe', input: { pipe: 'lswc', closes: 'yes' }, frame: 15, caption: 'The second child moved the read end onto 0 and closed 3 and 4: now the write end has 0 references, since ls has exited and the shell closed its copies too.' },
      { topic: 'p03-shell-pipe', input: { pipe: 'lswc', closes: 'yes' }, frame: 18, caption: 'wc reads "notes\\ntodo\\n" from its descriptor 0, then end of file, and prints 2 lines, 2 words, 11 bytes.' },
      { predict: { q: 'The shell forgets to close its own two pipe descriptors after the forks. What happens to wc?', options: ['Nothing changes', 'wc never sees end of file and waits for ever', 'wc gets SIGPIPE'], answer: 1, explain: 'The shell still holds a write end, so the pipe can never report end of file: wc waits in read, and the shell waits for wc.' } },
      { topic: 'p03-shell-pipe', input: { pipe: 'lswc', closes: 'no' }, frame: 18, caption: 'Left open: process 100 is blocked in wait and process 102, wc, is blocked in read. Neither will ever run again.' },
      { h: 'Redirection' },
      { topic: 'p03-shell-redir', input: { cmd: 'both' }, frame: 4, caption: 'sort < notes > sorted: in the child, open("notes") gives descriptor 3, and dup2(3, 0) moves it onto standard input.' },
      { topic: 'p03-shell-redir', input: { cmd: 'both' }, frame: 11, caption: 'After the same dance for "sorted" on descriptor 1, sort reads notes and writes "apple\\nfig\\npear\\n" into the file. The shell\'s own descriptors were never touched.' },
      shellLab('Pipelines in the Shell lab', 'Complete a small shell in C and type lines into it. This session runs a pipe, a three-stage pipeline and a redirection.', 'pipes'),
      { h: 'Recap' },
      { list: ['The loop: prompt, read, split into argv, fork, exec in the child, wait in the shell.', 'exec returns only on failure: report it and _exit(127).', 'cmd1 | cmd2: pipe, two forks, dup2 in each child, and every unused end closed, in the shell too.', '< and >: open in the child and dup2 onto 0 or 1, before exec.'] },
      X('ipc-x-exec-fail'), X('ipc-x-left-open'), X('ipc-x-code-redir-in'), X('ipc-x-code-pipeline'),
    ],
  });

  C.lesson({
    id: 'ipc-jobs', chapter: 'ipc-shell', title: 'Background jobs and job control', minutes: 8,
    summary: 'A line ending in & runs in the background: the shell forks and execs but does not wait, so it must reap the job later, in a SIGCHLD handler, or it leaves a zombie. Job control puts each job in a process group of its own and gives the terminal to the foreground job, so ^C reaches that job and not the shell.',
    blocks: [
      'You type `sleep 1 &` and the prompt comes back at once. A second later the job ends. Who waits for it? And when you later press ^C to stop a foreground job, why does your shell survive?',
      { topic: 'p03-shell-bg', input: { handler: 'yes' }, frame: 11, caption: 'The background job 101 ends and the kernel sends SIGCHLD; the shell, asleep, runs its handler reap.' },
      { topic: 'p03-shell-bg', input: { handler: 'yes' }, frame: 13, caption: 'waitpid reaps 101 and the handler prints [101] done; the next waitpid with WNOHANG returns 0 and the shell goes back to its work.' },
      { predict: { q: 'The same shell without a SIGCHLD handler, and it never calls wait. What becomes of the two jobs once they end?', options: ['They are reaped by the kernel at once', 'They stay zombies while the shell runs, and init reaps them when the shell exits', 'They keep running for ever'], answer: 1, explain: 'An exited child stays a zombie until its parent waits. When the shell exits, its children are re-parented to init, which reaps them.' } },
      { topic: 'p03-shell-bg', input: { handler: 'no' }, frame: 14, caption: 'No handler: 101 and 102 stayed zombies for as long as the shell ran. When it exits, they are re-parented to init, which reaps them.' },
      { h: 'Groups and the terminal' },
      { def: 'process group', text: 'a set of processes that receive terminal signals together. The terminal sends ^C (SIGINT) and ^Z (SIGTSTP) to its foreground group only. A shell puts each job in a group of its own with setpgid, and hands the terminal to the foreground job with tcsetpgrp.' },
      { topic: 'p03-shell-jobs', input: { groups: 'yes' }, frame: 4, caption: 'The shell put the job in process group 101 and gave the terminal to that group: ^C and ^Z now go to it.' },
      { topic: 'p03-shell-jobs', input: { groups: 'yes' }, frame: 9, caption: 'The user types ^C: the terminal sends SIGINT to the foreground group 101 only, and sleep is killed.' },
      { topic: 'p03-shell-jobs', input: { groups: 'yes' }, frame: 13, caption: 'The shell reaps the job (status 2: killed by SIGINT) and takes the terminal back for its own group, 100.' },
      { topic: 'p03-shell-jobs', input: { groups: 'no' }, frame: 8, caption: 'Without a group of its own, the job shares the shell\'s group 100: ^C reaches both, and the shell dies with its job.' },
      shellLab('Jobs in the Shell lab', 'A background job, then ^C on a foreground one. The stage shows every process group and which one owns the terminal.', 'jobs'),
      shellLab('Zombies in the Shell lab', 'Two background jobs end while the shell is reading. With no SIGCHLD handler they stay zombies; add one and watch them go.', 'zombies'),
      { h: 'Recap' },
      { list: ['cmd &: fork and exec, no wait; reap later in a SIGCHLD handler with WNOHANG.', 'A child never waited for is a zombie until init adopts and reaps it.', 'Each job gets its own process group; the foreground group owns the terminal and gets ^C and ^Z.'] },
      X('ipc-x-bg-tree'), X('ipc-x-ctrlc-group'),
      { challenge: 'ipc-ch-pipes' }, { challenge: 'ipc-ch-jobs' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
