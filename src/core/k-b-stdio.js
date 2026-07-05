// The simulated kernel, part two: stdio as the C library does it. printf formats into the process's own stdout
// buffer (user memory, so fork copies it and exec throws it away); the buffer reaches descriptor 1 with a write
// when it is flushed. The mode is chosen at the first output, as the C library does: line-buffered if descriptor
// 1 is a terminal (a newline flushes everything up to the last newline), fully buffered otherwise (a full buffer,
// fflush or exit writes it); setvbuf can choose. stderr is unbuffered. exit (and returning from main) flushes;
// _exit does not. Reading stdin goes through an input buffer too, filled a line at a time from the terminal.
//   S.Kern.format(vm, fmt, args) -> text      printf's formatting: %d %i %u %ld %lu %x %X %o %c %s %p %%, with the
//                                             flags - 0 + space #, a width, a precision, * for either
//   sys.emit(t, text, fn)                     printf, putchar, puts and fputs to stdout land here
//   sys.flushOut(t, upto, say) -> 'block' | null   write the first upto bytes of the buffer ({} in say: the text)
//   sys.sysStdio(t, name, args)               printf fprintf dprintf putchar puts fputs fflush setvbuf setbuf freopen
//                                             getchar fgets
//                                             perror (the machine itself computes sprintf, snprintf, strerror)
(function (S) {
  'use strict';
  const K = (S.Kern = S.Kern || {});
  /** a string for a sentence: newlines drawn as ↵, kept in backticks */
  K.show = (s) => '`' + String(s).replace(/\n/g, '↵').replace(/\t/g, '→').replace(/`/g, "'") + '`';

  K.format = function (vm, fmt, args) {
    const C = S.CLang;
    let out = '', ai = 0, i = 0;
    const arg = () => (ai < args.length ? args[ai++] : 0);
    while (i < fmt.length) {
      const c = fmt[i++];
      if (c !== '%') { out += c; continue; }
      const m = /^([-0+ #]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|z|j|t)?([diuxXocspn%])/.exec(fmt.slice(i));
      if (!m) { out += '%'; continue; }
      i += m[0].length;
      const flags = m[1], conv = m[5], len = m[4] || '';
      let width = m[2] === '*' ? arg() : m[2] ? +m[2] : 0, prec = m[3] === undefined ? null : m[3] === '*' ? arg() : +(m[3] || 0);
      let left = flags.includes('-');
      if (width < 0) { left = true; width = -width; }
      let s;
      switch (conv) {
        case '%': s = '%'; break;
        case 'c': s = String.fromCharCode(arg() & 255); break;
        case 's': { const a = arg(); s = a === 0 ? '(null)' : C.readStr(vm, a); if (prec !== null) s = s.slice(0, prec); break; }
        case 'p': s = '0x' + arg().toString(16); break;
        case 'n': arg(); s = ''; break;
        default: {
          let v = arg();
          const wide = len === 'l' || len === 'll' || len === 'z' || len === 'j' || len === 't';
          if (conv === 'd' || conv === 'i') { if (!wide) v = len === 'hh' ? (v << 24) >> 24 : len === 'h' ? (v << 16) >> 16 : v | 0; }
          else if (!wide) v = len === 'hh' ? v & 255 : len === 'h' ? v & 65535 : v >>> 0;
          else if (v < 0) v = Number(BigInt.asUintN(64, BigInt(Math.trunc(v)))); // an unsigned long
          const neg = v < 0, mag = Math.abs(v);
          let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString(10);
          if (prec !== null) { digits = prec === 0 && mag === 0 ? '' : digits.padStart(prec, '0'); }
          let sign = neg ? '-' : (conv === 'd' || conv === 'i') && flags.includes('+') ? '+' : (conv === 'd' || conv === 'i') && flags.includes(' ') ? ' ' : '';
          if (flags.includes('#') && mag !== 0) sign += conv === 'x' ? '0x' : conv === 'X' ? '0X' : conv === 'o' ? '0' : '';
          if (flags.includes('0') && !left && prec === null && sign.length + digits.length < width) digits = digits.padStart(width - sign.length, '0');
          s = sign + digits;
        }
      }
      if (s.length < width) s = left ? s.padEnd(width) : s.padStart(width);
      out += s;
    }
    return out;
  };

  const proto = K.System.prototype;
  /** where descriptor 1 goes, for a sentence */
  const dest = (sys, p, fd) => { const of = sys.ofOf(p, fd); return !of ? 'nowhere' : of.kind === 'tty' ? 'the terminal' : sys.ofName(of); };
  proto.emit = function (t, text, fn) {
    const p = this.proc(t.pid), who = this.whoT(t), at = ' at line `' + t.line + '`', show = K.show;
    if (!p.bufMode) { const of = this.ofOf(p, 1); p.bufMode = of && of.kind === 'tty' ? 'line' : 'full'; }
    const had = p.buf;
    p.buf += text;
    this.touch('buf:' + p.pid, 'w');
    if (p.bufMode === 'none') return this.flushOut(t, p.buf.length, `${who} calls ${fn}${at}: stdout is unbuffered, so {} goes to ${dest(this, p, 1)} at once.`);
    if (p.bufMode === 'line' && text.includes('\n')) {
      const cut = p.buf.lastIndexOf('\n') + 1;
      return this.flushOut(t, cut, had
        ? `${who} calls ${fn}${at}: the newline flushes its stdout buffer, ${show(had)} from before included, so {} reaches ${dest(this, p, 1)}.`
        : `${who} calls ${fn}${at}: the newline flushes its line-buffered stdout, so {} reaches ${dest(this, p, 1)}.`);
    }
    if (p.buf.length >= this.o.bufSize) return this.flushOut(t, p.buf.length - (p.buf.length % this.o.bufSize), `${who} calls ${fn}${at} and fills its stdout buffer, so {} is written to ${dest(this, p, 1)}.`);
    const say = p.bufMode === 'line'
      ? `${who} calls ${fn}${at}: ${show(text)} goes into its stdout buffer, and with no newline yet nothing reaches the terminal.`
      : `${who} calls ${fn}${at}: ${show(text)} goes into its stdout buffer, which, as stdout is not a terminal, is written only when it fills, on fflush or at exit.`;
    this.event('buffer', p, { text, buf: p.buf, line: t.line, tid: t.tid }, say);
    return null;
  };
  /** write the first upto bytes of p's stdout buffer to descriptor 1 */
  proto.flushOut = function (t, upto, say) {
    const p = this.proc(t.pid);
    upto = Math.min(upto, p.buf.length);
    if (!upto) return null;
    const text = p.buf.slice(0, upto), r = this.fdWrite(t, 1, text);
    if (r.err) { p.buf = p.buf.slice(upto); return null; }
    if (r.n) {
      p.buf = p.buf.slice(r.n);
      this.event(r.dev ? 'print' : 'write', p, { fd: 1, text: text.slice(0, r.n), line: t.line, tid: t.tid }, say.replace('{}', K.show(text.slice(0, r.n))));
    }
    if (r.block) {
      t.progress = { kind: 'flush', left: upto - r.n };
      this.block(t, { kind: 'flush', fd: 1 });
      return 'block';
    }
    return null;
  };
  /** go on with a flush that blocked: true when it is done */
  proto.resumeFlush = function (t) {
    const left = t.progress.left;
    t.progress = null;
    return this.flushOut(t, left, `${this.whoT(t)}'s stdout flush goes on: {} is written.`) !== 'block';
  };
  /** fill the input buffer from descriptor 0: 'block', 'eof' or null */
  proto.refill = function (t) {
    const p = this.proc(t.pid);
    if (p.bufMode === 'line' && p.buf && this.flushOut(t, p.buf.length, `${this.whoT(t)} reads stdin, so the C library flushes its line-buffered stdout first: {} goes out.`) === 'block') return 'block';
    const r = this.fdRead(t, 0, K.CONST.BUFSIZ);
    if (r.block) { this.block(t, { kind: 'read', fd: 0 }); return 'block'; }
    if (r.err || !r.data.length) return 'eof';
    p.inbuf += r.data;
    this.touch('buf:' + p.pid, 'w');
    return null;
  };
  proto.sysStdio = function (t, name, a) {
    const C = S.CLang, p = this.proc(t.pid), vm = t.vm, who = this.whoT(t), at = ' at line `' + t.line + '`';
    // the machine formats printf's text itself (info.text); K.format is the fallback
    const fmt = (i) => (this.info && typeof this.info.text === 'string' ? this.info.text : K.format(vm, C.readStr(vm, a[i]), a.slice(i + 1)));
    const toStream = (stream, text, fn) => {
      if (stream === 2) { const r = this.fdWrite(t, 2, text); if (r.n) this.event(r.dev ? 'print' : 'write', p, { fd: 2, text, line: t.line, tid: t.tid }, `${who} calls ${fn} on stderr${at}: stderr is unbuffered, so ${K.show(text)} goes to ${dest(this, p, 2)} at once.`); return { v: text.length }; }
      return this.emit(t, text, fn) === 'block' ? { v: text.length, block: true } : { v: text.length };
    };
    switch (name) {
      case 'printf': return toStream(1, fmt(0), 'printf');
      case 'fprintf': return toStream(a[0] === 2 ? 2 : 1, fmt(1), 'fprintf');
      case 'dprintf': { const text = fmt(1), r = this.fdWrite(t, a[0], text); if (r.err) return this.fail(t, r.err, null); this.event(r.dev ? 'print' : 'write', p, { fd: a[0], text, line: t.line, tid: t.tid }, `${who} calls dprintf on descriptor \`${a[0]}\`${at}: ${K.show(text)} goes to ${dest(this, p, a[0])}.`); return { v: text.length }; }
      case 'putchar': toStream(1, String.fromCharCode(a[0] & 255), 'putchar'); return { v: a[0] & 255 };
      case 'puts': return toStream(1, C.readStr(vm, a[0]) + '\n', 'puts');
      case 'fputs': return toStream(a[1] === 2 ? 2 : 1, C.readStr(vm, a[0]), 'fputs');
      case 'fflush': {
        if (a[0] === 2) return { v: 0 };
        if (!p.buf) { this.event('flush', p, { line: t.line, tid: t.tid }, `${who} calls fflush${at}: its buffer is empty, so nothing is written.`); return { v: 0 }; }
        return this.flushOut(t, p.buf.length, `${who} calls fflush${at}: {} goes to ${dest(this, p, 1)}.`) === 'block' ? { v: 0, block: true } : { v: 0 };
      }
      case 'setvbuf': p.bufMode = a[2] === 2 ? 'none' : a[2] === 1 ? 'line' : 'full'; return { v: 0 };
      case 'setbuf': {
        // setbuf(stream, NULL): unbuffered; setbuf(stream, buf): fully buffered, BUFSIZ bytes
        if (a[0] === 1) {
          p.bufMode = a[1] ? 'full' : 'none';
          this.event('setbuf', p, { mode: p.bufMode, line: t.line, tid: t.tid }, `${who} calls setbuf on stdout${at}: from now on stdout is ${a[1] ? 'fully buffered' : 'unbuffered, so every printf is written at once'}.`);
        }
        return { v: 0 };
      }
      case 'freopen': {
        // the stream's descriptor is replaced: open the file, dup2 it onto 0, 1 or 2, close the spare
        const ST = C.STREAMS || { stdin: 3, stdout: 1, stderr: 2 }, fd = a[2] === ST.stdin ? 0 : a[2] === ST.stderr ? 2 : 1;
        const mode = C.readStr(vm, a[1]), O = K.O, plus = mode.includes('+');
        const flags = mode[0] === 'r' ? (plus ? O.O_RDWR : O.O_RDONLY) : (plus ? O.O_RDWR : O.O_WRONLY) | O.O_CREAT | (mode[0] === 'a' ? O.O_APPEND : O.O_TRUNC);
        if (fd === 1 && p.buf && this.flushOut(t, p.buf.length, `${who} calls freopen on stdout${at}, which flushes it first: {} goes out.`) === 'block') return { block: true };
        const r = this.sysFile(t, 'open', [a[0], flags, 420]);
        if (r.v < 0) return { v: 0 };
        this.sysFile(t, 'dup2', [r.v, fd]);
        this.sysFile(t, 'close', [r.v]);
        if (fd === 1) p.bufMode = null;
        if (fd === 0) p.inbuf = '';
        return { v: a[2] };
      }
      case 'getchar': {
        if (!p.inbuf.length) { const r = this.refill(t); if (r === 'block') return { block: true }; if (r === 'eof') return { v: -1 }; }
        const c = p.inbuf.charCodeAt(0); p.inbuf = p.inbuf.slice(1);
        return { v: c };
      }
      case 'fgets': {
        const n = a[1];
        for (;;) {
          const nl = p.inbuf.indexOf('\n');
          if (nl >= 0 || p.inbuf.length >= n - 1) break;
          const r = this.refill(t);
          if (r === 'block') return { block: true };
          if (r === 'eof') break;
        }
        if (!p.inbuf.length) return { v: 0 };
        const nl = p.inbuf.indexOf('\n'), take = Math.min(n - 1, nl >= 0 ? nl + 1 : p.inbuf.length), s = p.inbuf.slice(0, take);
        p.inbuf = p.inbuf.slice(take);
        K.put(C, vm, a[0], s + '\0');
        this.event('input', p, { text: s, line: t.line, tid: t.tid }, `${who}'s fgets${at} reads the line ${K.show(s)} from stdin.`);
        return { v: a[0] };
      }
      case 'perror': {
        const pre = a[0] ? C.readStr(vm, a[0]) : '', text = (pre ? pre + ': ' : '') + (K.STRERROR[t.errno] || 'Unknown error ' + t.errno) + '\n';
        return toStream(2, text, 'perror');
      }
    }
    return null;
  };
})(globalThis.Proses = globalThis.Proses || {});
