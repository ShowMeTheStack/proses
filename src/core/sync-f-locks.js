// Critical sections and the locks that build them, as machine specs with spec.check, spec.expect,
// spec.expectLive and spec.about (see sync-d-classic.js). Every lock program loops for ever: lock, the critical
// section (enter, leave), unlock.
//   S.Sync.counter(variant, n)   n threads each do count++ once: 'race' (load, add, store as three steps), 'mutex'
//                                (inside a lock), 'atomic' (fetch-and-add); the invariant: at the end count = n
//   S.Sync.peterson(variant)     two threads: 'correct' | 'flags-only' (each raises its flag and waits while the
//                                other's is up) | 'turn-only' (strict alternation; T1 wants in only once) |
//                                'check-then-set' (look at the other's flag before raising one's own) | 'tso'
//                                (correct code on a machine with store buffers) | 'tso-fence' (a fence after the
//                                stores)
//   S.Sync.spinlock(kind, n)     'tas' (test-and-set) | 'cas' (compare-and-swap) | 'ticket' (fetch-and-add tickets,
//                                served in order) | 'mcs' (a queue lock: each waiter spins on its own flag)
//   S.Sync.bug(kind, fixed)      the concurrency bugs: 'atomicity' (check, then use, with a gap between) | 'order'
//                                (use before the other thread initialises) | 'lost-wakeup' (test a flag outside the
//                                lock, then wait); fixed: true gives the repaired version
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});
  const H = () => Y.helpers;
  const CS = [{ op: 'enter', label: 'enters the critical section', mark: 'progress' }, { op: 'leave', label: 'leaves it' }];

  Y.counter = function (variant, n) {
    const v = variant || 'race', N = n || 2;
    const body = v === 'race' ? [{ op: 'read', v: 'count', into: 'r', label: 'load: r = count' }, { op: 'local', fn: (r) => { r.r++; }, label: 'add: r = r + 1', say: (r, th) => `${th.name} adds 1 in its register: r = \`${r.r}\`.` }, { op: 'write', v: 'count', val: (r) => r.r, label: 'store: count = r' }]
      : v === 'mutex' ? [{ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'read', v: 'count', into: 'r', label: 'load: r = count' }, { op: 'local', fn: (r) => { r.r++; }, label: 'add: r = r + 1' }, { op: 'write', v: 'count', val: (r) => r.r, label: 'store: count = r' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }]
        : [{ op: 'faa', v: 'count', by: 1, into: 'r', label: 'fetch-and-add(count, 1)' }];
    const spec = { threads: Array.from({ length: N }, (_, i) => ({ name: 'T' + i, prog: body })), mutexes: v === 'mutex' ? ['m'] : [], vars: { count: 0 } };
    spec.check = { invariants: [{ name: 'at the end count = ' + N, holds: (M) => M.status() !== 'done' || M.vars.count === N }], liveness: [], deadlock: true };
    spec.expect = v === 'race' ? 'invariant' : 'ok'; spec.expectLive = 'ok';
    spec.about = { race: 'Two loads can see the same value before either stores: one increment is lost.', mutex: 'The lock makes load, add and store one indivisible piece.', atomic: 'The hardware does load, add and store as one instruction.' }[v];
    return spec;
  };

  Y.peterson = function (variant) {
    const v = variant || 'correct', threads = [];
    for (let i = 0; i < 2; i++) {
      const j = 1 - i, prog = [];
      const raise = { op: 'write', v: 'flag', idx: i, val: 1, label: 'flag[' + i + '] = 1' };
      if (v === 'turn-only') prog.push({ label: 'spin' }, { op: 'read', v: 'turn', into: 't', label: 't = turn' }, { op: 'jump', to: 'spin', if: (r) => r.t !== i, label: 'while (turn != ' + i + ')' }, ...CS, { op: 'write', v: 'turn', val: j, label: 'turn = ' + j });
      else if (v === 'flags-only') prog.push(raise, { label: 'spin' }, { op: 'read', v: 'flag', idx: j, into: 'f', label: 'f = flag[' + j + ']' }, { op: 'jump', to: 'spin', if: (r) => r.f, label: 'while (flag[' + j + '])' }, ...CS, { op: 'write', v: 'flag', idx: i, val: 0, label: 'flag[' + i + '] = 0' });
      else if (v === 'check-then-set') prog.push({ label: 'spin' }, { op: 'read', v: 'flag', idx: j, into: 'f', label: 'f = flag[' + j + ']' }, { op: 'jump', to: 'spin', if: (r) => r.f, label: 'while (flag[' + j + '])' }, raise, ...CS, { op: 'write', v: 'flag', idx: i, val: 0, label: 'flag[' + i + '] = 0' });
      else {
        prog.push(raise, { op: 'write', v: 'turn', val: j, label: 'turn = ' + j });
        if (v === 'tso-fence') prog.push({ op: 'fence', label: 'fence' });
        prog.push({ label: 'spin' }, { op: 'read', v: 'flag', idx: j, into: 'f', label: 'f = flag[' + j + ']' }, { op: 'read', v: 'turn', into: 't', label: 't = turn' }, { op: 'jump', to: 'spin', if: (r) => r.f && r.t === j, label: 'while (flag[' + j + '] && turn == ' + j + ')' }, ...CS, { op: 'write', v: 'flag', idx: i, val: 0, label: 'flag[' + i + '] = 0' });
      }
      threads.push({ name: 'T' + i, loop: true, iters: v === 'turn-only' && i === 1 ? 1 : 0, prog });
    }
    const spec = { threads, vars: { flag: [0, 0], turn: 0 }, tso: v === 'tso' || v === 'tso-fence' };
    spec.check = { invariants: [H().mutex()], liveness: v === 'turn-only' ? [{ name: 'T0 eventually enters', thread: 0 }] : H().each(spec, 'enters'), deadlock: true };
    spec.expect = v === 'check-then-set' || v === 'tso' ? 'invariant' : 'ok';
    spec.expectLive = v === 'flags-only' || v === 'turn-only' ? 'starve' : 'ok';
    spec.about = {
      correct: 'Raise your flag, give the other the turn, and wait only while the other wants in and has the turn.',
      'flags-only': 'Both raise their flags and then each waits for the other: they spin for ever (no progress).',
      'turn-only': 'Strict turns: once T1 stops wanting in, T0 waits for a turn that never comes.',
      'check-then-set': 'Both can look, see the other\'s flag down, and then both go in.',
      tso: 'Each store waits in a store buffer, so each thread reads the other\'s flag as 0 and both go in.',
      'tso-fence': 'A fence pushes the stores to memory before the loads: Peterson works again.',
    }[v];
    return spec;
  };

  Y.spinlock = function (kind, n) {
    const k = kind || 'tas', N = n || 2, threads = [];
    let vars, prog;
    if (k === 'tas' || k === 'cas') {
      vars = { lock: 0 };
      const take = k === 'tas' ? [{ op: 'tas', v: 'lock', into: 'o', label: 'o = test_and_set(lock)' }, { op: 'jump', to: 'top', if: (r) => r.o === 1, label: 'while (o == 1)' }]
        : [{ op: 'cas', v: 'lock', expect: 0, val: 1, into: 'ok', label: 'ok = cas(lock, 0, 1)' }, { op: 'jump', to: 'top', if: (r) => !r.ok, label: 'while (!ok)' }];
      prog = [{ label: 'top' }, ...take, ...CS, { op: 'write', v: 'lock', val: 0, label: 'lock = 0' }];
    } else if (k === 'ticket') {
      const K = N + 1;
      vars = { next: 0, serving: 0 };
      prog = [{ op: 'faa', v: 'next', by: 1, mod: K, into: 'my', label: 'my = fetch_and_add(next)' }, { label: 'spin' }, { op: 'read', v: 'serving', into: 's', label: 's = serving' }, { op: 'jump', to: 'spin', if: (r) => r.s !== r.my, label: 'while (s != my)' }, ...CS, { op: 'faa', v: 'serving', by: 1, mod: K, into: 'x', label: 'serving++' }, { op: 'local', fn: (r) => { r.s = null; r.x = null; r.my = null; }, label: 'forgets its ticket' }];
    } else {
      vars = { tail: -1, locked: Array(N).fill(0), next: Array(N).fill(-1) };
      const me = (r, th) => th.id;
      prog = [
        { op: 'write', v: 'next', idx: me, val: -1, label: 'my.next = none' }, { op: 'write', v: 'locked', idx: me, val: 1, label: 'my.locked = 1' },
        { op: 'xchg', v: 'tail', val: (r, th) => th.id, into: 'pred', label: 'pred = swap(tail, me)' }, { op: 'jump', to: 'own', if: (r) => r.pred === -1, label: 'if (pred == none) it is mine' },
        { op: 'write', v: 'next', idx: (r) => r.pred, val: (r, th) => th.id, label: 'pred.next = me' },
        { label: 'spin' }, { op: 'read', v: 'locked', idx: me, into: 'l', label: 'l = my.locked' }, { op: 'jump', to: 'spin', if: (r) => r.l === 1, label: 'while (l) spin on my own flag' },
        { label: 'own' }, ...CS,
        { op: 'read', v: 'next', idx: me, into: 's', label: 's = my.next' }, { op: 'jump', to: 'pass', if: (r) => r.s !== -1, label: 'if someone is behind me' },
        { op: 'cas', v: 'tail', expect: (r, th) => th.id, val: -1, into: 'ok', label: 'ok = cas(tail, me, none)' }, { op: 'jump', to: 'done', if: (r) => r.ok, label: 'if (ok) nobody waits' },
        { label: 'wait' }, { op: 'read', v: 'next', idx: me, into: 's', label: 's = my.next' }, { op: 'jump', to: 'wait', if: (r) => r.s === -1, label: 'wait for the newcomer to link in' },
        { label: 'pass' }, { op: 'write', v: 'locked', idx: (r) => r.s, val: 0, label: 's.locked = 0: hand over' },
        { label: 'done' }, { op: 'local', fn: (r) => { r.pred = null; r.l = null; r.s = null; r.ok = null; }, label: 'forgets its pointers' },
      ];
    }
    for (let i = 0; i < N; i++) threads.push({ name: 'T' + i, loop: true, prog });
    const spec = { threads, vars };
    if (k !== 'mcs') spec.symmetry = [threads.map((_, i) => i)];
    spec.check = { invariants: [H().mutex()], liveness: H().each(spec, 'enters'), deadlock: true };
    spec.expect = 'ok'; spec.expectLive = k === 'tas' || k === 'cas' ? 'starve' : 'ok';
    spec.about = { tas: 'Test-and-set takes the lock in one indivisible step; but a waiter can lose the race every time.', cas: 'Compare-and-swap from 0 to 1 takes the lock; again nothing orders the waiters.', ticket: 'Take a ticket with fetch-and-add and wait until it is served: first come, first served.', mcs: 'Waiters form a queue; each spins on its own flag, and the holder hands the lock to the next in line.' }[k];
    return spec;
  };

  Y.bug = function (kind, fixed) {
    let spec;
    if (kind === 'atomicity') {
      const lk = fixed ? [{ op: 'lock', m: 'm', label: 'lock(m)' }] : [], ul = fixed ? [{ op: 'unlock', m: 'm', label: 'unlock(m)' }] : [];
      spec = { threads: [
        { name: 'T0', prog: [...lk, { op: 'read', v: 'p', into: 'x', label: 'if (p != NULL)' }, { op: 'jump', to: 'skip', if: (r) => r.x === null, label: 'skip when NULL' }, { op: 'read', v: 'p', into: 'y', label: 'use p' }, { op: 'assert', label: 'p is still there when used', reads: [], fn: (V, th) => th.reg.y !== null }, { label: 'skip' }, ...ul] },
        { name: 'T1', prog: [...lk, { op: 'write', v: 'p', val: null, label: 'p = NULL' }, ...ul] },
      ], mutexes: fixed ? ['m'] : [], vars: { p: 'obj' } };
      spec.about = fixed ? 'The check and the use run under one lock, so p cannot vanish between them.' : 'T1 can clear p after T0 checked it and before T0 uses it: the check and the use were meant to be atomic.';
    } else if (kind === 'order') {
      spec = { threads: [
        { name: 'T0', prog: [{ op: 'write', v: 'init', val: 1, label: 'set up the object' }].concat(fixed ? [{ op: 'post', s: 'ready', label: 'post(ready)' }] : []) },
        { name: 'T1', prog: (fixed ? [{ op: 'wait', s: 'ready', label: 'wait(ready)' }] : []).concat([{ op: 'read', v: 'init', into: 'i', label: 'use the object' }, { op: 'assert', label: 'the object was set up first', reads: [], fn: (V, th) => th.reg.i === 1 }]) },
      ], sems: fixed ? [{ id: 'ready', name: 'ready', init: 0 }] : [], vars: { init: 0 } };
      spec.about = fixed ? 'T1 waits for a semaphore T0 posts after the set-up: the order is enforced.' : 'Nothing makes T0\'s set-up happen before T1\'s use: an order violation.';
    } else {
      const waiter = fixed
        ? [{ op: 'lock', m: 'm', label: 'lock(m)' }, { label: 'chk' }, { op: 'read', v: 'flag', into: 'f', label: 'f = flag' }, { op: 'jump', to: 'go', if: (r) => r.f, label: 'while (!flag)' }, { op: 'cwait', c: 'c', m: 'm', label: 'wait(c, m)' }, { op: 'jump', to: 'chk', label: 'test again' }, { label: 'go' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }]
        : [{ op: 'read', v: 'flag', into: 'f', label: 'if (!flag)' }, { op: 'jump', to: 'go', if: (r) => r.f, label: 'skip when set' }, { op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'cwait', c: 'c', m: 'm', label: 'wait(c, m)' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }, { label: 'go' }];
      spec = { threads: [{ name: 'W', prog: waiter }, { name: 'S', prog: [{ op: 'lock', m: 'm', label: 'lock(m)' }, { op: 'write', v: 'flag', val: 1, label: 'flag = 1' }, { op: 'signal', c: 'c', label: 'signal(c)' }, { op: 'unlock', m: 'm', label: 'unlock(m)' }] }], mutexes: ['m'], conds: ['c'], vars: { flag: 0 } };
      spec.about = fixed ? 'The flag is tested under the lock, in a loop: the signal cannot fall between the test and the wait.' : 'W tests the flag, then S sets it and signals before W waits: the wake-up is lost and W sleeps for ever.';
    }
    spec.check = { invariants: [], liveness: [], deadlock: true };
    spec.expect = fixed ? 'ok' : kind === 'lost-wakeup' ? 'deadlock' : 'assert'; spec.expectLive = 'ok';
    return spec;
  };
})(globalThis.Proses = globalThis.Proses || {});
