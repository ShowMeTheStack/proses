// The simulated kernel, part eleven: the programs exec can run besides C programs. Built-in programs (echo, cat,
// wc, sort, ls, sleep, true, false, yes, head) are written here as small kernel-side state machines that use the
// same descriptor layer as everything else, so they read pipes, block, get SIGPIPE and exit like any process.
// Each step of a built-in does one piece of work; its state (t.bs) is plain data, so fork and the enumerator can
// copy it. Programs a student saved are registered by name and compiled when exec'd.
//   S.Kern.register(name, source)    a C program exec can find by name (or give programs: {name: src} to a System)
//   S.Kern.BUILTIN_PROGS[name](sys, t, bs)   one step of a built-in
//   wc prints lines, words and bytes as "%8d%8d%8d" (and the name); -l, -w, -c choose among them; ls lists the files, one per line
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  const proto = K.System.prototype;
  K.programs = K.programs || {};
  K.register = (name, src) => { K.programs[name] = src; };

  // what a built-in can do: each returns false when the thread must wait (then the step ends, and runs again)
  proto.biWrite = function (t, fd, text) {
    const p = this.proc(t.pid), done = t.bs.wdone || 0, r = this.fdWrite(t, fd, text.slice(done));
    if (r.err) { t.bs.wdone = 0; return r.pipe ? 'dead' : true; }
    if (r.n) this.event(r.dev ? 'print' : 'write', p, { fd, text: text.slice(done, done + r.n), tid: t.tid }, `${this.who(p)} (${t.bs.name}) writes ${K.show(text.slice(done, done + r.n))} to ${this.ofName(this.ofOf(p, fd))}.`);
    if (r.block) { t.bs.wdone = done + r.n; this.block(t, { kind: 'write', fd }); return false; }
    t.bs.wdone = 0;
    return true;
  };
  proto.biRead = function (t, fd) {
    const r = this.fdRead(t, fd, 4096);
    if (r.block) { this.block(t, { kind: 'read', fd }); return null; }
    if (r.data && r.data.length) this.event('read', this.proc(t.pid), { fd, n: r.data.length, data: r.data, tid: t.tid }, `${this.who(t.pid)} (${t.bs.name}) reads ${K.show(r.data)}.`);
    return r.err ? '' : r.data;
  };
  proto.biOpen = function (t, path) { const ino = this.fs.dir[path]; if (ino === undefined) return -1; return this.fdAlloc(this.proc(t.pid), this.newOfile({ kind: 'file', ino, flags: 0 })); };
  proto.biExit = function (t, code) { const p = this.proc(t.pid); this.exit(p, code, false); };

  /** read all of the inputs (the files named, or stdin) into bs.data; true when done */
  function slurp(sys, t, bs) {
    const files = bs.argv.slice(1).filter((a) => !a.startsWith('-') || a === '-');
    if (bs.fi === undefined) { bs.fi = 0; bs.data = ''; bs.fd = -1; bs.names = files; }
    for (;;) {
      if (bs.fd < 0) {
        if (!files.length && bs.fi === 0) bs.fd = 0;
        else if (bs.fi >= files.length) return true;
        else { const f = files[bs.fi]; bs.fd = f === '-' ? 0 : sys.biOpen(t, f); if (bs.fd < 0) { bs.err = (bs.err || '') + bs.name + ': ' + f + ': No such file or directory\n'; bs.fi++; continue; } }
      }
      const d = sys.biRead(t, bs.fd);
      if (d === null) return false;
      if (d === '') { if (bs.fd > 2) sys.fdClose(sys.proc(t.pid), bs.fd); bs.fd = -1; bs.fi++; if (!files.length) return true; continue; }
      bs.data += d;
    }
  }
  const pad = (n) => String(n).padStart(8);
  K.BUILTIN_PROGS = {
    echo(sys, t, bs) {
      const nl = bs.argv[1] !== '-n', args = bs.argv.slice(nl ? 1 : 2);
      const r = sys.biWrite(t, 1, args.join(' ') + (nl ? '\n' : ''));
      if (r) sys.biExit(t, 0);
    },
    true(sys, t) { sys.biExit(t, 0); },
    false(sys, t) { sys.biExit(t, 1); },
    sleep(sys, t, bs) {
      if (bs.pc === 0) { const n = +bs.argv[1] || 0; bs.pc = 1; if (sys.o.sleep !== 'free' && n > 0) { t.wakeAt = sys.ms + n * 1000; sys.block(t, { kind: 'sleep', secs: n }); return; } }
      sys.biExit(t, 0);
    },
    yes(sys, t, bs) { sys.biWrite(t, 1, (bs.argv.slice(1).join(' ') || 'y') + '\n'); },
    ls(sys, t, bs) { const r = sys.biWrite(t, 1, Object.keys(sys.fs.dir).sort().map((n) => n + '\n').join('')); if (r) sys.biExit(t, 0); },
    cat(sys, t, bs) {
      // stream: read a chunk, write it, until every input ends
      const files = bs.argv.slice(1);
      if (bs.fi === undefined) { bs.fi = 0; bs.fd = -1; bs.out = null; bs.st = 0; }
      if (bs.out !== null) { const r = sys.biWrite(t, 1, bs.out); if (!r) return; if (r === 'dead') return; bs.out = null; return; }
      if (bs.err) { const r = sys.biWrite(t, 2, bs.err); if (!r) return; bs.err = ''; return; }
      if (bs.fd < 0) {
        if (!files.length && bs.fi === 0) bs.fd = 0;
        else if (bs.fi >= files.length) { sys.biExit(t, bs.st); return; }
        else { const f = files[bs.fi]; bs.fd = f === '-' ? 0 : sys.biOpen(t, f); if (bs.fd < 0) { bs.err = 'cat: ' + f + ': No such file or directory\n'; bs.st = 1; bs.fi++; return; } }
      }
      const d = sys.biRead(t, bs.fd);
      if (d === null) return;
      if (d === '') { if (bs.fd > 2) sys.fdClose(sys.proc(t.pid), bs.fd); bs.fd = -1; bs.fi++; if (!files.length) bs.fi = 1, sys.biExit(t, bs.st); return; }
      bs.out = d;
    },
    wc(sys, t, bs) {
      if (!bs.done) {
        if (!slurp(sys, t, bs)) return;
        bs.done = true;
        // -l lines, -w words, -c bytes (any of them, in that order; none: all three)
        const d = bs.data, fl = bs.argv.slice(1).filter((a) => /^-[lwc]+$/.test(a)).join('');
        const want = fl ? [/l/.test(fl), /w/.test(fl), /c/.test(fl)] : [true, true, true];
        const vals = [d.split('\n').length - 1, d.split(/\s+/).filter(Boolean).length, d.length];
        bs.text = vals.filter((v, i) => want[i]).map(pad).join('') + (bs.names.length ? ' ' + bs.names.join(' ') : '') + '\n';
      }
      if (sys.biWrite(t, 1, bs.text)) sys.biExit(t, 0);
    },
    sort(sys, t, bs) {
      if (!bs.done) { if (!slurp(sys, t, bs)) return; bs.done = true; const ls = bs.data.split('\n'); if (ls[ls.length - 1] === '') ls.pop(); ls.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); bs.text = ls.map((l) => l + '\n').join(''); }
      if (sys.biWrite(t, 1, bs.text)) sys.biExit(t, 0);
    },
    head(sys, t, bs) {
      if (bs.left === undefined) { const i = bs.argv.indexOf('-n'); bs.left = i > 0 ? +bs.argv[i + 1] : /^-\d+$/.test(bs.argv[1] || '') ? +bs.argv[1].slice(1) : 10; const f = bs.argv.slice(1).filter((a, k, all) => !a.startsWith('-') && all[k - 1] !== '-n'); bs.fd = f.length ? sys.biOpen(t, f[0]) : 0; bs.out = null; }
      if (bs.out !== null) { if (!sys.biWrite(t, 1, bs.out)) return; bs.out = null; if (bs.left <= 0) { sys.biExit(t, 0); } return; }
      if (bs.left <= 0 || bs.fd < 0) { sys.biExit(t, bs.fd < 0 ? 1 : 0); return; }
      const d = sys.biRead(t, bs.fd);
      if (d === null) return;
      if (d === '') { sys.biExit(t, 0); return; }
      let k = 0, out = '';
      for (const ch of d) { if (bs.left <= 0) break; out += ch; if (ch === '\n') bs.left--; k++; }
      bs.out = out;
    },
  };
  /** one step of a built-in program */
  proto.stepBuiltin = function (t) {
    const f = K.BUILTIN_PROGS[t.bs.name];
    t.line = 0;
    f(this, t, t.bs);
  };
})(globalThis.Proses = globalThis.Proses || {});
