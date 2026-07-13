// The banker's algorithm: the safety check (Work and Finish, row by row) and request granting, and the detection
// algorithm for many-instance resources (the same scan with the current requests in place of Need).
//   S.Banker.need(max, alloc) -> Need = Max − Allocation
//   S.Banker.safety({avail, alloc, need, names, res}) -> {safe, seq, work, finish, steps}
//     steps: {kind: 'start' | 'check' | 'safe' | 'unsafe', say, i, pass, fits, work (before), after (Work after),
//             finish (after), short (a few words for the step line)}; rows are scanned in passes from P0 down, a
//             finished row is skipped, and the check stops when a whole pass finishes nobody.
//   S.Banker.request({avail, alloc, max, names, res}, i, req) -> {verdict: 'granted' | 'over-need' | 'wait' | 'unsafe',
//     steps, safety, after}   after: the state with the request granted (null unless granted)
//   S.Banker.detect({avail, alloc, request, names, res}) -> {deadlocked: [i..], steps}
(function (S) {
  'use strict';
  const B = (S.Banker = S.Banker || {});
  const vec = (v) => '(' + v.join(', ') + ')';
  const le = (a, b) => a.every((x, j) => x <= b[j]);
  const add = (a, b) => a.map((x, j) => x + b[j]);
  const sub = (a, b) => a.map((x, j) => x - b[j]);
  B.vec = vec; B.le = le;
  const RES = 'ABCDEFGH';
  const resNames = (o, m) => o.res || RES.slice(0, m).split('');
  const procNames = (o, n) => o.names || Array.from({ length: n }, (_, i) => 'P' + i);

  B.need = (max, alloc) => max.map((row, i) => sub(row, alloc[i]));

  /** the first resource where a > b, as a phrase: "4 of A is more than the 3 free" */
  function shortBy(a, b, res, what) {
    const j = a.findIndex((x, k) => x > b[k]);
    return `${a[j]} of ${res[j]} is more than the ${b[j]} ${what}`;
  }

  /** the scan shared by the safety check and detection: want[i] is what row i still asks for */
  function scan(o, want, label, start) {
    const n = o.alloc.length, m = o.avail.length, res = resNames(o, m), P = procNames(o, n);
    let work = o.avail.slice();
    const finish = start || Array(n).fill(false), seq = [], steps = [];
    steps.push({ kind: 'start', work: work.slice(), finish: finish.slice(), short: 'Work = Available', say: `The check starts with Work = Available = \`${vec(work)}\` and Finish false for every process${finish.some(Boolean) ? ' that holds anything' : ''}.` });
    let pass = 0, progress = true;
    while (progress && finish.some((f) => !f)) {
      progress = false; pass++;
      for (let i = 0; i < n; i++) {
        if (finish[i]) continue;
        const before = work.slice(), fits = le(want[i], work);
        if (fits) {
          work = add(work, o.alloc[i]); finish[i] = true; seq.push(i); progress = true;
          steps.push({ kind: 'check', i, pass, fits, work: before, after: work.slice(), finish: finish.slice(), short: `${P[i]} can finish`, say: `${P[i]}: ${label} \`${vec(want[i])}\` ≤ Work \`${vec(before)}\`, so ${P[i]} can run to the end and give back its allocation \`${vec(o.alloc[i])}\`: Work becomes \`${vec(work)}\` and Finish[${i}] is true.` });
        } else {
          steps.push({ kind: 'check', i, pass, fits, work: before, after: before, finish: finish.slice(), short: `${P[i]} must wait`, say: `${P[i]}: ${label} \`${vec(want[i])}\` is not ≤ Work \`${vec(before)}\` (${shortBy(want[i], before, res, 'free')}), so ${P[i]} cannot finish yet.` });
        }
      }
    }
    return { work, finish, seq, steps, P };
  }

  B.safety = function (o) {
    const need = o.need || B.need(o.max, o.alloc);
    const r = scan(o, need, 'Need');
    const safe = r.finish.every(Boolean), P = r.P;
    if (safe) r.steps.push({ kind: 'safe', seq: r.seq.slice(), work: r.work.slice(), finish: r.finish.slice(), short: 'safe', say: `Every Finish is true, so the state is safe: one safe sequence is ⟨${r.seq.map((i) => P[i]).join(', ')}⟩, and Work ends at \`${vec(r.work)}\`, everything there is.` });
    else {
      const stuck = r.finish.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
      r.steps.push({ kind: 'unsafe', seq: r.seq.slice(), stuck, work: r.work.slice(), finish: r.finish.slice(), short: 'unsafe', say: `A whole pass finishes nobody: ${stuck.map((i) => P[i]).join(', ')} ${stuck.length > 1 ? 'are' : 'is'} left with Finish false, so the state is unsafe. If they all asked for their full Need now, nobody could go on.` });
    }
    return { safe, seq: r.seq, work: r.work, finish: r.finish, steps: r.steps };
  };

  B.request = function (o, i, req) {
    const n = o.alloc.length, m = o.avail.length, res = resNames(o, m), P = procNames(o, n);
    const need = B.need(o.max, o.alloc), steps = [];
    if (!le(req, need[i])) {
      steps.push({ kind: 'over-need', i, req, short: 'over its claim', say: `${P[i]} asks for \`${vec(req)}\`, but its Need is only \`${vec(need[i])}\` (${shortBy(req, need[i], res, 'it declared it might still need')}): an error, it broke its own claim.` });
      return { verdict: 'over-need', steps, safety: null, after: null };
    }
    steps.push({ kind: 'req-need', i, req, short: 'within its Need', say: `${P[i]} asks for \`${vec(req)}\`. First test: Request ≤ Need \`${vec(need[i])}\`, so it stays within its declared claim.` });
    if (!le(req, o.avail)) {
      steps.push({ kind: 'wait', i, req, short: 'must wait', say: `Second test fails: Request \`${vec(req)}\` is not ≤ Available \`${vec(o.avail)}\` (${shortBy(req, o.avail, res, 'free')}), so ${P[i]} must wait; nothing changes.` });
      return { verdict: 'wait', steps, safety: null, after: null };
    }
    const after = { avail: sub(o.avail, req), alloc: o.alloc.map((r, k) => (k === i ? add(r, req) : r.slice())), max: o.max, names: o.names, res: o.res };
    after.need = B.need(after.max, after.alloc);
    steps.push({ kind: 'pretend', i, req, state: after, short: 'pretend to grant', say: `Second test: Request ≤ Available \`${vec(o.avail)}\`. Pretend to grant it: Available becomes \`${vec(after.avail)}\`, ${P[i]}'s Allocation \`${vec(after.alloc[i])}\` and its Need \`${vec(after.need[i])}\`. Is that state safe?` });
    const safety = B.safety(after);
    if (safety.safe) {
      steps.push({ kind: 'granted', i, req, state: after, short: 'granted', say: `The pretended state is safe (⟨${safety.seq.map((k) => P[k]).join(', ')}⟩), so the request \`${vec(req)}\` is granted for real.` });
      return { verdict: 'granted', steps, safety, after };
    }
    steps.push({ kind: 'denied', i, req, state: o, short: 'denied', say: `The pretended state is unsafe, so the request \`${vec(req)}\` is denied although the units are free: ${P[i]} waits, and the tables go back to how they were.` });
    return { verdict: 'unsafe', steps, safety, after: null };
  };

  B.detect = function (o) {
    const start = o.alloc.map((row) => row.every((x) => x === 0));
    const r = scan(o, o.request, 'Request', start);
    const deadlocked = r.finish.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
    r.steps.push({ kind: deadlocked.length ? 'deadlock' : 'clear', deadlocked, short: deadlocked.length ? 'deadlock' : 'no deadlock', say: deadlocked.length ? `Nobody else can finish: ${deadlocked.map((i) => r.P[i]).join(', ')} ${deadlocked.length > 1 ? 'are' : 'is'} deadlocked.` : 'Every process can finish with what it holds and asks for: there is no deadlock now.' });
    return { deadlocked, steps: r.steps };
  };
  (S.engines = S.engines || []).push({ name: "The banker's algorithm" });
})(globalThis.Proses = globalThis.Proses || {});
