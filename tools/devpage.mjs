// The page served as /dev.html while working: the same shell as index.html, but every source file is its
// own <script>, read fresh from src/, so a mistake in one file does not take the others down and a change
// needs no build. Also the one place that expands the manifest for the build.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, 'src', p), 'utf8');
// "dir/*.js" and "dir/x-*.js" pull in the matching files of a folder in name order; missing files are skipped
export function expand(list) {
  return (list || []).flatMap((f) => {
    if (f.includes('*')) {
      const d = f.slice(0, f.lastIndexOf('/'));
      const re = new RegExp('^' + f.slice(f.lastIndexOf('/') + 1).replace(/\./g, '\\.').replace('*', '.*') + '$');
      return existsSync(join(root, 'src', d)) ? readdirSync(join(root, 'src', d)).filter((x) => re.test(x) && !list.includes(d + '/' + x)).sort().map((x) => d + '/' + x) : [];
    }
    return existsSync(join(root, 'src', f)) ? [f] : [];
  });
}
export function sourceFiles() {
  const m = JSON.parse(src('manifest.json'));
  return { js: [...new Set(['core', 'stage', 'demo', 'topics', 'app', 'content'].flatMap((k) => expand(m[k])))], css: [...new Set(expand(m.css))] };
}
export function devPage() {
  const { js, css } = sourceFiles();
  let html = src('shell.html');
  html = html.replace('/*@@CSS@@*/', () => css.map((f) => src(f)).join('\n'));
  html = html.replace(/@@VERSION@@/g, 'dev');
  html = html.replace('//@@JS@@', () => '</script>\n' + js.map((f) => `<script src="src/${f}"></script>`).join('\n') + '\n<script>');
  return html;
}

// node tools/devpage.mjs [port]: serve /dev.html (and the source files) at http://127.0.0.1:port/dev.html
if (process.argv[1] && process.argv[1].endsWith('devpage.mjs')) {
  const { createServer } = await import('node:http');
  const { extname } = await import('node:path');
  const port = +(process.argv[2] || 8080);
  createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '/dev.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(devPage()); return; }
    const f = join(root, p);
    if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  }).listen(port, '127.0.0.1', () => console.log('Proses, from source: http://127.0.0.1:' + port + '/dev.html'));
}
