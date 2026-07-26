// Finds FIFO anomalies (n frames against n + 1) by exhaustive search over strings up to renaming of pages, leaving
// out every string that is a renaming of the well-known 12-reference example or holds one among its references (in
// order, not necessarily next to each other).
// Prints a table for src/core/mem-d-replace.js: node tests/ref/belady-table.mjs [length] [pages] [frames] [max]
const [len, pages, n, max] = process.argv.slice(2).map(Number);
const L = len || 13, P = pages || 5, N = n || 3, MAX = max || 400;

/** a string's shape: each page replaced by the order of its first use */
export const shape = (r) => { const m = new Map(); return r.map((p) => { if (!m.has(p)) m.set(p, m.size); return m.get(p); }).join(','); };
const FAMOUS = shape([1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]);
/** whether some 12 of r's references, in order (not necessarily next to each other), are a renaming of it */
export const holdsFamous = (r) => {
  const f = FAMOUS.split(',').map(Number);
  const go = (i, j, map, used) => {
    if (j === 12) return true;
    if (r.length - i < 12 - j) return false;
    for (let k = i; k <= r.length - (12 - j); k++) {
      const want = map[f[j]];
      if (want === undefined ? used.has(r[k]) : want !== r[k]) continue;
      const m2 = map.slice(), u2 = new Set(used);
      if (want === undefined) { m2[f[j]] = r[k]; u2.add(r[k]); }
      if (go(k + 1, j + 1, m2, u2)) return true;
    }
    return false;
  };
  return go(0, 0, [], new Set());
};

function fifo(r, k) { const q = []; let f = 0; for (const p of r) if (!q.includes(p)) { f++; q.push(p); if (q.length > k) q.shift(); } return f; }

if (process.argv[1] && process.argv[1].endsWith('belady-table.mjs')) {
  const out = [], refs = [];
  let leaves = 0;
  const t0 = Date.now();
  // queues as arrays copied per level; the excess (faults with N + 1 minus with N) grows by at most one a reference
  const dfs = (d, used, qa, fa, qb, fb) => {
    if (out.length >= MAX) return;
    if (fb - fa + (L - d) <= 0) return;
    if (d === L) { leaves++; if (!holdsFamous(refs)) out.push(refs.slice()); return; }
    for (let p = 0; p <= Math.min(used, P - 1); p++) {
      refs[d] = p;
      let na = qa, ga = fa, nb = qb, gb = fb;
      if (!qa.includes(p)) { ga++; na = qa.length < N ? qa.concat(p) : qa.slice(1).concat(p); }
      if (!qb.includes(p)) { gb++; nb = qb.length < N + 1 ? qb.concat(p) : qb.slice(1).concat(p); }
      dfs(d + 1, Math.max(used, p + 1), na, ga, nb, gb);
    }
  };
  dfs(0, 0, [], 0, [], 0);
  for (const r of out) if (!(fifo(r, N + 1) > fifo(r, N))) throw new Error('not an anomaly: ' + r);
  console.error(out.length + ' anomalies of length ' + L + ' over ' + P + ' pages, ' + N + ' against ' + (N + 1) + ' frames (' + leaves + ' leaves, ' + (Date.now() - t0) + ' ms)');
  console.log(JSON.stringify(out.map((r) => r.join(''))));
}
