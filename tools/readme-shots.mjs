// The screenshots in the README: node tools/readme-shots.mjs [name ...] [--built] [--base=url] [--list]
// Drives the page in headless Chrome and writes docs/images/<name>.png: 1440×900 in the light theme, one shot in
// the dark theme and one on a phone at 390×844. Each topic or lab stops on a step part of the way through, where the
// picture has something to say. With names, only those shots are taken again; --list prints the names.
// By default it uses dev.html (every source file on its own, no build needed); --built builds index.html first and
// shoots that, as the site serves it; --base= points it at a page served elsewhere (such as a running
// node tools/devpage.mjs). Prints console errors per shot.
import { launch } from './cdp.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = process.argv.includes('--built');
if (built) execSync('node build.mjs', { cwd: root, stdio: 'ignore' });
mkdirSync(join(root, 'docs/images'), { recursive: true });
const out = (n) => join(root, 'docs/images', n + '.png');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = (process.argv.find((a) => a.startsWith('--base=')) || '').slice(7);
const W = [1440, 900], PHONE = [390, 844];

const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
// wait for an expression to come true inside the page
const until = (expr, ms = 30000) => `await new Promise((r, j) => { const t0 = Date.now(); const w = () => { let ok = false; try { ok = (${expr}); } catch (e) { /* not yet */ } if (ok) r(); else if (Date.now() - t0 > ${ms}) j(new Error('timed out: ' + ${JSON.stringify(expr)})); else setTimeout(w, 40); }; w(); });`;
// the box that scrolls the page, whichever it is
const SC = `[document.getElementById('main'), document.scrollingElement].find((x) => x && x.scrollHeight > x.clientHeight + 2)`;
// scroll the page so an element sits just under the top bar
const scrollTo = (sel, pad = 12) => `{ const e = document.querySelector(${JSON.stringify(sel)}); if (e) { const bar = document.getElementById('top'); const off = (bar ? bar.getBoundingClientRect().bottom : 56) + ${pad}; const sc = ${SC}; if (sc) sc.scrollTop += e.getBoundingClientRect().top - off; } }`;
const P = 'Proses.app.page';
// open a topic, pick a preset (its index among the chips, or none), and stop on a step part of the way through
// (frac, or a function of the frames that picks the index)
const pickStep = (frac) => (typeof frac === 'function' ? `(${frac})(fr)` : `Math.round(${frac} * (fr.length - 1))`);
const topic = (id, frac, preset, extra) => ({
  hash: 'topic=' + id,
  js: until(`${P} && ${P}.player && ${P}.player.frames.length > 1`, 60000)
    + (preset != null ? `${P}.player.pause(); { const old = ${P}.player.frames; document.querySelectorAll('.presets .chip')[${preset}].click(); ${until(`${P}.player.frames !== old && ${P}.player.frames.length > 1`, 60000)} }` : '')
    + ` const p = ${P}.player; p.pause(); const fr = p.frames; p.go(${pickStep(frac)}, true); ${wait(400)} ${scrollTo('.stage-card', 4)} ${extra || ''}`,
});
// open a lab, pick one of its ready-made setups (its index among the chips), stop on a step, and open a tab below
const lab = (id, preset, frac, tab, extra, before, after) => ({
  hash: 'labs/' + id,
  js: until(`${P} && ${P}.lab && ${P}.lab.frames && ${P}.lab.frames.length > 0 && document.querySelector('#labView svg .it')`, 60000)
    + `const L = ${P}.lab; L.pause(); ${before || ''}`
    + (preset != null ? `{ const old = L.res; document.querySelectorAll('.lab-presets .chip')[${preset}].click(); ${until(`L.res !== old && L.frames.length > 0`, 120000)} L.pause(); }` : '')
    + (after || '')
    + ` const fr = L.frames; L.go(${pickStep(frac)}, true); if (L.stage.finish) L.stage.finish(); ${tab ? `L.showTab(${JSON.stringify(tab)});` : ''} ${wait(500)} ${extra || ''}`,
  wait: 400,
});

