// Protection, part 3: authentication as concepts. Passwords are stored salted and hashed; failed logins are rate
// limited; a second factor (a time-based one-time code) is checked after the password. The hash here is a TOY:
// 32 bits and fast, so that the steps are easy to follow. Real systems use a slow, salted, memory-hard password
// hash with a long output. Nothing here guesses or recovers anyone's password.
//   S.Prot.TOY_NOTE                     the sentence every view shows beside the toy hash
//   S.Prot.toyHash(text) -> 8 hex digits (FNV-1a, 32 bits: a toy)
//   S.Prot.hashPassword(password, salt, rounds) -> {hash, steps}: rounds of toyHash(previous + salt + password)
//   S.Prot.store([{name, password}], {salted: true, rounds: 3, seed}) -> {records: [{name, salt, hash, rounds}],
//       steps, shared: [[names with the same stored hash]]}
//   S.Prot.verify(record, attempt) -> {ok, steps}: the salt is read from the record and the hash recomputed
//   S.Prot.rateLimit({attempts: [{t, ok}], free: 3, delay: 1, lockAfter: 8})
//       -> {steps, results: [{t, outcome: 'ok' | 'fail' | 'too-soon' | 'locked'}]}: after `free` failures in a row
//       each new attempt must wait delay × 2^(failures − free) seconds since the last one; after lockAfter
//       failures the account locks until someone resets it; a success clears the count.
//   S.Prot.guessBudget({free, delay, lockAfter, seconds}) -> {guesses, say}: the most attempts that policy lets
//       anyone make in that time.
//   S.Prot.totp(secret, t, {step: 30, digits: 6}) -> code (a toy time-based code)
//   S.Prot.mfa({record, password, code, t, secret, window: 1, lastStep}) -> {ok, state, steps, usedStep}
(function (S) {
  'use strict';
  const P = (S.Prot = S.Prot || {});
  P.TOY_NOTE = 'A toy hash: 32 bits and fast, for following the steps only. Real systems use a slow, memory-hard password hash with a long output.';

  P.toyHash = function (text) {
    let h = 0x811c9dc5;
    for (const ch of String(text)) { h ^= ch.charCodeAt(0) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  P.hashPassword = function (pw, salt, rounds) {
    rounds = Math.max(1, rounds || 1);
    let h = '';
    const steps = [];
    for (let i = 0; i < rounds; i++) {
      const prev = h;
      h = P.toyHash(prev + (salt || '') + pw);
      steps.push({ kind: 'round', round: i + 1, value: h, say: 'Round ' + (i + 1) + ': toyHash(' + (prev ? prev + ' + ' : '') + (salt ? 'salt ' + salt + ' + ' : '') + 'password) = ' + h + '.' });
    }
    return { hash: h, steps };
  };

  P.store = function (users, o) {
    o = o || {};
    const salted = o.salted !== false, rounds = Math.max(1, o.rounds || 3), rand = S.Os.rng(o.seed === undefined ? 7 : o.seed);
    const records = [], steps = [];
    for (const u of users) {
      const salt = salted ? Array.from({ length: 4 }, () => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('') : '';
      const h = P.hashPassword(u.password, salt, rounds);
      records.push({ name: u.name, salt, hash: h.hash, rounds });
      steps.push({ kind: 'store', name: u.name, say: u.name + ': ' + (salted ? 'a fresh random salt ' + salt + ', then ' : 'no salt, then ') + rounds + ' round' + (rounds > 1 ? 's' : '') + ' of the toy hash give ' + h.hash + '; the file keeps the salt and the hash, never the password.' });
    }
    const by = {};
    for (const r of records) (by[r.hash] = by[r.hash] || []).push(r.name);
    const shared = Object.values(by).filter((g) => g.length > 1);
    steps.push({ kind: 'result', say: shared.length ? 'Without salts, ' + shared.map((g) => g.join(' and ')).join('; ') + ' chose the same password and store the same hash, so the file itself shows it: one reason every account gets its own salt.' : salted ? 'Every record has its own salt, so even equal passwords give different hashes and no shared table of precomputed hashes fits.' : 'No two hashes match here, but equal passwords would show as equal hashes.' });
    return { records, steps, shared };
  };

  P.verify = function (rec, attempt) {
    const h = P.hashPassword(attempt, rec.salt, rec.rounds), steps = [];
    steps.push({ kind: 'salt', say: 'The system reads ' + rec.name + '\'s record: salt ' + (rec.salt || '(none)') + ', ' + P.plural(rec.rounds, 'round') + ', stored hash ' + rec.hash + '.' });
    steps.push(...h.steps);
    // compare every digit, whatever the first mismatch, so the time taken does not say how much matched
    let diff = 0;
    for (let i = 0; i < 8; i++) diff |= h.hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
    const ok = diff === 0;
    steps.push({ kind: ok ? 'match' : 'mismatch', say: 'The computed ' + h.hash + (ok ? ' equals' : ' differs from') + ' the stored ' + rec.hash + ' (all 8 digits compared, whatever matched first): ' + (ok ? 'the password is right.' : 'the password is wrong.') });
    return { ok, steps };
  };

  P.rateLimit = function (o) {
    o = o || {};
    const free = o.free === undefined ? 3 : o.free, delay = o.delay || 1, lockAfter = o.lockAfter || 8;
    const steps = [], results = [];
    let fails = 0, last = -Infinity, locked = false;
    for (const a of o.attempts || []) {
      const wait = fails >= free ? delay * 2 ** (fails - free) : 0;
      let outcome;
      if (locked) { outcome = 'locked'; steps.push({ kind: 'locked', t: a.t, fails, say: 't = ' + a.t + ': the account is locked after ' + P.plural(fails, 'failure') + '; the attempt is refused unchecked until someone resets it.' }); }
      else if (wait > 0 && a.t - last < wait) { outcome = 'too-soon'; steps.push({ kind: 'too-soon', t: a.t, fails, say: 't = ' + a.t + ': after ' + P.plural(fails, 'failure') + ' the next try must wait ' + wait + ' s from t = ' + last + '; this one comes too soon and is refused unchecked.' }); }
      else if (a.ok) { outcome = 'ok'; fails = 0; last = a.t; steps.push({ kind: 'ok', t: a.t, fails, say: 't = ' + a.t + ': the password is right; the failure count goes back to 0.' }); }
      else {
        outcome = 'fail'; fails++; last = a.t;
        const next = fails >= free ? delay * 2 ** (fails - free) : 0;
        if (fails >= lockAfter) locked = true;
        steps.push({ kind: 'fail', t: a.t, fails, say: 't = ' + a.t + ': wrong password, failure ' + fails + '. ' + (locked ? 'That reaches ' + lockAfter + ': the account locks.' : next ? 'The next try must wait ' + next + ' s.' : 'Still within the ' + free + ' free tries.') });
      }
      results.push({ t: a.t, outcome });
    }
    return { steps, results };
  };
  P.guessBudget = function (o) {
    o = o || {};
    const free = o.free === undefined ? 3 : o.free, delay = o.delay || 1, lockAfter = o.lockAfter || 8, T = o.seconds || 86400;
    let t = 0, n = 0;
    while (n < lockAfter) { const w = n >= free ? delay * 2 ** (n - free) : 0; if (t + w > T) break; t += w; n++; }
    return { guesses: n, say: 'With ' + P.plural(free, 'free try', 'free tries') + ', waits doubling from ' + delay + ' s and a lock after ' + P.plural(lockAfter, 'failure') + ', at most ' + P.plural(n, 'wrong guess', 'wrong guesses') + ' fit in ' + T + ' s, however fast the guesser.' };
  };

  P.totp = function (secret, t, o) {
    o = o || {};
    const step = o.step || 30, digits = o.digits || 6, n = Math.floor(t / step);
    const v = parseInt(P.toyHash(secret + ':' + n), 16) % 10 ** digits;
    return String(v).padStart(digits, '0');
  };

  P.mfa = function (o) {
    const steps = [], step = 30, win = o.window === undefined ? 1 : o.window;
    const v = P.verify(o.record, o.password);
    steps.push({ kind: 'factor1', say: 'Factor 1, something the user knows: ' + (v.ok ? 'the password checks out.' : 'the password is wrong, so the login stops here, without saying which factor failed.') });
    if (!v.ok) return { ok: false, state: 'denied', steps, usedStep: null };
    steps.push({ kind: 'ask', say: 'Factor 2, something the user has: the server asks for the 6-digit code their device shows.' });
    const now = Math.floor(o.t / step);
    let used = null;
    for (let k = -win; k <= win; k++) if (P.totp(o.secret, (now + k) * step) === String(o.code)) { used = now + k; break; }
    if (used === null) { steps.push({ kind: 'factor2', say: 'Code ' + o.code + ' matches none of the codes for time steps ' + (now - win) + ' to ' + (now + win) + ': denied.' }); return { ok: false, state: 'denied', steps, usedStep: null }; }
    if (o.lastStep !== undefined && used <= o.lastStep) { steps.push({ kind: 'replay', say: 'Code ' + o.code + ' belongs to time step ' + used + ', which was already used: a code works only once, so it is refused.' }); return { ok: false, state: 'denied', steps, usedStep: null }; }
    steps.push({ kind: 'factor2', say: 'Code ' + o.code + ' matches time step ' + used + (used === now ? ' (now)' : ' (one step ' + (used < now ? 'old' : 'ahead') + ', allowed for clock drift)') + ': both factors pass, and the user is in.' });
    return { ok: true, state: 'in', steps, usedStep: used };
  };
})(globalThis.Proses = globalThis.Proses || {});
