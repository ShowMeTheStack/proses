// The framework itself: the manifest loads in node, the stage measures items without a browser, and every demo
// scene builds well-formed frames at both widths (keys unique, edges joining drawn items, every frame narrated with
// no undefined value). The placeholder scene's trace is checked against the legal transitions, listed here on
// their own.
import { load, harness } from './load.mjs';

const t = harness('frame');
const S = load(['core', 'stage', 'demo']);
t.ok(S && S.Demo && Array.isArray(S.Demo.scenes), 'the demo registry loads');
t.ok(S.Demo.scenes.length >= 1, 'at least one demo scene');
t.ok(typeof S.stageBounds === 'function', 'the stage measures items in node');
t.eq(S.parts.length, 18, 'eighteen parts');
t.eq(new Set(S.parts.map((p) => p.id)).size, 18, 'part ids are distinct');

for (const sc of S.Demo.scenes) {
  t.ok(sc.id && sc.title && sc.tag && typeof sc.frames === 'function', sc.id + ': id, title, tag and frames');
  for (const narrow of [false, true]) {
    const fr = sc.frames({ narrow, knobs: {} });
    const at = sc.id + (narrow ? ' (narrow)' : '');
    t.ok(fr.length >= 2, at + ': at least two frames');
    fr.forEach((f, i) => {
      const keys = new Set();
      for (const it of f.items) { t.ok(!keys.has(it.key), at + ' frame ' + i + ': key ' + it.key + ' is unique'); keys.add(it.key); }
      for (const it of f.items) if (it.kind === 'edge') for (const end of [it.from, it.to]) if (typeof end === 'string') t.ok(keys.has(end), at + ' frame ' + i + ': edge end ' + end + ' is drawn');
      t.ok(f.say && !/undefined|NaN|\[object/.test(f.say), at + ' frame ' + i + ': narrated');
      t.ok(!!S.stageBounds(f.items), at + ' frame ' + i + ': has bounds');
    });
  }
}

// the life of a process: every move is a legal one, time never goes back, and it ends reaped
const LEGAL = new Set(['new>ready', 'ready>running', 'running>ready', 'running>blocked', 'blocked>ready', 'running>zombie']);
const life = S.Demo.byId('process-life');
if (life) {
  const tr = life.trace();
  t.eq(tr[0].state, 'new', 'it starts new');
  for (let i = 1; i < tr.length; i++) {
    t.ok(tr[i].t > tr[i - 1].t, 'time moves on at step ' + i);
    if (tr[i].kind === 'transition') t.ok(LEGAL.has(tr[i].from + '>' + tr[i].state), 'legal move ' + tr[i].from + ' to ' + tr[i].state);
    t.ok(tr[i].say.includes(String(tr[i].t)), 'step ' + i + ' names its time');
  }
  t.eq(tr[tr.length - 1].kind, 'reap', 'it ends reaped');
  t.eq(JSON.stringify(life.trace()), JSON.stringify(tr), 'the same trace twice');
}
t.done();
