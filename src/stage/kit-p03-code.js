// A program listing whose pid tags always fit their text: S.Kit.proc.code sizes a tag's pill from the row height
// (lineH − 5), which on the short rows the topics use (18 to 19) is shorter than a 13 px label. This variant draws
// the same listing and then makes every tag pill at least tagSize + 3 units tall, centred on its row.
//   S.Kit.pcode.code(o) -> the same as S.Kit.proc.code(o) ({items, w, h, rowY})
(function (S) {
  'use strict';
  const K = (S.Kit = S.Kit || {});
  const C = (K.pcode = {});
  C.code = function (o) {
    const r = S.Kit.proc.code(o), lh = o.lineH || 22, ts = o.tagSize || 12, need = ts + 3;
    for (const it of r.items) {
      if (it.kind !== 'cell' || !/^ptag\b/.test(it.cls || '') || it.h >= need) continue;
      const mid = it.y + it.h / 2;
      it.h = Math.min(need, lh - 1);
      it.y = Math.round((mid - it.h / 2) * 10) / 10;
      it.rx = it.h / 2;
    }
    return r;
  };
})(globalThis.Proses = globalThis.Proses || {});