// name: { hash, js (after the route), size, wait ms, theme }
const SHOTS = {
  // the home page with its live picture
  home: { hash: '', js: until(`document.querySelector('#heroArt svg')`) + wait(2500), wait: 100 },

  // the labs
  process: lab('process', 0, 0.62, 'auto'),
  // the reference shell running a pipeline: every child, its process group and the pipes between them
  shell: lab('shell', null, (fr) => { let b = 0; fr.forEach((f, i) => { if ((f.items || []).length > (fr[b].items || []).length) b = i; }); return b; }, 'term',
    null, `const v = Object.assign({}, L.values, { session: 'pipes', src: Proses.ShellLab.REFERENCE, show: 'jobs' }); L.values = v; L.setup.set(v); await L.runNow(false); L.pause();`),
  scheduler: lab('scheduler', 0, 1, 'metrics'),
  sync: lab('sync', 3, 1),
  banker: lab('deadlock', 4, 0.5, 'tables'),
  pagewalk: lab('memory', 0, (fr) => Math.min(6, fr.length - 1)),
  // the clock with its hand and use bits, against LRU on the same references
  clock: lab('vm', 1, 0.55, null, null, null, `{ const v = Object.assign({}, L.values, { pol2: 'lru' }); L.values = v; L.setup.set(v); await L.runNow(false); L.pause(); }`),
  fs: lab('fs', 9, (fr) => fr.length - 2),
  raid: lab('storage', 9, 0.6),
  vmm: lab('vmm', null, 0.5),

  // topics
  philosophers: topic('classic-phil-deadlock', 1),
  cfs: topic('sch-cfs', 0.2),

  // lessons, exercises and challenges
  lesson: { hash: 'lesson=cpu-sjf', js: until(`document.querySelector('#lessonView .stage-card svg')`) + wait(800), wait: 300 },
  // a Gantt exercise answered: the chart painted, the metrics typed with one slip, and the page's verdict
  exercise: {
    hash: 'exercise=cpu-x-srtn',
    js: until(`document.querySelector('#exerciseView .ex-ticks button')`) + wait(300)
      + `{ const sol = Proses.Content.exercises.get('cpu-x-srtn').solution; const cells = document.querySelectorAll('#exerciseView .ex-ticks button');
          sol.ticks.forEach((v, k) => { document.querySelector('#exerciseView .ex-penbtn[data-v="' + v + '"]').click(); cells[k].click(); });
          const vals = ['16', '9', '7', '1', '5', '0', '11', '3'];
          const ins = [...document.querySelectorAll('#exerciseView table input')].slice(-8);
          ins.forEach((el, i) => { el.value = vals[i]; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
          document.getElementById('btnCheck').click(); }` + wait(600) + scrollTo('.ex-gantt', 60),
    wait: 300,
  },
  challenge: { hash: 'challenge/cpu-ch-desk', js: until(`document.querySelector('#challengeView select')`) + wait(300)
    + `{ const sel = document.querySelector('#challengeView select'); sel.value = 'mlfq'; sel.dispatchEvent(new Event('change', { bubbles: true })); }` + wait(900), wait: 300 },
  challenges: { hash: 'challenges', js: until(`document.querySelector('#challengesView')`) + wait(400), wait: 200 },
  learn: { hash: 'learn', js: until(`document.querySelector('#learnView')`) + wait(400), wait: 200 },

  // the feedback queue gamed and fixed, in the dark theme
  dark: Object.assign(lab('scheduler', 4, 0.6), { theme: 'dark' }),
  phone: Object.assign(lab('process', 0, 0.62), { size: PHONE }),
};

if (process.argv.includes('--list')) { console.log(Object.keys(SHOTS).join('\n')); process.exit(0); }
for (const n of only) if (!SHOTS[n]) { console.log('no shot called ' + n + ' (--list)'); process.exit(1); }
for (const [name, s] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const [w, hgt] = s.size || W;
  const b = await launch({ width: w, height: hgt, mobile: w < 600 });
  try {
    const url = (base || b.url) + (built ? '' : 'dev.html');
    await b.send('Page.navigate', { url: url + '#' });
    await b.waitFor('window.__prosesReady === true', 30000);
    await b.eval(`try { localStorage.clear(); } catch (e) {} Proses.app.settings.theme = ${JSON.stringify(s.theme || 'light')}; Proses.app.settings.animate = false; if (Proses.Learner) Proses.Learner.settings.predict = false; Proses.app.applyTheme(); 1`);
    await b.eval(`(async () => { ${s.hash ? `window.__prosesReady = false; location.hash = ${JSON.stringify(s.hash)}; ${until('window.__prosesReady === true')}` : 'Proses.app.route();'} ${s.js || ''} })().then(() => 1)`, s.timeout);
    await b.sleep(s.wait || 300);
    await b.screenshot(out(name));
    const errs = b.logs.filter((l) => l.type === 'exception' || l.type === 'error');
    console.log(name + (errs.length ? '  console: ' + errs.map((e) => e.text.slice(0, 200)).join(' | ') : ''));
  } catch (e) {
    console.log(name + ' FAILED: ' + e.message.slice(0, 300));
  } finally { await b.close(); }
}
