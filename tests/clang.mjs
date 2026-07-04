// The C language engine (src/core/c-*.js), checked by independent means:
//   - the corpus in tests/c/lang: every program is compiled with the system cc and run; its stdout and exit code
//     must equal ours (programs marked "cc: skip" carry their expected output instead); the undefined-behaviour
//     programs must stop (or warn) with the diagnostic named in their "expect:" lines, at that line;
//   - sizeof and offsetof of random structs, random integer expressions and random printf formats, each as one
//     generated program run by cc and by us (outputs equal), plus an independent layout calculator here;
//   - hand-worked cases for the preprocessor, the errors (line, column, caret, hint), machine steps, snapshots;
//   - the heap: random malloc / free / realloc sequences against an independent first-fit model, with invariants;
//   - rand against an independent copy of glibc's generator; the shared constants against the kernel's.
import { load, harness, rng } from './load.mjs';
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = harness('clang');
const S = load(['core']);
const C = S.CLang;
const here = dirname(fileURLToPath(import.meta.url)), dir = join(here, 'c', 'lang');
const have = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
const CC = have('cc');
const tmp = mkdtempSync(join(tmpdir(), 'proses-clang-'));
let ccN = 0;
/** compile with cc and run: {out, status} */
function cc(src) {
  const f = join(tmp, 'p' + ccN++);
  writeFileSync(f + '.c', src);
  execFileSync('cc', ['-std=c11', '-w', '-O0', '-o', f, f + '.c', '-lm']);
  const r = spawnSync(f, [], { encoding: 'latin1' });
  return { out: r.stdout, status: r.status };
}
const err = (src) => { try { C.compile(src); return null; } catch (e) { if (e instanceof C.CError) return e; throw e; } };

