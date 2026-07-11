// The Chandy–Misra idea at a small scale: philosophers round a table share forks that are clean or dirty, and pass
// request tokens. A philosopher keeps a clean fork while hungry and gives up a dirty one when asked (cleaning it on
// the way), so a fork goes to whoever has waited longer, and nobody starves. It is a model-checker system of its
// own (not machine code): every philosopher's possible action is a choice.
//   S.Sync.chandy(n, variant) -> system   variant 'correct' (forks start with the lower-numbered neighbour, dirty:
//     an acyclic start) | 'cyclic' (each philosopher starts with its left fork, clean: a circle of precedence,
//     and everyone hungry holds on: deadlock)
//   system: choices() -> ['i:hungry' | 'i:request:f' | 'i:give:f' | 'i:eat' | 'i:done'], step(choice) -> {kind, say,
//     tid, mark}, clone(), hash(), status(), owner(choice), snap() -> {phil: [{state, meals}], forks: [{holder,
//     dirty, token}]}, spec: {check, expect, expectLive, about}
//   Fork f lies between philosophers f and f + 1 (mod n); token is where the request token for f is.
(function (S) {
  'use strict';
  const Y = (S.Sync = S.Sync || {});

  class Chandy {
    constructor(n, variant, from) {
      this.n = n; this.variant = variant || 'correct';
      if (from) { this.phil = from.phil.map((p) => Object.assign({}, p)); this.forks = from.forks.map((f) => Object.assign({}, f)); return; }
      this.phil = Array.from({ length: n }, () => ({ state: 'thinking', meals: 0 }));
      this.forks = Array.from({ length: n }, (_, f) => {
        const a = f, b = (f + 1) % n;
        const holder = this.variant === 'cyclic' ? b : Math.min(a, b);
        return { a, b, holder, dirty: this.variant !== 'cyclic', token: holder === a ? b : a };
      });
      const tid = (i) => i;
      this.spec = {
        check: { invariants: [{ name: 'neighbours never eat at once', holds: (s) => s.phil.every((p, i) => !(p.state === 'eating' && s.phil[(i + 1) % n].state === 'eating')) }, { name: 'an eater holds both its forks', holds: (s) => s.phil.every((p, i) => p.state !== 'eating' || s.mine(i).every((f) => s.forks[f].holder === i)) }], liveness: Array.from({ length: n }, (_, i) => ({ name: 'P' + i + ' eventually eats', thread: tid(i), progress: (st) => st.tid === i && st.kind === 'eat', trying: (s) => s.phil[i].state === 'hungry' })), deadlock: true },
        expect: this.variant === 'cyclic' ? 'deadlock' : 'ok', expectLive: 'ok',
        about: this.variant === 'cyclic' ? 'Each starts with one clean fork: hungry philosophers never give up a clean fork, so a circle of holders waits for ever.' : 'Forks start dirty with the lower-numbered neighbour, so the precedence order has no cycle; a dirty fork is handed over when asked, and the asker eats next.',
      };
    }
    mine(i) { return [i, (i - 1 + this.n) % this.n]; }
    other(f, i) { return this.forks[f].a === i ? this.forks[f].b : this.forks[f].a; }
    choices() {
      const out = [];
      this.phil.forEach((p, i) => {
        if (p.state === 'thinking') out.push(i + ':hungry');
        if (p.state === 'eating') out.push(i + ':done');
        for (const f of this.mine(i)) {
          const k = this.forks[f];
          if (p.state === 'hungry' && k.holder !== i && k.token === i) out.push(i + ':request:' + f);
          if (k.holder === i && k.token === i && k.dirty && p.state !== 'eating') out.push(i + ':give:' + f);
        }
        // a dirty fork someone has asked for must be handed over first: that is what stops a fast eater from
        // eating again and again
        if (p.state === 'hungry' && this.mine(i).every((f) => this.forks[f].holder === i && !(this.forks[f].dirty && this.forks[f].token === i))) out.push(i + ':eat');
      });
      return out;
    }
    owner(c) { return parseInt(c, 10); }
    step(c) {
      const [is, act, fs] = c.split(':'), i = +is, f = +fs, p = this.phil[i], k = this.forks[f];
      const P = (j) => 'P' + j;
      if (act === 'hungry') { p.state = 'hungry'; return { tid: i, kind: 'hungry', say: `${P(i)} gets hungry.` }; }
      if (act === 'request') { k.token = k.holder; return { tid: i, kind: 'request', say: `${P(i)} sends its request token for fork ${f} to ${P(k.holder)}.` }; }
      if (act === 'give') { const to = this.other(f, i); k.holder = to; k.dirty = false; return { tid: i, kind: 'give', say: `${P(i)} holds the token for its dirty fork ${f}: it cleans the fork and hands it to ${P(to)}, keeping the token.` }; }
      if (act === 'eat') { p.state = 'eating'; p.meals++; for (const g of this.mine(i)) this.forks[g].dirty = true; return { tid: i, kind: 'eat', mark: 'progress', say: `${P(i)} has both forks and eats; they are dirty now.` }; }
      p.state = 'thinking';
      return { tid: i, kind: 'done', say: `${P(i)} finishes eating and thinks; it will hand over any fork it is asked for.` };
    }
    clone() { const c = new Chandy(this.n, this.variant, this); c.spec = this.spec; return c; }
    hash() { return this.phil.map((p) => p.state[0]).join('') + '|' + this.forks.map((k) => k.holder + (k.dirty ? 'd' : 'c') + k.token).join(','); }
    status() { return this.choices().length ? 'running' : 'deadlock'; }
    snap() { return { phil: this.phil.map((p) => Object.assign({}, p)), forks: this.forks.map((k) => Object.assign({}, k)) }; }
  }
  Y.chandy = (n, variant) => new Chandy(n || 3, variant);
})(globalThis.Proses = globalThis.Proses || {});
