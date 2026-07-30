// Share links: copy a link, and pack a setup (a lab's workload or program, a topic's input) into a short
// URL-safe code, compressed when the browser can.
(function () {
  'use strict';
  const S = (globalThis.Proses = globalThis.Proses || {});
  const Share = (S.Share = {});
  const PREFIX = 'P1.';
  const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const canZip = typeof CompressionStream !== 'undefined';

  /** Any JSON-able value to a code */
  Share.pack = async function (obj) {
    const raw = new TextEncoder().encode(JSON.stringify({ v: 1, d: obj }));
    if (canZip) return PREFIX + 'z' + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
    return PREFIX + 'r' + b64url(raw);
  };
  /** A code (or a whole link holding one) back to the value */
  Share.unpack = async function (str) {
    const m = /(P1\.[zr][A-Za-z0-9_-]+)/.exec(String(str || ''));
    if (!m) throw new Error('This does not look like a Proses share code.');
    const body = m[1].slice(PREFIX.length);
    let obj;
    try {
      let raw = unb64url(body.slice(1));
      if (body[0] === 'z') raw = await pipe(raw, new DecompressionStream('deflate-raw'));
      obj = JSON.parse(new TextDecoder().decode(raw));
    } catch (e) { throw new Error('This share code is damaged or incomplete. Copy the whole link again.'); }
    if (!obj || obj.v !== 1) throw new Error('This share code is from a newer version of Proses.');
    return obj.d;
  };
  /** Copy text to the clipboard, or show it to copy by hand */
  Share.copy = function (text, msg) {
    const ok = () => S.UI.toast(msg || 'Copied.', 'ok');
    const manual = () => S.UI.prompt('Copy this link', 'Link', text, { ok: 'Done' });
    try { navigator.clipboard.writeText(text).then(ok, manual); } catch (e) { manual(); }
  };
})();
