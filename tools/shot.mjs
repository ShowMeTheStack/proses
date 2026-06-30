// A screenshot of any page of Proses, for review: node tools/shot.mjs <hash> <out.png> [width] [height] [light|dark] [js run first]
// Uses /dev.html, so nothing needs building first. Prints page errors, if any.
import { launch } from './cdp.mjs';
const [hash, out, w, h, theme, js] = process.argv.slice(2);
if (!out) { console.log('usage: node tools/shot.mjs <hash> <out.png> [width] [height] [light|dark] [js]'); process.exit(1); }
const b = await launch({ width: +(w || 1440), height: +(h || 900), mobile: +(w || 1440) < 600 });
try {
  await b.send('Page.navigate', { url: b.url + 'dev.html#' + (hash || '') });
  try { await b.waitFor('window.__prosesReady === true', 20000); } catch (e) { console.log(b.logs.map((l) => l.text).join('\n')); throw e; }
  await b.eval(`Proses.app.setTheme(${JSON.stringify(theme || 'light')}); 1`);
  if (js) await b.eval('(async () => { ' + js + ' })().then(() => 1)');
  await b.sleep(900);
  await b.screenshot(out);
  const errs = b.logs.filter((l) => l.type === 'exception' || l.type === 'error');
  if (errs.length) console.log('page errors: ' + errs.map((e) => e.text).join('\n'));
  else console.log(out);
} finally { await b.close(); }
