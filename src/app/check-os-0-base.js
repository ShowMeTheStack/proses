// What the operating-systems exercise kinds share (check-os-*.js): reading a number typed in decimal, hex (0x) or
// binary (0b), checking a list of named fields at once, and registering a kind.
//   S.Check.os.int(text) -> BigInt | null           '0x1F', '31', '0b11111', '1_024', '1,024'
//   S.Check.os.fields(x, list, answer) -> result     list: [{key, label, want, kind: 'int' | 'text' | 'list' | 'set'}]
//     answer: {key: text}; result {ok, message, details, cells: {key: bool}}: the cells say which to mark red
//   S.Check.os.kind(name, def)                       registers S.Check.kinds[name] and adds name to kindNames
//   S.Check.os.norm(text)                            lower case, spaces collapsed, an output's newlines as spaces
(function (S) {
  'use strict';
  const K = (S.Check = S.Check || {});
  K.kinds = K.kinds || {};
  const O = (K.os = K.os || {});

  O.int = function (t) {
    let s = String(t === undefined || t === null ? '' : t).trim().replace(/[−–]/g, '-').replace(/[_,\s]/g, '');
    if (!s) return null;
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    let v = null;
    if (/^0x[0-9a-f]+$/i.test(s)) v = BigInt(s);
    else if (/^0b[01]+$/i.test(s)) v = BigInt(s);
    else if (/^\d+$/.test(s)) v = BigInt(s);
    else if (/^[0-9a-f]+h$/i.test(s)) v = BigInt('0x' + s.slice(0, -1));
    if (v === null) return null;
    return neg ? -v : v;
  };
  O.norm = (t) => String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
  O.list = (t) => (Array.isArray(t) ? t.map(String) : String(t === undefined || t === null ? '' : t).split(/[\s,;→>]+/)).map((v) => v.trim()).filter(Boolean);
  O.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : ws || w + 's');

  /** one field: is the typed text the wanted value? */
  O.same = function (f, got) {
    const kind = f.kind || (typeof f.want === 'bigint' || typeof f.want === 'number' ? 'int' : 'text');
    if (kind === 'int') { const g = O.int(got); return g !== null && g === BigInt(f.want); }
    if (kind === 'list') return O.list(got).map((v) => v.toLowerCase()).join(',') === O.list(f.want).map((v) => v.toLowerCase()).join(',');
    if (kind === 'set') { const a = [...new Set(O.list(got).map((v) => v.toLowerCase()))].sort(), b = [...new Set(O.list(f.want).map((v) => v.toLowerCase()))].sort(); return a.join(',') === b.join(','); }
    return O.norm(got) === O.norm(f.want);
  };

  O.fields = function (x, list, answer) {
    answer = answer || {};
    const cells = {}, wrong = [], empty = [];
    for (const f of list) {
      const got = answer[f.key];
      const blank = got === undefined || got === null || !String(got).trim();
      if (blank && !(f.kind === 'set' && !O.list(f.want).length)) { empty.push(f); cells[f.key] = false; continue; }
      cells[f.key] = O.same(f, got);
      if (!cells[f.key]) wrong.push(f);
    }
    if (!wrong.length && !empty.length) return { ok: true, cells, message: 'Right.' + (x.why ? ' ' + x.why : '') };
    if (empty.length === list.length) return { ok: false, cells, message: 'Fill in the ' + (list.length === 1 ? 'answer' : O.plural(list.length, 'field')) + ' first.' };
    const details = [];
    if (empty.length) details.push(O.plural(empty.length, 'field is', 'fields are') + ' still empty: ' + empty.map((f) => f.label).join(', ') + '.');
    if (x.whyNot) details.push(x.whyNot);
    const bad = wrong.length;
    return { ok: false, cells, message: bad ? 'Not quite: ' + (bad === 1 ? wrong[0].label + ' is' : wrong.map((f) => f.label).join(', ') + ' are') + ' not right yet (marked in red).' : 'Not yet: some fields are empty.', details };
  };

  O.kind = function (name, def) {
    K.kinds[name] = def;
    K.kindNames = K.kindNames || [];
    if (!K.kindNames.includes(name)) K.kindNames.push(name);
    return def;
  };
  const hexOf = (v, w) => '0x' + BigInt(v).toString(16).toUpperCase().padStart(w || 1, '0');
  O.hex = hexOf;
})(globalThis.Proses = globalThis.Proses || {});
