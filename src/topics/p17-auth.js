// Part 17, authentication as concepts (prot-c-auth.js): passwords stored salted and hashed (with a toy hash, said so
// on the stage), checked by recomputing; limits on how fast anyone may try; and a second factor. Nothing here guesses
// or recovers a password.
(function (S) {
  'use strict';
  const H = S.P09, Pr = () => S.Prot;
  // made-up accounts with made-up passwords, for following the steps
  const USERS = [{ name: 'ana', password: 'tulip42' }, { name: 'ben', password: 'harbour' }, { name: 'eve', password: 'tulip42' }, { name: 'raj', password: 'Gr8-hill' }];

  S.topic({
    id: 'prot-passwords', family: 'p17-auth', order: 10, title: 'Passwords, salted and hashed',
    blurb: 'A system must never keep passwords themselves: whoever reads the file would have them all. It keeps a hash, a one-way function of the password, and checks a login by hashing what was typed and comparing. Each account also gets its own random salt, mixed in before hashing, so two people with the same password get different hashes, and no table of hashes made in advance fits. Real systems use a deliberately slow hash; the toy hash here is fast and short so every step can be followed.',
    inputs: [
      { id: 'salted', kind: 'choice', label: 'Salt', def: 'yes', options: [{ value: 'yes', label: 'a random salt per account' }, { value: 'no', label: 'no salt' }] },
      { id: 'rounds', kind: 'number', label: 'Rounds of hashing', def: 3, min: 1, max: 5 },
      { id: 'who', kind: 'choice', label: 'Login as', def: 'ana', options: USERS.map((u) => ({ value: u.name, label: u.name })) },
      { id: 'attempt', kind: 'string', label: 'Password typed', def: 'tulip42', max: 16, spaces: false },
      { id: 'seed', kind: 'number', label: 'Salt seed', def: 7, min: 1, max: 999 },
    ],
    presets: [
      { label: 'Salted: ana logs in', values: { salted: 'yes', rounds: 3, who: 'ana', attempt: 'tulip42' } },
      { label: 'Salted: a wrong password', values: { salted: 'yes', rounds: 3, who: 'ben', attempt: 'harbor' } },
      { label: 'No salt: equal passwords show', values: { salted: 'no', rounds: 3, who: 'eve', attempt: 'tulip42' } },
      { label: 'One round only', values: { salted: 'yes', rounds: 1, who: 'raj', attempt: 'Gr8-hill' } },
    ],
    counters: [{ id: 'hashes', label: 'hashes computed' }],
    run(inp) {
      const st = Pr().store(USERS, { salted: inp.salted === 'yes', rounds: inp.rounds, seed: inp.seed }), F = new S.Frames(['hashes']);
      const rec = st.records.find((r) => r.name === inp.who), v = Pr().verify(rec, inp.attempt);
      const shared = new Set(st.shared.flat());
      const table = (upto, cur, o) => {
        o = o || {};
        const rows = st.records.slice(0, upto).map((r) => ({ cls: r.name === cur ? 'act' : '', cells: [r.name, r.salt || '(none)', { text: r.hash, cls: o.shared && shared.has(r.name) ? 'hot' : '' }] }));
        return [H.title('ft', 0, 6, 'the password file'), ...S.Kit.gantt.table({ prefix: 'pf', x: 0, y: 20, rowH: 30, size: 14, cols: [{ w: 90, label: 'account' }, { w: 120, label: 'salt' }, { w: 150, label: 'stored hash' }], rows }).items];
      };
      const chainItems = (title, salt, pw, steps, hiLast) => {
        const items = [H.title('ct', 420, 6, title)];
        items.push({ key: 'cin', kind: 'cell', x: 420, y: 20, w: 330, h: 30, rx: 5, text: (salt ? 'salt ' + salt + ' + ' : '') + 'password ' + pw, size: 14, cls: 'rec' });
        steps.forEach((s2, k) => {
          items.push(H.text('car' + k, 440, 74 + k * 44, '↓ round ' + (k + 1), '', 13));
          items.push({ key: 'cr' + k, kind: 'cell', x: 540, y: 58 + k * 44, w: 110, h: 30, rx: 5, text: s2.value, size: 14, cls: 'rec' + (hiLast && k === steps.length - 1 ? ' act' : '') });
        });
        return items;
      };
      const note = (y) => H.para('toy', 0, y, Pr().TOY_NOTE, 760, '', 13);
      const ny = 20 + 30 * 5 + 150;
      F.add({ items: [...table(0), ...note(ny)], say: `${USERS.length} accounts are created. For each, the system ${inp.salted === 'yes' ? 'draws a fresh random salt, then ' : ''}hashes the password ${H.plural(inp.rounds, 'time')} and keeps only the ${inp.salted === 'yes' ? 'salt and the ' : ''}hash.`, meta: { phase: 'start', rounds: inp.rounds, n: USERS.length } });
      st.records.forEach((r, k) => {
        const hp = Pr().hashPassword(USERS[k].password, r.salt, r.rounds);
        F.count('hashes', r.rounds);
        F.add({ items: [...table(k + 1, r.name), ...chainItems('storing ' + r.name, r.salt, '(not kept)', hp.steps, true), ...note(ny)], say: H.plain(st.steps[k].say), meta: { phase: 'store', k, rounds: r.rounds, hash: r.hash, salt: r.salt }, title: 'store ' + r.name });
      });
      const res = st.steps[st.steps.length - 1];
      F.add({ items: [...table(st.records.length, null, { shared: true }), ...note(ny)], say: H.plain(res.say), meta: { phase: 'file', shared: st.shared.length }, title: 'the file' });
      // the login: recompute with the stored salt, compare all eight digits
      const hv = Pr().hashPassword(inp.attempt, rec.salt, rec.rounds);
      F.count('hashes', rec.rounds);
      F.add({ items: [...table(st.records.length, rec.name), ...chainItems('login: ' + rec.name + ' types a password', rec.salt, '"' + inp.attempt + '"', hv.steps, true), ...note(ny)], say: H.plain(v.steps[0].say) + ` The typed password is hashed the same way: ${H.plural(rec.rounds, 'round')} with that salt.`, meta: { phase: 'login', rounds: rec.rounds, hash: rec.hash }, title: 'login ' + rec.name });
      const cy = Math.max(260, 58 + rec.rounds * 44 + 16);
      const cmp = [...hv.hash].map((c, k) => ({ key: 'cd' + k, kind: 'cell', x: 420 + k * 34, y: cy, w: 30, h: 30, rx: 4, text: c, size: 15, cls: 'mbit cls ' + (c === rec.hash[k] ? 'good' : 'hot') }));
      const sto = [...rec.hash].map((c, k) => ({ key: 'sd' + k, kind: 'cell', x: 420 + k * 34, y: cy + 36, w: 30, h: 30, rx: 4, text: c, size: 15, cls: 'mbit' }));
      F.add({ items: [...table(st.records.length, rec.name), ...chainItems('login: ' + rec.name + ' types a password', rec.salt, '"' + inp.attempt + '"', hv.steps, true), H.text('cl1', 700, cy + 20, 'computed', '', 13), H.text('cl2', 700, cy + 56, 'stored', '', 13), ...cmp, ...sto, H.text('vd', 420, cy + 100, v.ok ? 'the password is right' : 'the password is wrong', 'verdict2 ' + (v.ok ? 'good' : 'hot'), 16), ...note(Math.max(ny + 60, cy + 130))], say: H.plain(v.steps[v.steps.length - 1].say), meta: { phase: 'compare', ok: v.ok, hash: hv.hash, digits: 8 }, title: v.ok ? 'match' : 'no match', hold: 3000 });
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Storing and checking', text: ['store: salt (random, per account), hash(salt + password)', 'check: read the salt, hash what was typed, compare', 'never store or log the password itself', 'salt: equal passwords give different hashes', 'slow hash: every guess costs the guesser time'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'login', pick: 'option', ask: 'Will the computed hash equal the stored one?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].meta.ok ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Why store a hash rather than the password?', options: ['whoever reads the file still does not learn the passwords', 'hashes are shorter to type', 'to make logins faster', 'the hash can be turned back into the password'], answer: 0, why: 'The hash is one-way; checking only needs to recompute it.' },
      { q: 'What does a per-account salt prevent?', options: ['equal passwords showing as equal hashes, and tables of hashes made in advance', 'all guessing', 'typing mistakes', 'the need for a hash'], answer: 0, why: 'Each salt makes each account\'s hash different.' },
      { q: 'Why should a password hash be deliberately slow?', options: ['each guess then costs the guesser time, while one login costs little', 'to save energy', 'to make the output shorter', 'it should be as fast as possible'], answer: 0, why: 'A legitimate login hashes once; a guesser must hash for every guess.' },
      { q: 'Where is the salt kept?', options: ['in the clear, next to the hash', 'secret, in another building', 'nowhere: it is thrown away', 'inside the password'], answer: 0, why: 'It is needed to check a login, and it need not be secret to do its job.' },
    ],
  });

  // ---------------------------------------------------------------------------------------------------------------
  const PATTERNS = {
    forgetful: { label: 'A user who forgets, then remembers', attempts: [[0, false], [5, false], [9, false], [14, true]] },
    fast: { label: 'Many wrong tries in quick succession', attempts: [[0, false], [1, false], [2, false], [3, false], [4, false], [6, false], [9, false], [15, false], [25, false], [40, false]] },
    patient: { label: 'Wrong tries spaced out, then a lock', attempts: [[0, false], [2, false], [4, false], [6, false], [10, false], [20, false], [40, false], [80, false], [200, false]] },
  };
  const MFA = {
    right: { label: 'Right password, right code', password: 'tulip42', code: 'now' },
    drift: { label: 'The device\'s clock one step behind', password: 'tulip42', code: 'prev' },
    wrongcode: { label: 'Right password, wrong code', password: 'tulip42', code: 'wrong' },
    replay: { label: 'A code used a second time', password: 'tulip42', code: 'replay' },
    wrongpw: { label: 'Wrong password', password: 'tulip24', code: 'now' },
  };
  S.topic({
    id: 'prot-login', family: 'p17-auth', order: 20, title: 'Limiting guesses, and a second factor',
    blurb: 'Online, every guess must go through the login, so the login can make guessing slow: a few free tries, then a wait that doubles after each failure, then a lock until someone resets the account. That caps the guesses anyone can make, however fast their machine. A second factor adds something the user has to something the user knows: a short code from a device, valid for one time step and once only. A stolen password alone is then not enough.',
    inputs: [
      { id: 'pattern', kind: 'choice', label: 'Attempts', def: 'fast', options: Object.entries(PATTERNS).map(([value, p]) => ({ value, label: p.label })) },
      { id: 'free', kind: 'number', label: 'Free tries', def: 3, min: 0, max: 6 },
      { id: 'lock', kind: 'number', label: 'Lock after', def: 8, min: 2, max: 12 },
      { id: 'mfa', kind: 'choice', label: 'Second factor', def: 'right', options: Object.entries(MFA).map(([value, p]) => ({ value, label: p.label })) },
    ],
    presets: [
      { label: 'Fast wrong tries; then a good login', values: { pattern: 'fast', free: 3, lock: 8, mfa: 'right' } },
      { label: 'A forgetful user; clock drift', values: { pattern: 'forgetful', free: 3, lock: 8, mfa: 'drift' } },
      { label: 'Spaced tries; a replayed code', values: { pattern: 'patient', free: 3, lock: 8, mfa: 'replay' } },
      { label: 'No free tries; a wrong code', values: { pattern: 'fast', free: 0, lock: 5, mfa: 'wrongcode' } },
      { label: 'A wrong password stops the login', values: { pattern: 'forgetful', free: 3, lock: 8, mfa: 'wrongpw' } },
    ],
    check: (inp) => (inp.lock <= inp.free ? 'Lock after: more than the free tries' : null),
    counters: [{ id: 'refused', label: 'refused unchecked' }, { id: 'fails', label: 'wrong passwords' }],
    run(inp) {
      const pat = PATTERNS[inp.pattern], R = Pr().rateLimit({ attempts: pat.attempts.map(([t, ok]) => ({ t, ok })), free: inp.free, delay: 1, lockAfter: inp.lock });
      const B = Pr().guessBudget({ free: inp.free, delay: 1, lockAfter: inp.lock, seconds: 86400 });
      const F = new S.Frames(['refused', 'fails']);
      const T1 = Math.max(...pat.attempts.map((a) => a[0])), W = 700, X = (t) => Math.round(20 + (Math.log2(1 + t) / Math.log2(1 + T1)) * (W - 40));
      const axis = () => {
        const items = [H.title('at', 0, 6, 'login attempts against time (seconds, log scale)'), { key: 'ax', kind: 'line', x1: 20, y1: 120, x2: W - 20, y2: 120, cls: 'rule' }];
        for (const t of [0, 1, 2, 5, 10, 20, 40, 100, 200].filter((t) => t <= T1)) items.push({ key: 'tk' + t, kind: 'line', x1: X(t), y1: 116, x2: X(t), y2: 124 }, H.text('tt' + t, X(t), 142, String(t), 'tick', 13, 'middle'));
        return items;
      };
      const OUT = { ok: ['ok', 'good'], fail: ['wrong', 'hot'], 'too-soon': ['wait', 'wait'], locked: ['locked', 'done'] };
      const marks = (upto) => R.results.slice(0, upto).map((r, k) => ({ key: 'mk' + k, kind: 'cell', x: X(r.t) - 22, y: 70 - (k % 2) * 34, w: 44, h: 26, rx: 10, text: OUT[r.outcome][0], size: 12, cls: 'tag ' + OUT[r.outcome][1] }));
      const LEG = { ok: 'right password', fail: 'wrong password', 'too-soon': 'too soon: refused unchecked', locked: 'locked' };
      const legend = () => Object.entries(OUT).map(([o, [t, c]], k) => [{ key: 'lb' + k, kind: 'cell', x: (k % 2) * 300, y: 166 + Math.floor(k / 2) * 24, w: 26, h: 18, rx: 7, text: '', cls: 'tag ' + c }, H.text('lt' + k, (k % 2) * 300 + 34, 180 + Math.floor(k / 2) * 24, LEG[o], '', 13)]).flat();
      let refused = 0, fails = 0;
      F.add({ items: [...axis(), ...legend()], say: `The policy: ${H.plural(inp.free, 'free try', 'free tries')}, then a wait that starts at 1 s and doubles after each failure, and a lock after ${H.plural(inp.lock, 'failure')}.`, meta: { phase: 'start' } });
      R.steps.forEach((st, k) => {
        if (st.kind === 'too-soon' || st.kind === 'locked') { refused++; F.count('refused'); }
        if (st.kind === 'fail') { fails++; F.count('fails'); }
        F.add({ items: [...axis(), ...legend(), ...marks(k + 1)], say: st.say, meta: { phase: 'attempt', k, t: st.t, fails: st.fails, outcome: R.results[k].outcome, wait: st.fails >= inp.free ? 2 ** (st.fails - inp.free) : 0, prevWait: st.fails >= inp.free + 1 ? 2 ** (st.fails - 1 - inp.free) : 0, last: k ? R.results.slice(0, k).filter((x) => x.outcome === 'ok' || x.outcome === 'fail').map((x) => x.t) : [] }, title: 't = ' + st.t + ' · ' + R.results[k].outcome });
      });
      F.add({ items: [...axis(), ...legend(), ...marks(R.results.length)], say: H.plain(B.say) + ' Online guessing is hopeless against such a limit; that is why the stored hashes, which could be attacked offline, must be salted and slow as well.', meta: { phase: 'budget', guesses: B.guesses, seconds: 86400 }, title: 'the guess budget' });
      // the second factor
      const m = MFA[inp.mfa], secret = 'device-ana', t = 1000, step = Math.floor(t / 30);
      const rec = Pr().store([USERS[0]], { seed: 7, rounds: 3 }).records[0];
      const code = m.code === 'prev' ? Pr().totp(secret, t - 30) : m.code === 'wrong' ? String((+Pr().totp(secret, t) + 1) % 1e6).padStart(6, '0') : Pr().totp(secret, t);
      const M2 = Pr().mfa({ record: rec, password: m.password, code, t, secret, window: 1, lastStep: m.code === 'replay' ? step : undefined });
      const box2 = (k, cls) => [
        { key: 'f1', kind: 'cell', x: 0, y: 250, w: 240, h: 54, rx: 8, lines: ['factor 1: something known', 'the password'], size: 14, cls: 'idbox ' + (k >= 1 ? cls[0] : '') },
        { key: 'f2', kind: 'cell', x: 280, y: 250, w: 240, h: 54, rx: 8, lines: ['factor 2: something held', 'code ' + code], size: 14, cls: 'idbox ' + (k >= 2 ? cls[1] : '') },
        { key: 'fin', kind: 'cell', x: 560, y: 250, w: 140, h: 54, rx: 8, lines: [k >= 3 ? (M2.ok ? 'logged in' : 'denied') : 'login'], size: 15, cls: 'idbox ' + (k >= 3 ? (M2.ok ? 'tagok' : 'taghot') : '') },
        { key: 'fe1', kind: 'edge', from: 'f1', to: 'f2', cls: k >= 2 ? 'act' : '' }, { key: 'fe2', kind: 'edge', from: 'f2', to: 'fin', cls: k >= 3 ? 'act' : '' },
      ];
      const f1ok = M2.steps[0].kind === 'factor1' && /checks out/.test(M2.steps[0].say), last = M2.steps[M2.steps.length - 1];
      const cls = [f1ok ? 'tagok' : 'taghot', M2.ok ? 'tagok' : 'taghot'];
      const all = [...axis(), ...legend(), ...marks(R.results.length)];
      F.add({ items: [...all, ...box2(0, cls)], say: `Now a login with two factors at t = ${t} s, time step ${step} of 30 s: ${m.label.toLowerCase()}.`, meta: { phase: 'mfa', t, step, code, stepLen: 30, digits: 6, factors: [1, 2] } });
      M2.steps.forEach((s2, k) => F.add({ items: [...all, ...box2(s2.kind === 'factor1' ? 1 : s2.kind === 'ask' ? 1 : 3, cls)], say: s2.say, meta: { phase: 'mfa-' + s2.kind, t, step, code, used: M2.usedStep, lo: step - 1, hi: step + 1, stepLen: 30, digits: 6, factors: [1, 2] }, title: s2.kind }));
      F.last().hold = 3000;
      void last;
      return { frames: F.list, def: { sections: [{ id: 'd', kind: 'math', title: 'Limits and factors', text: ['free tries, then wait 1, 2, 4, 8 … s', 'lock after a number of failures', 'factor 1: something you know (password)', 'factor 2: something you have (a device)', '  or something you are', 'a code: valid for one time step, once'].join('\n') }] } };
    },
    predict: [{ at: (f) => f.meta.phase === 'mfa', pick: 'option', ask: 'Will this login succeed?', options: ['yes', 'no'], answer: (fr) => (fr[fr.length - 1].say.includes('the user is in') ? 'yes' : 'no'), explain: (fr) => fr[fr.length - 1].say }],
    quiz: [
      { q: 'Doubling the wait after each failure mainly…', options: ['caps how many guesses fit in a day, however fast the guesser', 'helps users remember', 'stores the password safely', 'removes the need for a hash'], answer: 0, why: 'The total time grows exponentially with the number of guesses.' },
      { q: 'Why can locking an account be a problem in itself?', options: ['anyone can lock someone else out on purpose', 'it uses memory', 'it makes passwords longer', 'it disables the hash'], answer: 0, why: 'A lock is a denial of service against the owner; resets must be easy for the real user.' },
      { q: 'A second factor protects an account when…', options: ['the password has leaked', 'the user forgot the password', 'the server is down', 'the hash is slow'], answer: 0, why: 'The attacker also needs the device.' },
      { q: 'Why is a one-time code refused when used a second time?', options: ['so a code seen once cannot be replayed', 'the device forgets it', 'it has expired after one second', 'codes must be even'], answer: 0, why: 'Each code is valid for one login only.' },
    ],
  });
})(globalThis.Proses = globalThis.Proses || {});