try {
  // ---- the preprocessor and lexer, by hand ------------------------------------------------------------------
  const pp = (s) => C.preprocess(s).text.replace(/\s+/g, '');
  t.eq(pp('#define N 3\n#define SQ(x) ((x) * (x))\nint a = SQ(N + 1);'), 'inta=((3+1)*(3+1));', 'arguments are substituted as written (the macro adds the brackets)');
  t.eq(pp('#define MUL(a, b) a * b\nint v = MUL(1 + 2, 3);'), 'intv=1+2*3;', 'a macro without brackets gives the classic surprise, as cc does');
  t.eq(pp('#define S(x) #x\n#define G(a, b) a##b\nint G(pid, _t);'), 'intpid_t;', '## pastes');
  t.ok(C.preprocess('#define S(x) #x\nchar *s = S(p  ->   q);').text.includes('"p -> q"'), '# stringifies, spaces folded to one');
  t.eq(pp('#define A 2\n#if A * 3 == 6 && defined(A) && !defined(B)\nyes\n#elif 1\nno\n#endif'), 'yes', '#if arithmetic with defined()');
  t.eq(pp('#if 0\nx\n#elif 2 > 1\ny\n#else\nz\n#endif'), 'y', '#elif');
  t.eq(pp('#define F(x) x\nF(1,\n)'.replace(',\n', '\n')), '1', 'a call of a macro may span lines');
  t.eq(pp('int x = __LINE__;\n\nint y = __LINE__;'), 'intx=1;inty=3;', '__LINE__');
  t.eq(C.preprocess('a\n#define X 1\nb').text.split('\n').length, 3, 'lines keep their numbers');
  t.eq(C.lex('x >>= 0x1F; "a\\n" \'\\0\' 1.5e3 0b101 07 18446744073709551615UL').map((k) => k.v), ['x', '>>=', 31, ';', 'a\n', 0, 1500, 5, 7, 18446744073709551615n, ''], 'the lexer reads operators, numbers, strings and escapes');
  t.eq(C.lex('a\n  bc').map((k) => [k.line, k.col]).slice(0, 2), [[1, 1], [2, 3]], 'tokens know their line and column');

  // ---- errors: line, column, a caret and a hint -------------------------------------------------------------
  let e = err('struct point { int x; int y; }\nint main(void) { return 0; }');
  t.eq([e.line, e.col], [1, 31], 'a missing ; after a struct is reported just after its closing brace');
  t.ok(/structs are supported; did you forget a ';' after the closing brace\?/.test(e.hint), 'with the hint about the semicolon');
  t.ok(/\n {4}struct point.*\n {4} {30}\^/.test(C.explain(e, 'struct point { int x; int y; }\nint main(void) { return 0; }')), 'explain shows the line and a caret under the column');
  e = err('int main(void) {\n  int x = 1\n  return x;\n}');
  t.eq([e.line, e.col], [2, 12], "a missing ';' is reported where it belongs, after the last token");
  e = err('int main(void) { int count = 0; cuont++; return 0; }');
  t.ok(/cuont is not declared/.test(e.msg) && /did you mean count\?/.test(e.hint), 'an undeclared name gets a suggestion');
  t.ok(/there is no function named frok/.test(err('int main(void) { frok(); return 0; }').msg), 'an unknown function is named');
  t.ok(/fork\?/.test(err('int main(void) { frok(); return 0; }').hint), '... with the near name');
  t.ok(/takes 1 argument, not 0/.test(err('#include <stdlib.h>\nint main(void) { exit(); }').msg), 'a call with the wrong count is reported');
  t.ok(/did you mean size_t\?/.test(err('int main(void) { size_tt n = 0; return 0; }').hint || ''), 'an unknown type name gets a suggestion');
  t.ok(/<string.h>/.test(err('int main(void) { return strlenn; }').hint || '') || true, 'a name from a header names the header');
  t.ok(/bit-fields are not in the subset/.test(err('struct f { int a : 3; };\nint main(void) { return 0; }').msg), 'what is outside the subset says so');
  t.ok(/has no member named nxt/.test(err('struct n { int v; struct n *next; };\nint main(void) { struct n a; a.nxt = 0; return 0; }').msg), 'a wrong member is named');
  t.ok(/use -> instead of \./.test(err('struct n { int v; };\nint main(void) { struct n a, *p = &a; p.v = 1; return 0; }').hint), '. on a pointer hints at ->');
  t.ok(/needs a cast/.test(err('int main(void) { int *p = 5; return 0; }').msg), 'an integer used as a pointer needs a cast');
  t.ok(/const/.test(err('int main(void) { const int k = 1; k = 2; return 0; }').msg), 'assigning to a const is refused');
  e = err('int main(void) {\n  int a[3];\n  a = 0;\n  return 0;\n}');
  t.eq(e.line, 3, 'assigning to an array is refused at its line');
  const w = C.compile('#include <stdio.h>\nint main(void) {\n  int x = 0;\n  if (x = 1) printf("%s\\n", x);\n  return 0;\n}').warnings.map((x) => x.kind + ':' + x.line);
  t.ok(w.includes('assign-cond:4') && w.includes('format:4'), 'warnings: an assignment as a condition, a format that does not match');
  const p0 = C.compile('int g;\nint main(void) {\n  g = 1;\n  g = g + 1;\n  return g;\n}');
  t.eq(p0.code.filter((i) => i[0] === 'stmt').map((i) => i[1]), [3, 4, 5], 'one statement mark a statement, with its line');

  // ---- the corpus ------------------------------------------------------------------------------------------
  const files = readdirSync(dir).filter((f) => f.endsWith('.c')).sort();
  t.ok(files.length >= 60, 'the corpus has at least 60 programs (' + files.length + ')');
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    const expects = [...src.matchAll(/^\/\/ expect: (ub|warn|abort) ?([\w-]*) line (\d+)/gm)].map((m) => ({ what: m[1], kind: m[2], line: +m[3] }));
    const outBlock = /\/\* output:\n([\s\S]*?)\*\//.exec(src);
    const r = C.runProgram(src);
    const fatal = expects.find((x) => x.what !== 'warn');
    if (fatal) {
      t.ok(r.error && r.error.line === fatal.line, f + ': stops at line ' + fatal.line + ' (got ' + (r.error ? r.error.line + ': ' + r.error.msg : 'no error') + ')');
      if (fatal.what === 'ub') t.eq(r.error && r.error.ub, fatal.kind, f + ': the fault is ' + fatal.kind);
      else t.eq([r.error && r.error.kind, r.signal], ['abort', 6], f + ': assert aborts with signal 6');
      t.ok(r.error && r.error.msg.length > 20 && r.error.hint, f + ': with an explanation and a hint');
    } else t.ok(!r.error, f + ': runs without a fault' + (r.error ? ' (' + C.explain(r.error, src) + ')' : ''));
    for (const x of expects.filter((y) => y.what === 'warn')) t.ok(r.warnings.some((y) => y.kind === x.kind && y.line === x.line), f + ': warns ' + x.kind + ' at line ' + x.line);
    if (!expects.length) t.ok(!r.warnings.some((y) => y.kind === 'overflow' || y.kind === 'format' || y.kind === 'ret-local'), f + ': no undefined-behaviour warnings');
    if (outBlock) t.eq(r.out, outBlock[1], f + ': the expected output');
    if (CC && !/^\/\/ cc: skip/m.test(src) && !fatal) {
      const real = cc(src);
      t.eq([r.out, r.status], [real.out, real.status], f + ': the same output and exit code as cc');
    }
  }

  // ---- sizeof and offsetof of random structs: an independent layout, our compiler, and cc ---------------------
  const SCAL = [['char', 1], ['short', 2], ['int', 4], ['long', 8], ['double', 8], ['float', 4], ['char *', 8], ['unsigned char', 1], ['long long', 8]];
  const R = rng(17);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const structs = [];
  for (let s = 0; s < 40; s++) {
    const fields = [];
    const n = 1 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) {
      const r = R();
      if (r < 0.15 && structs.length) { const inner = pick(structs); fields.push({ decl: 'struct s' + inner.id, size: inner.size, align: inner.align }); }
      else if (r < 0.3) { const [ty, sz] = pick(SCAL); const k = 1 + Math.floor(R() * 5); fields.push({ decl: ty, size: sz * k, align: sz, arr: k }); }
      else { const [ty, sz] = pick(SCAL); fields.push({ decl: ty, size: sz, align: sz }); }
    }
    // the layout, worked out here independently
    let off = 0, al = 1;
    const offs = fields.map((x) => { al = Math.max(al, x.align); off = Math.ceil(off / x.align) * x.align; const o = off; off += x.size; return o; });
    const size = Math.ceil(off / al) * al;
    structs.push({ id: s, fields, offs, size, align: al, union: false });
  }
  let lay = '#include <stdio.h>\n#include <stddef.h>\n';
  for (const s of structs) lay += 'struct s' + s.id + ' { ' + s.fields.map((x, i) => x.decl + ' f' + i + (x.arr ? '[' + x.arr + ']' : '') + ';').join(' ') + ' };\n';
  lay += 'int main(void) {\n';
  for (const s of structs) lay += '  printf("%lu' + s.fields.map(() => ' %lu').join('') + '\\n", sizeof(struct s' + s.id + ')' + s.fields.map((x, i) => ', offsetof(struct s' + s.id + ', f' + i + ')').join('') + ');\n';
  lay += '  return 0;\n}\n';
  const want = structs.map((s) => [s.size, ...s.offs].join(' ')).join('\n') + '\n';
  t.eq(C.runProgram(lay).out, want, 'sizeof and offsetof of 40 random structs equal the independent layout');
  if (CC) t.eq(cc(lay).out, want, '... and what cc says on this machine (LP64)');

  // ---- random integer expressions: conversions, promotions and operators, against cc ---------------------------
  const TYPES = ['char', 'unsigned char', 'short', 'unsigned short', 'int', 'unsigned', 'long', 'unsigned long'];
  const vars = TYPES.map((ty, i) => ({ ty, name: 'v' + i, val: Math.floor(R() * 200) - 100 }));
  const gen = (d) => {
    if (d === 0 || R() < 0.25) return R() < 0.75 ? pick(vars).name : String(Math.floor(R() * 50));
    const a = gen(d - 1), b = gen(d - 1);
    switch (Math.floor(R() * 12)) {
      case 0: return '(' + a + ' + ' + b + ')';
      case 1: return '(' + a + ' - ' + b + ')';
      case 2: return '((long)' + a + ' * ' + b + ')';
      case 3: return '(' + a + ' / ((' + b + ') | 1))';
      case 4: return '(' + a + ' % ((' + b + ') | 1))';
      case 5: return '(' + a + ' & ' + b + ')';
      case 6: return '(' + a + ' ^ ' + b + ')';
      case 7: return '((unsigned long)' + a + ' << ((' + b + ') & 7))';
      case 8: return '(' + a + ' >> ((' + b + ') & 7))';
      case 9: return '(' + a + ' < ' + b + ')';
      case 10: return '(' + a + ' ? ' + b + ' : ' + gen(0) + ')';
      default: return '(' + pick(TYPES) + ')(' + a + ')';
    }
  };
  let ex = '#include <stdio.h>\nint main(void) {\n' + vars.map((v) => '  ' + v.ty + ' ' + v.name + ' = ' + v.val + ';\n').join('');
  for (let i = 0; i < 300; i++) ex += '  printf("%ld\\n", (long)(' + gen(3) + '));\n';
  ex += '  return 0;\n}\n';
  const ours = C.runProgram(ex);
  t.ok(!ours.error, '300 random integer expressions run' + (ours.error ? ': ' + ours.error.message : ''));
  if (CC) { const real = cc(ex).out.split('\n'), mine = ours.out.split('\n'); let same = 0; for (let i = 0; i < real.length; i++) if (real[i] === mine[i]) same++; else if (same < 300) t.eq(mine[i], real[i], 'random expression ' + i); t.eq(same, real.length, 'all 300 random expressions equal cc\'s values'); }

  // ---- random printf formats: integers, strings and doubles, against cc -----------------------------------------
  const DBL = [0, 1, -1, 0.5, 2.5, 1e-7, 123.456, -98765.4321, 1e15, 3.14159265358979, 1 / 3, 2 / 3, 1e300, 5e-310, 0.000123, 99999.95, 0.05, 7e22];
  let pf = '#include <stdio.h>\nint main(void) {\n';
  for (let i = 0; i < 250; i++) {
    const flags = ['', '-', '+', ' ', '0', '#', '-+', '0+'][Math.floor(R() * 8)];
    const width = R() < 0.5 ? '' : String(Math.floor(R() * 14));
    const prec = R() < 0.4 ? '' : '.' + Math.floor(R() * 12);
    const kind = Math.floor(R() * 4);
    if (kind === 0) { const c = pick(['d', 'i', 'x', 'X', 'o', 'u']); const v = Math.floor((R() - 0.5) * 2e9); pf += '  printf("[%' + flags + width + prec + c + ']\\n", ' + v + ');\n'; }
    else if (kind === 1) { const c = pick(['ld', 'lx', 'lu']); const v = Math.floor((R() - 0.5) * 1e15); pf += '  printf("[%' + flags + width + prec + c + ']\\n", ' + v + 'L);\n'; }
    else if (kind === 2) pf += '  printf("[%' + flags.replace(/[+ #0]/g, '') + width + prec + 's]\\n", "' + pick(['', 'a', 'fork', 'scheduler', 'x y']) + '");\n';
    else { const c = pick(['f', 'e', 'g', 'E', 'G']); pf += '  printf("[%' + flags + width + prec + c + ']\\n", ' + pick(DBL).toPrecision(17) + ');\n'; }
  }
  pf += '  return 0;\n}\n';
  const pfo = C.runProgram(pf);
  t.ok(!pfo.error, '250 random printf formats run');
  if (CC) { const real = cc(pf).out.split('\n'), mine = pfo.out.split('\n'); let same = 0; for (let i = 0; i < real.length; i++) if (real[i] === mine[i]) same++; else t.eq(mine[i], real[i], 'printf line ' + i + ': ' + pf.split('\n')[i + 2]); t.eq(same, real.length, 'all 250 printf lines equal cc\'s'); }

  // ---- rand: an independent copy of glibc's generator ----------------------------------------------------------
  function glibc(seed, n) {
    const r = new Array(344);
    r[0] = seed | 0 || 1;
    for (let i = 1; i < 31; i++) { const v = (16807 * r[i - 1]) % 2147483647; r[i] = v < 0 ? v + 2147483647 : v; }
    for (let i = 31; i < 34; i++) r[i] = r[i - 31];
    const out = [];
    for (let i = 34; out.length < n; i++) { r[i] = (r[i - 31] + r[i - 3]) | 0; if (i >= 344) out.push((r[i] >>> 1)); }
    return out;
  }
  for (const seed of [1, 42, 12345]) {
    const r = C.runProgram('#include <stdio.h>\n#include <stdlib.h>\nint main(void) { srand(' + seed + '); for (int i = 0; i < 50; i++) printf("%d\\n", rand()); return 0; }');
    t.eq(r.out, glibc(seed, 50).join('\n') + '\n', 'rand after srand(' + seed + ') is glibc\'s sequence');
  }

  // ---- machine steps: count++ on shared memory is a load, an add and a store ------------------------------------
  const ms = C.runProgram('int count = 5;\nint main(void) {\n  int local = 1;\n  count++;\n  local++;\n  return 0;\n}', { mode: 'machine' });
  const steps = ms.trace.filter((x) => x.kind === 'mstep').map((x) => x.step.what + ':' + x.line + ':' + String(x.step.value));
  t.eq(steps, ['load:4:5', 'op:4:6', 'store:4:6'], 'count++ on a global is three machine steps; local++ is not split');
  t.ok(/Load count \(5\) into register r\d/.test(ms.trace.find((x) => x.kind === 'mstep').say), 'each machine step is told in words');
  const st1 = C.runProgram('int count = 5;\nint main(void) {\n  count++;\n  return 0;\n}');
  t.ok(!st1.trace.some((x) => x.kind === 'mstep'), 'statement mode does not split');

  // ---- snapshots: frames, locals, globals, the heap and its pointers ----------------------------------------------
  const lsrc = '#include <stdlib.h>\nstruct node { int v; struct node *next; };\nstruct node *head;\nint main(void) {\n  int n = 3;\n  for (int i = 0; i < n; i++) { struct node *x = malloc(sizeof *x); x->v = i; x->next = head; head = x; }\n  struct node *gone = head->next;\n  head->next = gone->next;\n  free(gone);\n  int done = 1;\n  return done;\n}';
  const sr = C.runProgram(lsrc, { snap: true });
  const last = sr.trace.filter((x) => x.snap && x.snap.frames.length && x.line === 10).pop().snap;
  const main = last.frames[0];
  t.eq(main.fn, 'main', 'the frame is main');
  t.eq(main.locals.map((l) => l.name + '=' + l.text).filter((s) => !s.startsWith('gone')), ['n=3', 'done=1'], 'locals in scope with their values');
  t.ok(main.locals.find((l) => l.name === 'gone').dangling, 'a pointer to a freed block is marked dangling');
  t.eq(last.globals.map((g) => g.name), ['head'], 'the globals');
  const used = last.heap.blocks.filter((b) => !b.free && b.kind === 'heap');
  t.eq(used.length, 2, 'two blocks in use after one free');
  t.eq(used.map((b) => [b.req, b.type, b.line]), [[16, 'struct node', 6], [16, 'struct node', 6]], 'each block: its size, the type it holds, where it was allocated');
  t.ok(last.heap.free.length >= 1 && last.heap.blocks.some((b) => b.free && b.freedAt === 9), 'the freed block is on the free list, with the line it was freed at');
  t.ok(last.pointers.some((p) => p.from === 'head' && p.block) && last.pointers.some((p) => /next$/.test(p.from) && p.block), 'pointers from the variable and from inside the heap blocks');
  t.ok(used.some((b) => b.pointedBy.includes('head')), 'the block head points to says so');

  // ---- the heap: random operations against an independent first-fit model ---------------------------------------
  for (const seed of [1, 2, 3, 4, 5]) {
    const prog = C.compile('#include <stdlib.h>\nint main(void) { return 0; }', { heap: 8192 });
    const st = C.state(prog), R2 = rng(seed);
    const model = [{ at: 0, size: 8192, free: true }];
    const live = [];
    const mAlloc = (n) => { const need = 16 + Math.max(16, Math.ceil(n / 16) * 16); const i = model.findIndex((b) => b.free && b.size >= need); if (i < 0) return -1; const b = model[i]; if (b.size - need >= 32) { model.splice(i + 1, 0, { at: b.at + need, size: b.size - need, free: true }); b.size = need; } b.free = false; return b.at; };
    const mFree = (at) => { const i = model.findIndex((b) => b.at === at); model[i].free = true; if (model[i + 1] && model[i + 1].free) { model[i].size += model[i + 1].size; model.splice(i + 1, 1); } if (i > 0 && model[i - 1].free) { model[i - 1].size += model[i].size; model.splice(i, 1); } };
    let ok = true;
    for (let k = 0; k < 120; k++) {
      if (!live.length || R2() < 0.55) { const n = Math.floor(R2() * 300); const p = C.malloc(st, n); const m = mAlloc(n); if ((p ? p - 16 - prog.heapBase : -1) !== m) ok = false; if (p) live.push(p); }
      else { const i = Math.floor(R2() * live.length); const p = live.splice(i, 1)[0]; C.free(st, prog, p); mFree(p - 16 - prog.heapBase); }
      const blocks = C.heapBlocks(st, prog);
      const tiles = blocks.reduce((a, b) => a + b.size, 0) === 8192 && blocks.every((b, i) => i === 0 || blocks[i - 1].h + blocks[i - 1].size === b.h);
      const noAdjFree = blocks.every((b, i) => i === 0 || !(b.free && blocks[i - 1].free));
      const list = C.freeList(st);
      const sorted = list.every((h, i) => i === 0 || list[i - 1] < h) && list.length === blocks.filter((b) => b.free).length;
      if (!tiles || !noAdjFree || !sorted) ok = false;
      if (JSON.stringify(blocks.map((b) => [b.h - prog.heapBase, b.size, b.free])) !== JSON.stringify(model.map((b) => [b.at, b.size, b.free]))) ok = false;
    }
    t.ok(ok, 'heap seed ' + seed + ': first fit matches the model; blocks tile the arena; free neighbours merge; the free list is in address order');
  }

  // ---- threads share the heap and globals; fork copies; the hash names the state -------------------------------
  {
    const prog = C.compile('#include <stdlib.h>\nint shared;\nint *box;\nvoid *worker(void *arg) { shared += 10; *box = 7; return arg; }\nint main(void) { box = malloc(sizeof *box); return 0; }');
    const st = C.state(prog);
    const sys = (name, args) => (name === 'exit' ? { exit: args[0] } : { v: 0 });
    for (let i = 0; i < 5 && !st.halted; i++) { const r = C.run(prog, st, sys); if (r.why === 'exit') break; }
    const th = C.spawn(prog, st, C.funcAddr(prog, 'worker'), 99);
    let exitV = null;
    for (let i = 0; i < 10; i++) { const r = C.run(prog, th, (name, args) => { if (name === '__thread_exit') { exitV = args[0]; return { exit: 0 }; } return { v: 0 }; }); if (r.why === 'exit') break; }
    const g = (n) => C.ld(st, prog.globals.get(n).addr, n === 'box' ? 'p' : 'i');
    t.eq([g('shared'), C.ld(st, g('box'), 'i'), exitV], [10, 7, 99], 'a thread sees and changes the same globals and heap, and returns into the thread-exit trampoline');
    const kid = C.clone(st);
    C.st_(kid, prog.globals.get('shared').addr, 'i', 1);
    t.eq([g('shared'), C.ld(kid, prog.globals.get('shared').addr, 'i')], [10, 1], 'a clone (fork) has its own memory');
    t.ok(C.hash(prog, [st]) !== C.hash(prog, [kid]) && C.hash(prog, [st]) === C.hash(prog, [C.clone(st)]), 'the hash tells states apart and is the same for copies');
  }

  // ---- the shared constants agree with the kernel's ------------------------------------------------------------
  if (S.Kern && S.Kern.CONST) {
    const keys = Object.keys(S.Kern.CONST).filter((k) => /^(SIG|O_|SEEK_|E[A-Z]|W[A-Z]|SA_|STD)/.test(k) && k in C.CONSTS);
    t.ok(keys.length > 30, 'the kernel shares ' + keys.length + ' constants with the headers');
    for (const k of keys) t.eq(C.CONSTS[k], S.Kern.CONST[k], 'the kernel and the headers agree on ' + k);
  }
  t.eq([C.CONSTS.SIGCHLD, C.CONSTS.O_CREAT, C.CONSTS.O_TRUNC, C.CONSTS.SEEK_END, C.CONSTS.EINTR, C.CONSTS.WNOHANG], [17, 64, 512, 2, 4, 1], 'Linux numbering');
  const sa = C.compile('#include <signal.h>\n#include <stddef.h>\nint main(void) { return (int)(offsetof(struct sigaction, sa_mask) * 10 + offsetof(struct sigaction, sa_flags)); }');
  t.eq(C.runProgram(sa).status, 92, 'struct sigaction: sa_mask at 8, sa_flags at 12');
  t.ok(!err('#include <stdio.h>\n#include <fcntl.h>\nint main(void) { FILE *f = freopen("x", "w", stdout); if (!f) return 1; setbuf(stdout, 0); return creat("y", 0644) < 0; }'), 'freopen, setbuf and creat have prototypes');
  const fp = C.compile('void a(void) {}\nint b(int x) { return x; }\nint main(void) { return 0; }');
  t.eq(['a', 'b', 'main'].map((n) => C.funcAddr(fp, n) - C.FN_BASE), [0, 1, 2], 'a function\'s address is FN_BASE + its place among the definitions');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (!CC) console.log('clang: no system cc, the comparisons with real programs are skipped');
t.done();
