// Deadlock exercise kinds: the banker's algorithm (a safe sequence, or a verdict) and spotting a cycle in a
// resource-allocation graph.
//   banker       {avail: [..], alloc: [[..]..], max: [[..]..], names?, res?, ask: 'sequence' | 'verdict',
//                 request?: {who: i, req: [..]}}
//                ask 'sequence': Answer 'P1, P3, P0, ..' (any safe sequence passes: it is checked by running it
//                  row by row, not by comparing it with one) or 'none' when the state is unsafe.
//                ask 'verdict': with a request, 'granted' | 'wait' | 'unsafe' | 'over-need'; without, 'safe' | 'unsafe'.
//   graph-cycle  {graph: {procs: [name..], res: [{name, units}..], hold: [[p, r]..], want: [[p, r]..]}}
//                Answer: the names on a cycle, '{P0, R1, P1, R0}' or ['P0', 'R1', ..], or 'none'. Any cycle the graph
//                has passes (the nodes must close a directed cycle in the graph); with exact: true only the
//                engine's own cycle.
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  const O = () => K.os;
  const names = (x) => x.names || x.alloc.map((_, i) => 'P' + i);
  const resNames = (x) => x.res || x.avail.map((_, j) => String.fromCharCode(65 + j));
  const need = (x) => S.Banker.need(x.max, x.alloc);

  /** does this order of rows run to the end? null when it does, else the reason */
  function runSeq(x, order) {
    const N = need(x), P = names(x), R = resNames(x);
    let work = x.avail.slice();
    const done = new Set();
    for (const i of order) {
      if (done.has(i)) return P[i] + ' appears twice';
      const j = N[i].findIndex((v, k) => v > work[k]);
      if (j >= 0) return P[i] + ' cannot finish when its turn comes: it may still need ' + N[i][j] + ' of ' + R[j] + ' and only ' + work[j] + ' are free then';
      work = work.map((w, k) => w + x.alloc[i][k]);
      done.add(i);
    }
    if (done.size < x.alloc.length) return 'the sequence leaves out ' + P.filter((_, i) => !done.has(i)).join(', ');
    return null;
  }
  K.os.bankerRun = runSeq;

  O().kind('banker', {
    expected(x) {
      if (x.ask === 'verdict') {
        if (x.request) return S.Banker.request({ avail: x.avail, alloc: x.alloc, max: x.max, names: x.names, res: x.res }, x.request.who, x.request.req).verdict;
        return S.Banker.safety({ avail: x.avail, alloc: x.alloc, need: need(x), names: x.names, res: x.res }).safe ? 'safe' : 'unsafe';
      }
      const s = S.Banker.safety({ avail: x.avail, alloc: x.alloc, need: need(x), names: x.names, res: x.res });
      return s.safe ? s.seq.map((i) => names(x)[i]).join(', ') : 'none';
    },
    check(x, a) {
      const txt = O().norm(Array.isArray(a) ? a.join(', ') : a);
      if (!txt) return { ok: false, message: x.ask === 'verdict' ? 'Choose a verdict first.' : 'Type a sequence first, like P1, P3, P0, or none.' };
      const want = this.expected(x);
      if (x.ask === 'verdict') {
        const v = txt.replace(/^(it is |the request is )/, '').replace(/[.!]$/, '').replace(/^grant$/, 'granted').replace(/^over need$/, 'over-need');
        if (v === want) return { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') };
        return { ok: false, message: 'Not quite: the verdict is not ' + v + '.' + (x.whyNot ? ' ' + x.whyNot : ''), details: ['Check the request against Need, then against Available, then pretend to grant it and run the safety check.'] };
      }
      const P = names(x).map((p) => p.toLowerCase());
      if (/^(none|unsafe|no safe sequence|no)$/.test(txt)) {
        if (want === 'none') return { ok: true, message: 'Right: no order lets every process finish, so the state is unsafe.' + (x.why ? ' ' + x.why : '') };
        return { ok: false, message: 'Not quite: there is an order in which every process can finish.' };
      }
      const order = O().list(txt).map((t) => P.indexOf(t.toLowerCase()));
      const bad = O().list(txt).find((t, k) => order[k] < 0);
      if (bad !== undefined) return { ok: false, message: '"' + bad + '" is not one of the processes ' + names(x).join(', ') + '.' };
      if (want === 'none') return { ok: false, message: 'Not quite: ' + (runSeq(x, order) || 'that order does not work') + '.', details: ['Is there any process that can finish with what is free now?'] };
      const why = runSeq(x, order);
      if (why) return { ok: false, message: 'Not quite: ' + why + '.' };
      return { ok: true, message: 'Right: every process can finish in that order.' + (x.why ? ' ' + x.why : '') };
    },
    lint(x) {
      const p = [];
      if (!x.alloc || !x.max || !x.avail) return ['the state needs avail, alloc and max'];
      if (x.alloc.length !== x.max.length) p.push('alloc and max have different numbers of rows');
      x.alloc.forEach((r, i) => r.forEach((v, j) => { if (v > x.max[i][j]) p.push(names(x)[i] + ' holds more ' + resNames(x)[j] + ' than its maximum'); }));
      if (x.ask === 'verdict' && x.request && !(x.request.who >= 0 && x.request.who < x.alloc.length)) p.push('the request names no process');
      return p;
    },
    wrongFrom(x) {
      if (x.ask === 'verdict') return [['granted', 'wait', 'unsafe', 'over-need', 'safe'].find((v) => v !== this.expected(x) && (x.request ? v !== 'safe' : ['safe', 'unsafe'].includes(v)))];
      const w = this.expected(x);
      if (w === 'none') return [names(x).join(', ')];
      return ['none', w.split(', ').reverse().join(', ')].filter((v) => this.check(x, v).ok === false);
    },
    example() {
      return {
        id: 'k-banker', kind: 'banker', title: 'A safe sequence', level: 2, ask: 'sequence',
        text: ['Four processes share three resource types A, B and C. Find an order in which every process can finish, or write none.'],
        avail: [2, 1, 1], alloc: [[1, 0, 2], [0, 2, 0], [2, 1, 0], [1, 0, 0]], max: [[3, 2, 2], [1, 3, 1], [4, 2, 2], [2, 1, 2]],
        hints: ['Work out Need = Max − Allocation for each row first.', 'With Available (2, 1, 1), only rows whose Need fits can go first; each one that finishes returns its allocation.', 'Only P1 fits first (Need 1, 1, 1); after it only P0 fits; then P2 and P3 in either order: P1, P0, P2, P3 is one safe sequence.'],
        solution: 'P1, P0, P2, P3', wrong: ['P2, P1, P0, P3', 'none', 'P1, P3, P0, P2', 'P1, P0, P2'],
      };
    },
  });

  // ---- graph-cycle -------------------------------------------------------------------------------------------------
  /** the nodes and the directed edges of a graph, by name */
  K.os.ragNodes = function (x) {
    const g = S.Rag.graph(x.graph);
    const nameOf = (id) => (id[0] === 'p' ? x.graph.procs[+id.slice(1)] : x.graph.res[+id.slice(1)].name);
    return { g, edges: S.Rag.edges(g).map((e) => ({ from: nameOf(e.from), to: nameOf(e.to), kind: e.kind })), nodes: x.graph.procs.concat(x.graph.res.map((r) => r.name)), nameOf };
  };
  /** do these nodes close a directed cycle using only edges among them, every node once? */
  function closes(set, edges) {
    const list = [...set];
    if (list.length < 2) return false;
    const adj = new Map(list.map((n) => [n, edges.filter((e) => e.from === n && set.has(e.to)).map((e) => e.to)]));
    const start = list[0], seen = new Set([start]);
    const dfs = (n) => {
      for (const m of adj.get(n)) {
        if (m === start && seen.size === list.length) return true;
        if (!seen.has(m)) { seen.add(m); if (dfs(m)) return true; seen.delete(m); }
      }
      return false;
    };
    return dfs(start);
  }
  K.os.closesCycle = closes;
  O().kind('graph-cycle', {
    expected(x) { const R = K.os.ragNodes(x), c = S.Rag.cycle(R.g).cycle; return c ? c.map(R.nameOf) : null; },
    check(x, a) {
      const R = K.os.ragNodes(x), want = this.expected(x);
      const got = Array.isArray(a) ? a.map(String) : O().list(String(a === undefined || a === null ? '' : a).replace(/[{}()]/g, ' '));
      if (!got.length) return { ok: false, message: 'Pick the nodes of a cycle first (or answer none).' };
      if (got.length === 1 && /^(none|no|∅)$/i.test(got[0])) return want ? { ok: false, message: 'Not quite: this graph has a cycle.' } : { ok: true, message: 'Right: there is no cycle, so no deadlock.' + (x.why ? ' ' + x.why : '') };
      const lower = new Map(R.nodes.map((n) => [n.toLowerCase(), n]));
      const bad = got.find((n) => !lower.has(n.toLowerCase()));
      if (bad) return { ok: false, message: '"' + bad + '" is not a node of this graph.' };
      const set = new Set(got.map((n) => lower.get(n.toLowerCase())));
      if (!want) return { ok: false, message: 'Not quite: follow the arrows from ' + [...set][0] + ': they never come back to it, and no other cycle exists either.' };
      if (x.exact) {
        const ok = set.size === want.length && want.every((n) => set.has(n));
        return ok ? { ok: true, message: 'Right.' + (x.why ? ' ' + x.why : '') } : { ok: false, message: 'Not quite: ' + O().plural(want.filter((n) => !set.has(n)).length, 'node is', 'nodes are') + ' missing or ' + O().plural([...set].filter((n) => !want.includes(n)).length, 'node does', 'nodes do') + ' not belong.' };
      }
      if (closes(set, R.edges)) return { ok: true, message: 'Right: ' + [...set].join(', ') + ' close a cycle.' + (x.why ? ' ' + x.why : '') };
      return { ok: false, message: 'Not quite: the arrows among ' + [...set].join(', ') + ' do not lead round through every one of them and back.' };
    },
    lint(x) { const p = []; try { K.os.ragNodes(x); } catch (e) { p.push('the graph is refused: ' + e.message); } return p; },
    wrongFrom(x) { const w = this.expected(x), R = K.os.ragNodes(x); return w ? ['none', w.slice(0, -1).join(', ')] : [R.nodes.slice(0, 2).join(', ')]; },
    example() {
      return {
        id: 'k-cycle', kind: 'graph-cycle', title: 'Find the cycle', level: 1,
        text: ['Three processes and three single-unit resources. Click the nodes that form a cycle, or answer none.'],
        graph: { procs: ['P0', 'P1', 'P2'], res: [{ name: 'R0', units: 1 }, { name: 'R1', units: 1 }, { name: 'R2', units: 1 }], hold: [[0, 0], [1, 1], [2, 2]], want: [[0, 1], [1, 2], [2, 1]] },
        hints: ['An arrow from a process to a resource is a request; from a resource to a process, an assignment.', 'Start at P1: it waits for R2, which P2 holds.', 'P1 → R2 → P2 → R1 → P1 is the cycle; P0 waits on it but is not in it.'],
        solution: 'P1, R2, P2, R1', wrong: ['P0, R1, P1, R0', 'none', 'P1, P2'],
      };
    },
  });
})(globalThis.Proses = globalThis.Proses || {});
