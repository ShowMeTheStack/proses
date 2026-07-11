// The classic problems as machine specs, correct and broken, each with its specification: spec.check =
// {invariants: [{name, holds(M)}], liveness: [{name, thread, progress?, trying?}], deadlock: bool} for the model
// checker (mc-*.js); spec.expect, what the safety search finds ('ok', 'deadlock', 'invariant' or 'assert');
// spec.expectLive, what the liveness check finds ('ok', or 'starve' when some thread can wait for ever under weak
// fairness); and spec.about, one sentence on the variant.
//   S.Sync.philosophers(n, variant)  'naive' | 'ordered' (the last philosopher takes the right fork first) |
//     'seats' (a semaphore seats at most n − 1) | 'arbiter' (a waiter mutex around taking both forks).
//     Philosopher i's left fork is fork i, its right fork i + 1 mod n.
//   S.Sync.buffer(size, producers, consumers, {variant: 'sem' | 'no-mutex' | 'swapped', check})  the bounded
//     buffer with the semaphores empty, full and mutex; check adds assertions (never take from an empty slot,
//     never overwrite a full one), one plain item name 'x' (so the state space stays finite) and the symmetry of
//     the producers and of the consumers (spec.symmetry, for the model checker)
//   S.Sync.cvBuffer(size, producers, consumers, {variant: 'while' | 'if' | 'one-cv', hoare})  with a mutex and
//     condition variables
//   S.Sync.readersWriters(variant, readers, writers)  'reader' | 'writer' | 'fair' with semaphores (room: held for
//     the readers as a group or for one writer; count_lock guards the reader count rc; for writers first, a door that
//     the first waiting writer shuts on new readers, with wcount_lock guarding the writer count wc; for fair, one line
//     everybody passes in arrival order) or 'lock-reader' | 'lock-writer' | 'lock-fair' (the rwlock primitive)
//   S.Sync.barber(customers, chairs, {variant: 'correct' | 'no-mutex'})  free_seats counts the empty waiting seats
//     down; arrivals wakes the barber, call_next lets one customer in, seat_lock guards free_seats
//   S.Sync.monitor(m, body) -> ops   a monitor procedure: enter (lock m), the body (a cwait with no mutex named
//     waits on m), leave (unlock m); with spec.hoare the monitor has Hoare semantics, else Mesa
//   S.Sync.helpers: mutual exclusion and "each eventually" builders shared by the problem files
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});
  const H = (Y.helpers = {});
  H.mutex = () => ({ name: 'mutual exclusion: at most one thread in its critical section', holds: (M) => M.threads.reduce((s, th) => s + th.cs, 0) <= 1 });
  H.each = (spec, what, ids) => (ids || spec.threads.map((_, i) => i)).map((i) => ({ name: spec.threads[i].name + ' eventually ' + what, thread: i }));
  H.atMost = (name, v, k) => ({ name, holds: (M) => M.vars[v] <= k });

  Y.monitor = (m, body) => [{ op: 'lock', m, label: 'enter the monitor' }, ...body.map((o) => (o.op === 'cwait' && !o.m ? Object.assign({}, o, { m }) : o)), { op: 'unlock', m, label: 'leave the monitor' }];

  Y.philosophers = function (n, variant) {
    const v = variant || 'naive', threads = [];
    for (let i = 0; i < n; i++) {
      const L = i, R = (i + 1) % n;
      const first = v === 'ordered' && i === n - 1 ? R : L, second = first === L ? R : L;
      const side = (f) => (f === L ? 'left' : 'right');
      const prog = [{ op: 'think', label: 'thinks' }];
      if (v === 'seats') prog.push({ op: 'wait', s: 'seats', label: 'takes a seat' });
      if (v === 'arbiter') prog.push({ op: 'lock', m: 'waiter', label: 'asks the waiter' });
      prog.push({ op: 'lock', m: 'f' + first, label: 'picks up the ' + side(first) + ' fork', fork: first });
      prog.push({ op: 'lock', m: 'f' + second, label: 'picks up the ' + side(second) + ' fork', fork: second });
      if (v === 'arbiter') prog.push({ op: 'unlock', m: 'waiter', label: 'lets the waiter go' });
      prog.push({ op: 'eat', label: 'eats', mark: 'progress' });
      prog.push({ op: 'unlock', m: 'f' + second, label: 'puts down the ' + side(second) + ' fork', fork: second });
      prog.push({ op: 'unlock', m: 'f' + first, label: 'puts down the ' + side(first) + ' fork', fork: first });
      if (v === 'seats') prog.push({ op: 'post', s: 'seats', label: 'leaves the seat' });
      threads.push({ name: 'P' + i, prog, loop: true, left: L, right: R });
    }
    const spec = {
      threads,
      mutexes: Array.from({ length: n }, (_, j) => ({ id: 'f' + j, name: 'fork ' + j })).concat(v === 'arbiter' ? [{ id: 'waiter', name: 'the waiter' }] : []),
      sems: v === 'seats' ? [{ id: 'seats', name: 'seats', init: n - 1 }] : [],
    };
    const eating = (M, i) => M.threads[i].prog[M.threads[i].pc] && M.threads[i].prog[M.threads[i].pc].op === 'eat';
    spec.check = {
      invariants: [{ name: 'neighbours never eat at once', holds: (M) => M.threads.every((th, i) => !(eating(M, i) && eating(M, (i + 1) % n))) }],
      liveness: H.each(spec, 'eats'), deadlock: true,
    };
    spec.expect = v === 'naive' ? 'deadlock' : 'ok'; spec.expectLive = 'ok';
    spec.about = { naive: 'Everyone picks up the left fork first: if all do at once, a circle of waits closes.', ordered: 'Forks are taken lowest number first, so no circle of waits can close.', seats: 'At most n − 1 sit, so one of them always gets both forks.', arbiter: 'A waiter lets one philosopher at a time pick up forks, so no one holds one fork while waiting for another held by someone also picking up.' }[v];
    return spec;
  };

  const LETTERS = 'abcdefgh';
  Y.buffer = function (size, producers, consumers, o) {
    o = o || {};
    const v = o.variant || 'sem', ck = !!o.check, threads = [];
    const slotEmpty = { op: 'assert', label: 'the slot at in is empty', reads: ['buf', 'in'], fn: (V) => V.buf[V.in] === null };
    const gotItem = { op: 'assert', label: 'the item taken is real', reads: [], fn: (V, th) => th.reg.item !== null };
    for (let k = 0; k < producers; k++) {
      const ch = LETTERS[k], prog = [];
      const enter = v === 'swapped' ? [{ op: 'wait', s: 'mutex', label: 'wait(mutex)' }, { op: 'wait', s: 'empty', label: 'wait(empty)' }] : [{ op: 'wait', s: 'empty', label: 'wait(empty)' }].concat(v === 'no-mutex' ? [] : [{ op: 'wait', s: 'mutex', label: 'wait(mutex)' }]);
      prog.push(...enter);
      if (ck) prog.push(slotEmpty);
      prog.push({ op: 'write', v: 'buf', idx: 'in', val: ck ? 'x' : (reg, t) => ch + (t.rounds + 1), label: 'buf[in] = item', mark: 'progress' });
      prog.push({ op: 'update', v: 'in', by: 1, mod: size, label: 'in = (in + 1) % N' });
      if (v !== 'no-mutex') prog.push({ op: 'post', s: 'mutex', label: 'post(mutex)' });
      prog.push({ op: 'post', s: 'full', label: 'post(full)' });
      threads.push({ name: 'P' + (k + 1), role: 'producer', loop: true, prog });
    }
    for (let k = 0; k < consumers; k++) {
      const prog = [{ op: 'wait', s: 'full', label: 'wait(full)' }];
      if (v !== 'no-mutex') prog.push({ op: 'wait', s: 'mutex', label: 'wait(mutex)' });
      prog.push({ op: 'read', v: 'buf', idx: 'out', into: 'item', label: 'item = buf[out]' });
      if (ck) prog.push(gotItem);
      prog.push({ op: 'write', v: 'buf', idx: 'out', val: null, label: 'buf[out] = empty' });
      prog.push({ op: 'update', v: 'out', by: 1, mod: size, label: 'out = (out + 1) % N' });
      if (v !== 'no-mutex') prog.push({ op: 'post', s: 'mutex', label: 'post(mutex)' });
      prog.push({ op: 'post', s: 'empty', label: 'post(empty)' });
      prog.push({ op: 'work', label: 'uses its item', use: true, mark: 'progress' });
      if (ck) prog.push({ op: 'local', fn: (reg) => { reg.item = null; }, label: 'forgets the item' });
      threads.push({ name: 'C' + (k + 1), role: 'consumer', loop: true, prog });
    }
    const spec = {
      threads,
      sems: [{ id: 'empty', name: 'empty', init: size }, { id: 'full', name: 'full', init: 0 }, { id: 'mutex', name: 'mutex', init: 1 }],
      vars: { buf: Array(size).fill(null), in: 0, out: 0 },
    };
    if (ck) spec.symmetry = [Array.from({ length: producers }, (_, i) => i), Array.from({ length: consumers }, (_, i) => producers + i)];
    spec.check = { invariants: [], liveness: H.each(spec, 'gets through its loop'), deadlock: true };
    spec.expect = v === 'sem' ? 'ok' : v === 'swapped' ? 'deadlock' : 'assert'; spec.expectLive = 'ok';
    spec.about = { sem: 'empty and full count the free and filled slots; mutex guards buf, in and out.', 'no-mutex': 'Without mutex, two producers can both write at the same in before either moves it: an item is lost.', swapped: 'A producer takes mutex before waiting for a free slot: on a full ring it sleeps holding mutex, and no consumer can get in to free a slot.' }[v];
    return spec;
  };

  Y.cvBuffer = function (size, producers, consumers, o) {
    o = o || {};
    const v = o.variant || 'while', loopBack = v === 'if' ? 'go' : 'chk', threads = [];
    const nf = v === 'one-cv' ? 'cv' : 'notFull', ne = v === 'one-cv' ? 'cv' : 'notEmpty';
    for (let k = 0; k < producers; k++) {
      threads.push({ name: 'P' + (k + 1), loop: true, prog: [
        { op: 'lock', m: 'm', label: 'lock(m)' },
        { label: 'chk' }, { op: 'read', v: 'count', into: 'c', label: 'c = count' },
        { op: 'jump', to: 'go', if: (r) => r.c < size, label: v === 'if' ? 'if (count == N) …' : 'while (count == N) …' },
        { op: 'cwait', c: nf, m: 'm', label: 'wait(' + nf + ', m)' },
        { op: 'jump', to: loopBack, label: v === 'if' ? 'then go on' : 'test again' },
        { label: 'go' }, { op: 'assert', label: 'the slot at in is empty', reads: ['buf', 'in'], fn: (V) => V.buf[V.in] === null },
        { op: 'write', v: 'buf', idx: 'in', val: 'x', label: 'buf[in] = item', mark: 'progress' },
        { op: 'update', v: 'in', by: 1, mod: size, label: 'in = (in + 1) % N' },
        { op: 'update', v: 'count', by: 1, label: 'count++' },
        { op: 'signal', c: ne, label: 'signal(' + ne + ')' },
        { op: 'unlock', m: 'm', label: 'unlock(m)' },
      ] });
    }
    for (let k = 0; k < consumers; k++) {
      threads.push({ name: 'C' + (k + 1), loop: true, prog: [
        { op: 'lock', m: 'm', label: 'lock(m)' },
        { label: 'chk' }, { op: 'read', v: 'count', into: 'c', label: 'c = count' },
        { op: 'jump', to: 'go', if: (r) => r.c > 0, label: v === 'if' ? 'if (count == 0) …' : 'while (count == 0) …' },
        { op: 'cwait', c: ne, m: 'm', label: 'wait(' + ne + ', m)' },
        { op: 'jump', to: loopBack, label: v === 'if' ? 'then go on' : 'test again' },
        { label: 'go' }, { op: 'read', v: 'buf', idx: 'out', into: 'item', label: 'item = buf[out]' },
        { op: 'assert', label: 'the item taken is real', reads: [], fn: (V, th) => th.reg.item !== null },
        { op: 'write', v: 'buf', idx: 'out', val: null, label: 'buf[out] = empty' },
        { op: 'update', v: 'out', by: 1, mod: size, label: 'out = (out + 1) % N' },
        { op: 'update', v: 'count', by: -1, label: 'count--' },
        { op: 'signal', c: nf, label: 'signal(' + nf + ')' },
        { op: 'unlock', m: 'm', label: 'unlock(m)' },
        { op: 'work', label: 'uses its item', mark: 'progress' },
        { op: 'local', fn: (reg) => { reg.item = null; reg.c = null; }, label: 'forgets the item' },
      ] });
    }
    const spec = { threads, mutexes: [{ id: 'm', name: 'm' }], conds: v === 'one-cv' ? [{ id: 'cv', name: 'cv' }] : [{ id: 'notFull', name: 'notFull' }, { id: 'notEmpty', name: 'notEmpty' }], vars: { buf: Array(size).fill(null), in: 0, out: 0, count: 0 }, hoare: !!o.hoare, symmetry: [Array.from({ length: producers }, (_, i) => i), Array.from({ length: consumers }, (_, i) => producers + i)] };
    spec.check = { invariants: [{ name: '0 ≤ count ≤ N', holds: (M) => M.vars.count >= 0 && M.vars.count <= size }], liveness: H.each(spec, 'gets through its loop'), deadlock: true };
    spec.expect = v === 'while' ? 'ok' : v === 'if' ? (o.hoare ? 'ok' : 'assert') : 'deadlock';
    // Mesa lets a woken consumer be overtaken again and again; Hoare hands the monitor over at once
    spec.expectLive = o.hoare || consumers < 2 ? 'ok' : 'starve';
    spec.about = { while: 'Each waiter tests its condition again after waking: with Mesa semantics another thread may have run first.', if: o.hoare ? 'With Hoare semantics the woken thread runs at once, so testing once is enough.' : 'With if, a consumer woken by a signal goes on even when another consumer emptied the ring first.', 'one-cv': 'One condition for both kinds: a signal can wake a thread of the wrong kind, and soon everyone sleeps.' }[v];
    return spec;
  };

  /** the read and write sections, counted so the invariant can see them */
  const READ = [{ op: 'update', v: 'R', by: 1, label: 'starts reading', mark: 'progress' }, { op: 'work', label: 'reads' }, { op: 'update', v: 'R', by: -1, label: 'stops reading' }];
  const WRITE = [{ op: 'update', v: 'W', by: 1, label: 'starts writing', mark: 'progress' }, { op: 'work', label: 'writes' }, { op: 'update', v: 'W', by: -1, label: 'stops writing' }];
  const incr = (v, sem, test, label) => [{ op: 'update', v, by: 1, label: v + '++' }, { op: 'read', v, into: 'k', label: 'k = ' + v }, { op: 'jump', to: label, if: (r) => r.k !== test, label: 'if not the first' }, { op: 'wait', s: sem, label: 'wait(' + sem + ')' }, { label }];
  const decr = (v, sem, label) => [{ op: 'update', v, by: -1, label: v + '--' }, { op: 'read', v, into: 'k', label: 'k = ' + v }, { op: 'jump', to: label, if: (r) => r.k !== 0, label: 'if not the last' }, { op: 'post', s: sem, label: 'post(' + sem + ')' }, { label }];
  const W = (s) => ({ op: 'wait', s, label: 'wait(' + s + ')' }), P = (s) => ({ op: 'post', s, label: 'post(' + s + ')' });

  Y.readersWriters = function (variant, readers, writers) {
    const v = variant || 'reader', nR = readers || 2, nW = writers || 1, threads = [];
    let reader, writer, sems = [], rwlocks = [];
    if (v === 'reader') {
      sems = [{ id: 'count_lock', init: 1 }, { id: 'room', init: 1 }];
      reader = [W('count_lock'), ...incr('rc', 'room', 1, 'r1'), P('count_lock'), ...READ, W('count_lock'), ...decr('rc', 'room', 'r2'), P('count_lock')];
      writer = [W('room'), ...WRITE, P('room')];
    } else if (v === 'writer') {
      sems = [{ id: 'count_lock', init: 1 }, { id: 'wcount_lock', init: 1 }, { id: 'door', init: 1 }, { id: 'room', init: 1 }];
      reader = [W('door'), W('count_lock'), ...incr('rc', 'room', 1, 'r1'), P('count_lock'), P('door'), ...READ, W('count_lock'), ...decr('rc', 'room', 'r2'), P('count_lock')];
      writer = [W('wcount_lock'), ...incr('wc', 'door', 1, 'w1'), P('wcount_lock'), W('room'), ...WRITE, P('room'), W('wcount_lock'), ...decr('wc', 'door', 'w2'), P('wcount_lock')];
    } else if (v === 'fair') {
      sems = [{ id: 'line', init: 1 }, { id: 'count_lock', init: 1 }, { id: 'room', init: 1 }];
      reader = [W('line'), W('count_lock'), ...incr('rc', 'room', 1, 'r1'), P('line'), P('count_lock'), ...READ, W('count_lock'), ...decr('rc', 'room', 'r2'), P('count_lock')];
      writer = [W('line'), W('room'), P('line'), ...WRITE, P('room')];
    } else {
      rwlocks = [{ id: 'L', name: 'the lock', policy: v.slice(5) }];
      reader = [{ op: 'rlock', l: 'L', label: 'rlock(L)' }, ...READ, { op: 'runlock', l: 'L', label: 'runlock(L)' }];
      writer = [{ op: 'wlock', l: 'L', label: 'wlock(L)' }, ...WRITE, { op: 'wunlock', l: 'L', label: 'wunlock(L)' }];
    }
    for (let i = 0; i < nR; i++) threads.push({ name: 'R' + (i + 1), role: 'reader', loop: true, prog: reader });
    for (let i = 0; i < nW; i++) threads.push({ name: 'W' + (i + 1), role: 'writer', loop: true, prog: writer });
    const spec = { threads, sems: sems.map((s) => Object.assign({ name: s.id }, s)), rwlocks, vars: { rc: 0, wc: 0, R: 0, W: 0 }, symmetry: [Array.from({ length: nR }, (_, i) => i), Array.from({ length: nW }, (_, i) => nR + i)] };
    spec.check = {
      invariants: [{ name: 'no reader while a writer writes, and one writer at most', holds: (M) => M.vars.W <= 1 && (M.vars.W === 0 || M.vars.R === 0) }],
      liveness: H.each(spec, 'gets in'), deadlock: true,
    };
    const pol = v.replace('lock-', '');
    spec.expect = 'ok'; spec.expectLive = pol === 'fair' ? 'ok' : 'starve';
    spec.starves = pol === 'reader' ? 'writer' : pol === 'writer' ? 'reader' : null;
    spec.about = { reader: 'Readers share the room while any reader is in, so a stream of readers can keep a writer out for ever.', writer: 'A waiting writer shuts the door on new readers, so a stream of writers can keep readers out for ever.', fair: 'Everyone passes one line in arrival order: nobody waits for ever.' }[pol];
    return spec;
  };

  Y.barber = function (customers, chairs, o) {
    const v = (o && o.variant) || 'correct', nC = customers || 2, ch = chairs || 1, threads = [];
    // free_seats counts the empty waiting seats down; arrivals tells the barber someone sits; call_next lets one in
    threads.push({ name: 'B', role: 'barber', loop: true, prog: [W('arrivals'), W('seat_lock'), { op: 'update', v: 'free_seats', by: 1, label: 'free_seats++' }, P('call_next'), P('seat_lock'), { op: 'work', label: 'cuts hair', mark: 'progress' }] });
    const look = [{ op: 'read', v: 'free_seats', into: 'f', label: 'f = free_seats' }, { op: 'jump', to: 'full', if: (r) => r.f <= 0, label: 'if no seat is free' }, { op: 'update', v: 'free_seats', by: -1, label: 'free_seats--' }];
    const after = [P('arrivals')], served = [W('call_next'), { op: 'work', label: 'gets a haircut', mark: 'progress' }, { op: 'jump', to: 'end', label: 'goes home' }];
    for (let i = 0; i < nC; i++) {
      const prog = v === 'correct'
        ? [W('seat_lock'), ...look, ...after, P('seat_lock'), ...served, { label: 'full' }, P('seat_lock'), { op: 'work', label: 'leaves: no free seat' }, { label: 'end' }]
        : [...look, ...after, ...served, { label: 'full' }, { op: 'work', label: 'leaves: no free seat' }, { label: 'end' }];
      threads.push({ name: 'C' + (i + 1), role: 'customer', loop: true, prog });
    }
    const spec = { threads, sems: [{ id: 'arrivals', name: 'arrivals', init: 0 }, { id: 'call_next', name: 'call_next', init: 0 }, { id: 'seat_lock', name: 'seat_lock', init: 1 }], vars: { free_seats: ch }, symmetry: [Array.from({ length: nC }, (_, i) => i + 1)] };
    // a seated customer (past free_seats--, before the haircut) gets a haircut in the end
    const seated = (i) => (M) => { const th = M.threads[i]; return th.pc > th.prog.findIndex((x) => x.label === 'free_seats--') && th.pc <= th.prog.findIndex((x) => x.label === 'gets a haircut'); };
    spec.check = { invariants: [{ name: 'never more customers seated than seats (free_seats ≥ 0)', holds: (M) => M.vars.free_seats >= 0 }], liveness: threads.slice(1).map((t, k) => ({ name: t.name + ', once seated, gets a haircut', thread: k + 1, trying: seated(k + 1) })), deadlock: true };
    // without seat_lock more customers can sit than there are seats, but only if there are more customers
    spec.expect = v === 'correct' || nC <= ch ? 'ok' : 'invariant'; spec.expectLive = 'ok';
    spec.about = v === 'correct' ? 'A customer looks for a free seat and takes it in one step, under seat_lock.' : 'Without seat_lock two customers can both see the last free seat and both take it: free_seats goes below 0.';
    return spec;
  };
})(globalThis.Proses = globalThis.Proses || {});
