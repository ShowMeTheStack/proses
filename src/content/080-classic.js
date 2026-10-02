// Part 8, classic problems and concurrency bugs: the chapters and the lessons. The exercises are in 081-classic-ex.js
// and 081-classic-ex2.js; the challenges, the guided tour, the course and the pages the diagram checker looks at are
// in 082-classic-ch.js. Each lesson opens with a situation, runs the topic that shows it at a chosen frame, asks for a
// prediction, sums up and leads to its exercises. Every value quoted here comes from the topics' own runs (the step
// machines of S.Sync and the model checker S.MC), on the inputs named in each block.
(function (S) {
  'use strict';
  const C = S.Content;
  if (!C || C.lessons.has('cls-buffer-sem')) return;
  const X = (id) => ({ exercise: id });
  /** a card that opens the Sync lab on one of its ready-made programs (S.SyncLab.PROGS) */
  const lab = (id, title, text) => {
    const p = ((S.SyncLab && S.SyncLab.PROGS) || []).find((q) => q.id === id);
    return { lab: 'sync', title, text, setup: p ? { src: p.src, spec: p.spec, gran: p.gran, mode: p.mode } : {} };
  };

  C.chapter({ id: 'cls-buffer', part: 'classic', n: 1, title: 'Producers and consumers', blurb: 'A bounded buffer guarded by semaphores, the two classic ways to break it, and the same buffer built from a mutex and condition variables.' });
  C.chapter({ id: 'cls-rw', part: 'classic', n: 2, title: 'Readers and writers', blurb: 'A room many readers may share but a writer must have alone: who goes first, who can be kept out for ever, and one line that is fair to both.' });
  C.chapter({ id: 'cls-table', part: 'classic', n: 3, title: 'Philosophers, barbers and barriers', blurb: 'The dining philosophers and their deadlock, three fixes and the clean-and-dirty-fork idea, the sleeping barber, the cigarette smokers, barriers, and boats crewed by two rowers and a cox.' });
  C.chapter({ id: 'cls-bugs', part: 'classic', n: 4, title: 'Concurrency bugs and event loops', blurb: 'Atomicity and order violations, deadlocks from lock order, the lost wake-up, and a server that needs no threads at all.' });
  // =========================================================================================================
  // Chapter 1: producers and consumers
  // =========================================================================================================
  C.lesson({
    id: 'cls-buffer-sem', chapter: 'cls-buffer', title: 'A ring of slots and three semaphores', minutes: 8,
    summary: 'A bounded buffer lets producers and consumers run at their own pace. Two counting semaphores, empty and full, make a producer wait for a free slot and a consumer for an item; a third, used as a mutex, lets one thread at a time move the ring\'s indices.',
    blocks: [
      'A print server takes jobs from many programs and feeds them to one printer. The programs should not wait for the printer, and the printer should not spin while nothing is queued. Between them sits a buffer with room for a few jobs. What must happen when it is full, and when it is empty?',
      { def: 'bounded buffer', text: 'a ring of N slots shared by producers, which put items in at index `in`, and consumers, which take them out at index `out`. A producer must wait while all N slots are taken, a consumer while none is.' },
      { code: 'producer:  wait(empty); wait(mutex); buf[in] = item; in = (in + 1) % N; post(mutex); post(full)\nconsumer:  wait(full);  wait(mutex); item = buf[out]; out = (out + 1) % N; post(mutex); post(empty)', lang: 'text' },
      'Each semaphore counts something. `empty` starts at N and counts the free slots; `full` starts at 0 and counts the items; `mutex` starts at 1 and lets one thread at a time touch the indices.',
      { topic: 'classic-buffer-sem', frame: 0, caption: 'A ring of 3 slots, 2 producers and 1 consumer: empty starts at 3, full at 0 and mutex at 1. The scheduler picks a ready thread at random (seed 4).' },
      { topic: 'classic-buffer-sem', frame: 1, caption: 'The consumer runs first and waits on full, which is 0: C1 blocks, and joins the queue of full.' },
      { topic: 'classic-buffer-sem', frame: 12, caption: 'P2 posts full while C1 waits: the post wakes C1, and full stays 0. A post either wakes a sleeper or raises the count, never both.' },
      { predict: { q: 'The ring has 3 slots and every one is taken: empty is 0. A producer calls wait(empty). What happens?', options: ['It blocks until a consumer posts empty', 'It goes on and overwrites the oldest item', 'empty goes to −1 and it goes on'], answer: 0, explain: 'A wait on a semaphore at 0 blocks. At step 18 of this run P1 does exactly that, and at step 23 P2 joins it: the queue of empty is [P1, P2]. The consumer\'s post(empty) at step 27 wakes P1, the first in line.' } },
      { topic: 'classic-buffer-sem', frame: 27, caption: 'C1 frees a slot and posts empty: P1, first in the queue, wakes and passes its wait, and P2 waits on.' },
      { topic: 'classic-buffer-sem', frame: 37, caption: 'After 36 steps, 4 items have gone in and 1 has come out, in order. empty + full = 0 + 2 = 2: the third slot belongs to a thread between a wait and its matching post.' },
      { tip: 'The invariant empty + full + (threads between a wait and its post) = N holds at every step. It is a quick check on any hand trace.' },
      lab('buffer', 'The bounded buffer in the Sync lab', 'The same ring in C, with the slots, the semaphores and every thread\'s line drawn as it runs.'),
      { warn: C.macSem },
      { h: 'Recap' },
      { list: ['empty counts free slots, full counts items, mutex guards the indices.', 'A wait at 0 blocks; a post wakes the first waiter if there is one, else raises the count.', 'Producers and consumers each wait on one counting semaphore and post the other.'] },
      X('cls-x-sem-slot'), X('cls-x-sem-buf'), X('cls-x-buf-count'), X('cls-x-out-slot'),
    ],
  });

  C.lesson({
    id: 'cls-buffer-broken', chapter: 'cls-buffer', title: 'Two ways to break the buffer', minutes: 7,
    summary: 'Drop the mutex and two producers can write the same slot: an item is lost. Swap a producer\'s two waits and it can sleep on a full ring while holding the mutex the consumers need: a deadlock. The model checker finds each in a few steps.',
    blocks: [
      'The bounded buffer has three semaphores. Each looks as if it might be spared, and each ordering looks arbitrary. Which changes actually break it?',
      { topic: 'classic-buffer-broken', input: { variant: 'no-mutex' }, frame: 0, caption: 'No mutex, a ring of 2, two producers and two consumers. Each producer asserts that the slot it writes is empty.' },
      { topic: 'classic-buffer-broken', input: { variant: 'no-mutex' }, frame: 1, caption: 'The checker searches every schedule, 137 states, and stops at a failed assertion; the shortest schedule that reaches it has 5 steps.' },
      { topic: 'classic-buffer-broken', input: { variant: 'no-mutex' }, frame: 7, caption: 'Both producers passed wait(empty), since 2 slots were free, and reached the same `in` before either moved it: the second would write over the first item.' },
      'The semaphores count slots; they say nothing about *which* slot. Two producers may both be entitled to a slot and still collide on the index. The mutex makes "write here, move on" one indivisible step.',
      { predict: { q: 'Now keep the mutex but let the producer take it before it waits for a free slot. What will the checker report?', options: ['A lost item (an assertion)', 'A deadlock', 'Nothing wrong'], answer: 1, explain: 'On a full ring the producer sleeps on empty while holding the mutex; the consumers that would post empty queue for the mutex behind it.' } },
      { topic: 'classic-buffer-broken', input: { variant: 'swapped' }, frame: 17, caption: 'Waits swapped: P1 holds the mutex and waits on empty, which is 0. The ring is full.' },
      { topic: 'classic-buffer-broken', input: { variant: 'swapped' }, frame: 23, caption: 'Stuck after 21 steps: P1 waits on empty; P2, C1 and C2 wait on the mutex P1 holds. Nobody is left to post empty.' },
      { warn: 'Never sleep on a semaphore or a condition while holding a lock another thread needs to wake you. Wait for the resource first, then take the lock.' },
      lab('buffer-swapped', 'The swapped waits in the Sync lab', 'Run the checker on the C version and replay the deadlock step by step.'),
      { h: 'Recap' },
      { list: ['Without the mutex, two producers can write the same slot: a lost item.', 'With the waits swapped, a producer sleeps holding the mutex: a deadlock.', 'Count with semaphores, protect the indices with the mutex, and never hold the mutex while you wait.'] },
      X('cls-x-buf-swap'), X('cls-x-buf-nomutex'), X('cls-x-buf-code'),
    ],
  });

  C.lesson({
    id: 'cls-buffer-cv', chapter: 'cls-buffer', title: 'The buffer with condition variables', minutes: 9,
    summary: 'A mutex and two condition variables, notFull and notEmpty, build the same buffer. With Mesa semantics a woken thread must take the mutex back, and someone else may get there first, so the condition must be tested again in a while loop. One condition variable for both kinds of thread can wake the wrong kind and leave everyone asleep.',
    blocks: [
      'Semaphores count for you. A condition variable counts nothing: a thread holding a mutex tests a condition in shared variables and, when it is false, sleeps on the condition variable, releasing the mutex. Another thread changes the variables and signals. What can go wrong between the signal and the wake-up?',
      { code: 'consumer:  lock(m)\n           if (count == 0) wait(notEmpty, m)     /* the bug: if, not while */\n           take; count--\n           signal(notFull); unlock(m)', lang: 'text' },
      { topic: 'classic-buffer-cv', input: { variant: 'if' }, frame: 0, caption: 'A ring of 1 slot, 1 producer and 2 consumers, testing with if, under Mesa semantics.' },
      { topic: 'classic-buffer-cv', input: { variant: 'if' }, frame: 14, caption: 'The producer has put an item and signals notEmpty: C1 leaves the condition\'s queue, but must take the mutex back before it returns from its wait. C2 is already queued for the mutex.' },
      { predict: { q: 'The producer unlocks m. C2 is first in the mutex queue, C1 second. When C1 finally returns from its wait, what does it find?', options: ['An empty slot: C2 took the item first', 'The item, waiting for it', 'A full slot with a new item'], answer: 0, explain: 'The mutex goes to C2, which takes the item and empties the slot. C1 then returns from the wait and, testing with if, does not look again.' } },
      { topic: 'classic-buffer-cv', input: { variant: 'if' }, frame: 27, caption: 'C1 reads buf[0], which is empty, and its assertion that the item is real fails, 26 steps into the shortest failing schedule.' },
      'With **while** instead of **if**, C1 tests `count == 0` again after waking and goes back to sleep. Under Hoare semantics, where the signal hands the mutex straight to the woken thread, the if would be enough: the checker finds the Hoare version correct over all 862 states. Real thread libraries are Mesa-style, so always loop.',
      { topic: 'classic-buffer-cv', input: { variant: 'while-1' }, frame: 1, caption: 'With while and one consumer: 131 states, no failed assertion, no deadlock, and no thread waits for ever.' },
      { h: 'One condition for everyone' },
      { topic: 'classic-buffer-cv', input: { variant: 'one-cv' }, frame: 0, caption: 'Two producers and two consumers share one condition variable cv. A signal can wake a thread of the wrong kind.' },
      { topic: 'classic-buffer-cv', input: { variant: 'one-cv' }, frame: 1, caption: 'The checker finds a deadlock in 1085 states: a consumer signals and wakes another consumer instead of a producer, and one by one all four end up asleep on cv.' },
      { tip: 'Either give each kind of waiter its own condition variable (notFull, notEmpty) or wake everyone with broadcast and let each re-test.' },
      lab('cv-if', 'If, not while, in the Sync lab', 'The C version of the buffer with if; change it to while and check again.'),
      { h: 'Recap' },
      { list: ['Wait on a condition variable only while holding its mutex, and test the condition in a while loop.', 'Mesa semantics: a signalled thread competes for the mutex again, so the condition may be false by the time it runs.', 'One condition for two kinds of waiter can wake the wrong one: use two, or broadcast.'] },
      X('cls-x-cv-code'), X('cls-x-cv-if'), X('cls-x-cv-onecv'),
    ],
  });

  // =========================================================================================================
  // Chapter 2: readers and writers
  // =========================================================================================================
  // the model checker's numbers for the readers-writers topics: states, steps before the cycle, the cycle's length
  const rwVals = (id, input, d) => { const t = S.byId && S.byId(id); const f = t ? t.run(S.inputOf(t, input || {})).frames[1] : null; return (f && f.meta && f.meta.vals) || d; };
  const RWR = rwVals('classic-rw-starve', {}, [608, 18, 26]), RWW = rwVals('classic-rw-starve', { variant: 'writer', readers: 1, writers: 2 }, [2531, 20, 30]), RWF = rwVals('classic-rw-starve', { variant: 'fair' }, [1087]);
  C.lesson({
    id: 'cls-rw-room', chapter: 'cls-rw', title: 'A room for readers and writers', minutes: 8,
    summary: 'Many readers may look at shared data at once, but a writer needs it alone. A reader-preferring lock counts the readers: the first one in locks the room against writers and the last one out unlocks it. It is safe, and it is quick for readers, but it lets readers overlap without end.',
    blocks: [
      'A timetable is read thousands of times a minute and changed a few times a day. A plain mutex would make every reader wait for every other. Can readers share, while a writer still gets the timetable to itself?',
      { code: 'reader:  wait(count_lock); rc++; if (rc == 1) wait(room); post(count_lock)\n         read\n         wait(count_lock); rc--; if (rc == 0) post(room); post(count_lock)\nwriter:  wait(room); write; post(room)', lang: 'text' },
      'Only the first reader in waits on `room`, and only the last one out posts it. A writer waits on `room` directly, so it needs the room empty of readers and writers alike.',
      { topic: 'classic-rw', frame: 0, caption: '2 readers and 1 writer loop for ever with the reader-preferring lock; the scheduler picks at random (seed 3).' },
      { topic: 'classic-rw', frame: 11, caption: 'R2 is the first reader in: it waits on room, which W1 has just released, and goes in.' },
      { predict: { q: 'R2 is in the room. W1 waits on the room. Now R1 arrives. Does it go in?', options: ['Yes, it goes on', 'No, it blocks behind W1'], answer: 0, explain: 'R1 finds rc already at 1, so it skips the wait on the room. At step 18 rc goes from 1 to 2 and R1 is in, while W1 still waits.' } },
      { topic: 'classic-rw', frame: 17, caption: 'W1 waits on room, which is 0: the readers hold the room.' },
      { topic: 'classic-rw', frame: 41, caption: 'In 40 steps, 3 reads and 1 write began, and no writer ever shared the room. The checker confirms it over all ' + RWR[0] + ' states, but finds that W1 can be kept out for ever.' },
      { topic: 'classic-rw', input: { variant: 'writer' }, frame: 0, caption: 'The writer-preferring lock: a waiting writer shuts a second semaphore, door, on new readers. Now a stream of writers can keep readers out instead.' },
      lab('rw-readers', 'Readers first, in the Sync lab', 'The reader-preferring lock in C, with its specification "no reader while a writer" and the liveness check.'),
      { h: 'Recap' },
      { list: ['Readers share the room; a writer needs it alone.', 'The first reader in locks the room, the last one out unlocks it; rc is guarded by its own mutex.', 'Safe, but a stream of overlapping readers can keep a writer out for ever.'] },
      X('cls-x-rw-in'), X('cls-x-sem-rw'),
    ],
  });

  C.lesson({
    id: 'cls-rw-starve', chapter: 'cls-rw', title: 'Starvation made visible', minutes: 8,
    summary: 'Safety says nothing bad ever happens; liveness says something good eventually does. A liveness check finds a cycle of states the others can repeat for ever while one thread never gets in. Readers first starves writers, writers first starves readers, and one line in front of both serves everyone in arrival order.',
    blocks: [
      'No assertion fails, nobody deadlocks, and yet one thread never gets its turn. How do we show that? A test that runs a while and stops proves nothing: the writer might have got in a moment later.',
      { def: 'starvation', text: 'a thread that is ready to make progress waits for ever while the others go on. Shown by a cycle in the state space that the other threads can go round again and again, under a fair scheduler that never ignores a thread that could run.' },
      { topic: 'classic-rw-starve', frame: 1, caption: 'Readers first: every one of the ' + RWR[0] + ' states is safe, but after ' + RWR[1] + ' steps the readers can go round a cycle of ' + RWR[2] + ' steps for ever while W1 never gets in.' },
      { topic: 'classic-rw-starve', frame: 46, caption: 'Each reader comes back in before the other leaves, so the room never empties and the semaphore room is never posted.' },
      { predict: { q: 'Switch to writers first, with 1 reader and 2 writers. Can some thread be kept out for ever?', options: ['Yes, a writer', 'Yes, the reader', 'No'], answer: 1, explain: 'The writers take turns, so the count of waiting writers never drops to 0 and the reader\'s door stays shut: the checker finds a ' + RWW[2] + '-step cycle after ' + RWW[1] + ' steps, among ' + RWW[0] + ' states.' } },
      { topic: 'classic-rw-starve', input: { variant: 'writer', readers: 1, writers: 2 }, frame: 52, caption: 'Writers first: the writers keep the door shut by taking turns, so R1 never gets in.' },
      { h: 'One queue for everyone' },
      'Put one more semaphore, `line`, in front of both. Every reader and every writer waits in that one line, in arrival order. A writer keeps its place at the head of the line while it waits for the room, so readers who arrive after it queue behind it; the readers inside drain out, and the writer goes in.',
      { code: 'reader:  wait(line); wait(count_lock); rc++; if (rc == 1) wait(room); post(line); post(count_lock)\n         read; ...leave as before...\nwriter:  wait(line); wait(room); post(line); write; post(room)', lang: 'text' },
      { topic: 'classic-rw-starve', input: { variant: 'fair' }, frame: 1, caption: 'One line for everyone: ' + RWF[0] + ' states, no deadlock, no broken invariant, and no way for any thread to wait for ever.' },
      lab('rw-fair', 'One line for everyone, in the Sync lab', 'Check it, then add a reader or a writer and check again.'),
      { h: 'Recap' },
      { list: ['Readers first starves writers; writers first starves readers.', 'A liveness check finds the cycle that a starving thread never leaves.', 'One line in front of both gives everyone a place in arrival order.'] },
      X('cls-x-rw-starve'), X('cls-x-rw-door'), X('cls-x-rw-fair'), { challenge: 'cls-ch-rwlock' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
