// Build: inline the CSS and all the JavaScript (in manifest order) into one self-contained index.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFiles } from './tools/devpage.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(root, 'src', p), 'utf8');
let version = '0.1.0';
try { version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version; } catch (e) { /* none yet */ }
const { js: files, css: cssFiles } = sourceFiles();
const js = files.map((f) => `// ==== ${f} ====\n${src(f)}`).join('\n').replace(/<\/script/gi, '<\\/script');
const css = cssFiles.map((f) => src(f)).join('\n');
let html = src('shell.html');
html = html.replace('/*@@CSS@@*/', () => css);
html = html.replace('//@@JS@@', () => js);
html = html.replace(/@@VERSION@@/g, version);
writeFileSync(join(root, 'index.html'), html);
console.log(`index.html: ${(html.length / 1024).toFixed(1)} KB from ${files.length} scripts and ${cssFiles.length} stylesheets`);
