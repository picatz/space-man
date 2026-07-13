/* ============================================================================
   SPACE MAN — RUN TOGETHER relay networking (transport + room crypto).
   Classic script, fully lazy: this file defines window.SpaceManNet and
   constants ONLY. Zero sockets, zero key material, zero crypto calls until
   openRoom() / acceptJoin() / enterCode() runs. Peer bytes are data, never
   code: every inbound field is size-capped, whitelisted, or clamped before
   it can reach any state a renderer might read.
   ========================================================================== */
(function (root) {
  'use strict';

  /* -------------------------------------------------------------------------
     0. WIRE CONSTANTS — relay frame types, app frame types, hard caps
     ------------------------------------------------------------------------- */
  const PROTO = 1;                       // app protocol version (envelope ver)
  const ROOM_CAP = 32;
  const WIRE_MAX = 256;                  // hard cap per encrypted app packet (pre-decrypt gate)
  const RELAY_FRAME_MAX = 65536;         // declared relay frame length above this = protocol violation
  const RX_RING = 131072;                // reassembly buffer, allocated once per connection

  // Relay transport frame types (byte values are the relay wire contract).
  const F_SERVER_KEY = 0x01, F_CLIENT_INFO = 0x02, F_SERVER_INFO = 0x03;
  const F_SEND = 0x04, F_RECV = 0x05, F_KEEPALIVE = 0x06, F_NOTE_PREFERRED = 0x07;
  const F_PEER_GONE = 0x08, F_PING = 0x12, F_PONG = 0x13, F_HEALTH = 0x14, F_RESTARTING = 0x15;
  // Relay hello magic: fixed 8-byte protocol constant the server sends first.
  const RELAY_MAGIC = [0x44, 0x45, 0x52, 0x50, 0xf0, 0x9f, 0x94, 0x91];

  // App frame types (plaintext, inside the AEAD envelope).
  const A_HELLO = 0x01, A_WELCOME = 0x02, A_PRES = 0x04, A_SNAP = 0x05;
  const A_ROSTER = 0x03, A_ROLE = 0x0c;   // roster fan-out (roles + callsigns), role-change request
  // Emote (guest→host request 0x06, host→all broadcast 0x16), BYE (0x09), and
  // ROUND (0x0a, new-world) — opcodes are the spec's core-range reservations
  // (Appendix A). EMOTEB=0x16 is still ≤ FRAME_CORE_HI so it is validated, not
  // ignored. Emote ids are the shipped set 0-5 (wave/laugh/skull/heart/gg/panic).
  const A_EMOTE = 0x06, A_EMOTEB = 0x16, A_BYE = 0x09, A_ROUND = 0x0a;
  const EMOTE_MAX = 5;                     // shipped emote id ceiling (clamp 0..5 at RECEIPT)
  // Frame-type space partition (Addendum D headroom): 0x00-0x3F core (specced),
  // 0x40-0x7F reserved for future standard extensions (records/social, and the
  // M2 mobility move/handoff/migrate frames), 0x80-0xFF experimental/private.
  // Reserved AND experimental types are IGNORED silently and NEVER striked —
  // forward compat, capability-gated. Only the core range is validated.
  const FRAME_CORE_HI = 0x3f, FRAME_RESERVED_HI = 0x7f;
  // Code-channel frame types (inside the 'C' envelope).
  const C_REQ = 0x01, C_RESP = 0x02;
  // Envelope markers.
  const ENV_S = 0x53, ENV_C = 0x43;
  const DIR_G2H = 0x01, DIR_H2G = 0x02;

  // Roles (Addendum A). Separate caps: 32 players + 16 spectators. Spectators
  // pass the same gate, are kickable, may emote, but send ONLY keepalives — a
  // presence frame from a spectator is a protocol violation (strike).
  const ROLE_PLAYER = 0, ROLE_SPECTATOR = 1;
  const PLAYER_CAP = ROOM_CAP, SPECTATOR_CAP = 16;
  const ROLE_MIN_INTERVAL = 10000;        // ≤1 role change / 10s per key (host-enforced)

  // Capability bitfield (Addendum D) — features negotiate, never assume. HELLO
  // and WELCOME carry a u32; peers AND-mask before using a feature.
  const CAP_CALLSIGN = 1 << 0, CAP_SPECTATE = 1 << 1, CAP_ROLECHANGE = 1 << 2,
        CAP_ANTICHEAT = 1 << 3, CAP_HOSTEPOCH = 1 << 4;
  const CAPS = CAP_CALLSIGN | CAP_SPECTATE | CAP_ROLECHANGE | CAP_ANTICHEAT | CAP_HOSTEPOCH;

  // Mobility rate-limit tables (Addendum F.1) — GUEST-enforced; the host is
  // never trusted to self-limit. Move/handoff FLOWS are M2 (reserved frame
  // types); N2 ships the epoch/seq/consent PRIMITIVES and these client tables.
  const MOVE_MIN_INTERVAL = 300000;       // ≤1 relay move / 5 min per epoch
  const MOVE_FAIL_WINDOW = 600000, MOVE_FAIL_MAX = 2;  // 2 failed/rejected in 10 min → "unstable room"
  const HANDOFF_MIN_INTERVAL = 120000;    // ≤1 handoff / 2 min
  const RECONNECT_JITTER = 2000;          // 0–2s jittered reconnect (stampede control)

  // Timing (ms). Liveness is app-level: relay drops to absent keys silently.
  const T_CONNECT = 8000, T_HANDSHAKE = 5000, T_DEAD = 90000, T_PING_IDLE = 25000;
  const BACKOFF_BASE = 500, BACKOFF_CAP = 10000, BACKOFF_RESET = 30000;

  /* -------------------------------------------------------------------------
     1. BYTES — allocation-light helpers shared by every layer
     ------------------------------------------------------------------------- */
  const te = new TextEncoder(), td = new TextDecoder();
  const utf8 = (s) => te.encode(s);
  const hex = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += (u8[i] | 0x100).toString(16).slice(1); return s; };
  const cat = (...parts) => {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64uEnc(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 3) {
      const a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0;
      s += B64U[a >> 2] + B64U[((a & 3) << 4) | (b >> 4)];
      if (i + 1 < u8.length) s += B64U[((b & 15) << 2) | (c >> 6)];
      if (i + 2 < u8.length) s += B64U[c & 63];
    }
    return s;
  }
  function b64uDec(s) {
    if (!/^[A-Za-z0-9\-_]*$/.test(s)) return null;
    const out = new Uint8Array(Math.floor(s.length * 3 / 4));
    let o = 0, buf = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64U.indexOf(s[i]); bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
    }
    return out.subarray(0, o);
  }
  const ctEq = (a, b) => {                               // constant-time compare for MACs/proofs
    if (a.length !== b.length) return false;
    let v = 0; for (let i = 0; i < a.length; i++) v |= a[i] ^ b[i];
    return v === 0;
  };

  /* -------------------------------------------------------------------------
     2. NACL — vendored, derived from TweetNaCl-js (public domain). Do not edit.
     X25519 scalarmult + XSalsa20-Poly1305 box (the relay handshake mandates
     NaCl box; the browser crypto API has no XSalsa20) + SHA-256/HMAC/HKDF.
     Handshake-only hot path → auditability over speed. Poly1305 uses BigInt
     (handshake/code-channel only; per-message keys; ~20 auditable lines).
     No eval, no Function, no lookups off the global object.
     ------------------------------------------------------------------------- */
  /* NACL-BEGIN */
  const gf = (init) => { const r = new Float64Array(16); if (init) for (let i = 0; i < init.length; i++) r[i] = init[i]; return r; };
  const _121665 = gf([0xdb41, 1]);
  const BASE9 = (() => { const p = new Uint8Array(32); p[0] = 9; return p; })();
  const SIGMA = utf8('expand 32-byte k');
  const ZERO16 = new Uint8Array(16);

  function car25519(o) {
    let c = 1;
    for (let i = 0; i < 16; i++) { const v = o[i] + c + 65535; c = Math.floor(v / 65536); o[i] = v - c * 65536; }
    o[0] += c - 1 + 37 * (c - 1);
  }
  function sel25519(p, q, b) {
    const c = ~(b - 1);
    for (let i = 0; i < 16; i++) { const t = c & (p[i] ^ q[i]); p[i] ^= t; q[i] ^= t; }
  }
  function pack25519(o, n) {
    const m = gf(), t = gf();
    for (let i = 0; i < 16; i++) t[i] = n[i];
    car25519(t); car25519(t); car25519(t);
    for (let j = 0; j < 2; j++) {
      m[0] = t[0] - 0xffed;
      for (let i = 1; i < 15; i++) { m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1); m[i - 1] &= 0xffff; }
      m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
      const b = (m[15] >> 16) & 1;
      m[14] &= 0xffff;
      sel25519(t, m, 1 - b);
    }
    for (let i = 0; i < 16; i++) { o[2 * i] = t[i] & 0xff; o[2 * i + 1] = t[i] >> 8; }
  }
  function unpack25519(o, n) {
    for (let i = 0; i < 16; i++) o[i] = n[2 * i] + (n[2 * i + 1] << 8);
    o[15] &= 0x7fff;
  }
  function addF(o, a, b) { for (let i = 0; i < 16; i++) o[i] = a[i] + b[i]; }
  function subF(o, a, b) { for (let i = 0; i < 16; i++) o[i] = a[i] - b[i]; }
  function mulF(o, a, b) {
    const t = new Float64Array(31);
    for (let i = 0; i < 16; i++) { const ai = a[i]; for (let j = 0; j < 16; j++) t[i + j] += ai * b[j]; }
    for (let i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
    for (let i = 0; i < 16; i++) o[i] = t[i];
    car25519(o); car25519(o);
  }
  function sqrF(o, a) { mulF(o, a, a); }
  function inv25519(o, i) {
    const c = gf();
    for (let a = 0; a < 16; a++) c[a] = i[a];
    for (let a = 253; a >= 0; a--) { sqrF(c, c); if (a !== 2 && a !== 4) mulF(c, c, i); }
    for (let a = 0; a < 16; a++) o[a] = c[a];
  }
  function scalarmult(q, n, p) {
    const z = new Uint8Array(32);
    const x = new Float64Array(80);
    const a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf();
    for (let i = 0; i < 31; i++) z[i] = n[i];
    z[31] = (n[31] & 127) | 64;
    z[0] &= 248;
    unpack25519(x, p);
    for (let i = 0; i < 16; i++) { b[i] = x[i]; d[i] = a[i] = c[i] = 0; }
    a[0] = d[0] = 1;
    for (let i = 254; i >= 0; --i) {
      const r = (z[i >>> 3] >>> (i & 7)) & 1;
      sel25519(a, b, r); sel25519(c, d, r);
      addF(e, a, c); subF(a, a, c); addF(c, b, d); subF(b, b, d);
      sqrF(d, e); sqrF(f, a); mulF(a, c, a); mulF(c, b, e);
      addF(e, a, c); subF(a, a, c); sqrF(b, a); subF(c, d, f);
      mulF(a, c, _121665); addF(a, a, d); mulF(c, c, a);
      mulF(a, d, f); mulF(d, b, x); sqrF(b, e);
      sel25519(a, b, r); sel25519(c, d, r);
    }
    for (let i = 0; i < 16; i++) { x[i + 16] = a[i]; x[i + 32] = c[i]; x[i + 48] = b[i]; x[i + 64] = d[i]; }
    const x32 = x.subarray(32), x16 = x.subarray(16);
    inv25519(x32, x32);
    mulF(x16, x16, x32);
    pack25519(q, x16);
  }
  const scalarmultBase = (q, n) => scalarmult(q, n, BASE9);

  // Salsa20 core; h=true → HSalsa20 (32B out, no feed-forward), else 64B block.
  function coreSalsa(o, p, k, h) {
    const x = new Int32Array(16), w = new Int32Array(16);
    const ld = (a, i) => (a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24));
    x[0] = ld(SIGMA, 0); x[5] = ld(SIGMA, 4); x[10] = ld(SIGMA, 8); x[15] = ld(SIGMA, 12);
    x[1] = ld(k, 0); x[2] = ld(k, 4); x[3] = ld(k, 8); x[4] = ld(k, 12);
    x[11] = ld(k, 16); x[12] = ld(k, 20); x[13] = ld(k, 24); x[14] = ld(k, 28);
    x[6] = ld(p, 0); x[7] = ld(p, 4); x[8] = ld(p, 8); x[9] = ld(p, 12);
    for (let i = 0; i < 16; i++) w[i] = x[i];
    const R = (v, n) => (v << n) | (v >>> (32 - n));
    for (let i = 0; i < 20; i += 2) {
      x[4] ^= R(x[0] + x[12] | 0, 7); x[8] ^= R(x[4] + x[0] | 0, 9); x[12] ^= R(x[8] + x[4] | 0, 13); x[0] ^= R(x[12] + x[8] | 0, 18);
      x[9] ^= R(x[5] + x[1] | 0, 7); x[13] ^= R(x[9] + x[5] | 0, 9); x[1] ^= R(x[13] + x[9] | 0, 13); x[5] ^= R(x[1] + x[13] | 0, 18);
      x[14] ^= R(x[10] + x[6] | 0, 7); x[2] ^= R(x[14] + x[10] | 0, 9); x[6] ^= R(x[2] + x[14] | 0, 13); x[10] ^= R(x[6] + x[2] | 0, 18);
      x[3] ^= R(x[15] + x[11] | 0, 7); x[7] ^= R(x[3] + x[15] | 0, 9); x[11] ^= R(x[7] + x[3] | 0, 13); x[15] ^= R(x[11] + x[7] | 0, 18);
      x[1] ^= R(x[0] + x[3] | 0, 7); x[2] ^= R(x[1] + x[0] | 0, 9); x[3] ^= R(x[2] + x[1] | 0, 13); x[0] ^= R(x[3] + x[2] | 0, 18);
      x[6] ^= R(x[5] + x[4] | 0, 7); x[7] ^= R(x[6] + x[5] | 0, 9); x[4] ^= R(x[7] + x[6] | 0, 13); x[5] ^= R(x[4] + x[7] | 0, 18);
      x[11] ^= R(x[10] + x[9] | 0, 7); x[8] ^= R(x[11] + x[10] | 0, 9); x[9] ^= R(x[8] + x[11] | 0, 13); x[10] ^= R(x[9] + x[8] | 0, 18);
      x[12] ^= R(x[15] + x[14] | 0, 7); x[13] ^= R(x[12] + x[15] | 0, 9); x[14] ^= R(x[13] + x[12] | 0, 13); x[15] ^= R(x[14] + x[13] | 0, 18);
    }
    const st = (v, i) => { o[i] = v & 0xff; o[i + 1] = (v >>> 8) & 0xff; o[i + 2] = (v >>> 16) & 0xff; o[i + 3] = (v >>> 24) & 0xff; };
    if (h) {
      st(x[0], 0); st(x[5], 4); st(x[10], 8); st(x[15], 12);
      st(x[6], 16); st(x[7], 20); st(x[8], 24); st(x[9], 28);
    } else {
      for (let i = 0; i < 16; i++) st((x[i] + w[i]) | 0, i * 4);
    }
  }
  const coreHsalsa = (out32, in16, key32) => coreSalsa(out32, in16, key32, true);

  // XSalsa20 stream xor: subkey = HSalsa20(nonce[0:16]); Salsa20 with nonce[16:24] + u64 LE block counter.
  function streamXsalsaXor(out, m, len, n24, k) {
    const sub = new Uint8Array(32);
    coreHsalsa(sub, n24, k);
    const z = new Uint8Array(16);
    for (let i = 0; i < 8; i++) z[i] = n24[16 + i];
    const blk = new Uint8Array(64);
    let pos = 0;
    while (pos < len) {
      coreSalsa(blk, z, sub, false);
      const t = Math.min(64, len - pos);
      for (let i = 0; i < t; i++) out[pos + i] = m[pos + i] ^ blk[i];
      pos += t;
      let u = 1;
      for (let i = 8; i < 16; i++) { u += z[i]; z[i] = u & 0xff; u >>>= 8; }
    }
  }

  // Poly1305 one-shot (RFC 8439 semantics), BigInt for auditability — handshake/code channel only.
  function poly1305(msg, key32) {
    const le = (u8, off, n) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(u8[off + i]); return v; };
    const r = le(key32, 0, 16) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
    const s = le(key32, 16, 16);
    const p = (1n << 130n) - 5n;
    let acc = 0n;
    for (let i = 0; i < msg.length; i += 16) {
      const n = Math.min(16, msg.length - i);
      acc = ((acc + (le(msg, i, n) | (1n << BigInt(8 * n)))) * r) % p;
    }
    acc = (acc + s) & ((1n << 128n) - 1n);
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) { out[i] = Number(acc & 0xffn); acc >>= 8n; }
    return out;
  }

  // NaCl secretbox: stream[0:32] keys Poly1305, ciphertext starts at stream offset 32.
  function secretboxSeal(pt, n24, k) {
    const m = new Uint8Array(32 + pt.length); m.set(pt, 32);
    const c = new Uint8Array(m.length);
    streamXsalsaXor(c, m, m.length, n24, k);
    return cat(poly1305(c.subarray(32), c.subarray(0, 32)), c.subarray(32));
  }
  function secretboxOpen(box, n24, k) {              // box = tag(16) || ct; null on forgery
    if (box.length < 16) return null;
    const c = new Uint8Array(32 + box.length - 16);  // c[0:32]=0 → m[0:32]=stream=poly key
    c.set(box.subarray(16), 32);
    const m = new Uint8Array(c.length);
    streamXsalsaXor(m, c, c.length, n24, k);
    if (!ctEq(poly1305(box.subarray(16), m.subarray(0, 32)), box.subarray(0, 16))) return null;
    return m.slice(32);
  }
  // box precompute: k = HSalsa20(0, X25519(myPriv, theirPub)).
  function boxKeyFromShared(ss) { const k = new Uint8Array(32); coreHsalsa(k, ZERO16, ss); return k; }
  function boxKey(theirPub, myPriv) {
    const ss = new Uint8Array(32);
    scalarmult(ss, myPriv, theirPub);
    return boxKeyFromShared(ss);
  }
  const boxSeal = (pt, n24, theirPub, myPriv) => secretboxSeal(pt, n24, boxKey(theirPub, myPriv));
  const boxOpen = (ct, n24, theirPub, myPriv) => secretboxOpen(ct, n24, boxKey(theirPub, myPriv));

  // SHA-256 (FIPS 180-4), pure JS: deterministic everywhere, sync for code derivation.
  const SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(msg) {
    const l = msg.length;
    const padded = new Uint8Array(((l + 8) >> 6 << 6) + 64);
    padded.set(msg); padded[l] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(l / 536870912), false);   // bit length hi (l*8 / 2^32)
    dv.setUint32(padded.length - 4, (l << 3) >>> 0, false);
    const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Int32Array(64);
    const rr = (v, n) => (v >>> n) | (v << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i] >>> 0, false);
    return out;
  }
  function hmacSha256(key, msg) {
    let k = key.length > 64 ? sha256(key) : key;
    const ipad = new Uint8Array(64), opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { const b = i < k.length ? k[i] : 0; ipad[i] = b ^ 0x36; opad[i] = b ^ 0x5c; }
    return sha256(cat(opad, sha256(cat(ipad, msg))));
  }
  function hkdfSha256(ikm, salt, info, len) {
    const prk = hmacSha256(salt.length ? salt : new Uint8Array(32), ikm);
    let t = new Uint8Array(0), okm = new Uint8Array(0);
    for (let i = 1; okm.length < len; i++) {
      t = hmacSha256(prk, cat(t, info, new Uint8Array([i])));
      okm = cat(okm, t);
    }
    return okm.subarray(0, len);
  }
  /* NACL-END */

  /* -------------------------------------------------------------------------
     3. KEYS — runtime X25519 detection, session keypairs, ECDH, pair keys
     Detection runs once, at first use — never on load (lazy rule I1).
     ------------------------------------------------------------------------- */
  let webX = null;      // null = undetected; true = browser-native X25519; false = vendored
  async function detectX25519() {
    if (webX !== null) return webX;
    try {
      const k = await crypto.subtle.generateKey('X25519', true, ['deriveBits']);
      webX = !!(k && k.publicKey);
    } catch (e) { webX = false; }
    return webX;
  }
  // Keypair = {pub, priv: raw 32B (NaCl box + rejoin token need it), key: native handle | null}.
  async function genKeypair() {
    if (await detectX25519()) {
      try {
        const kp = await crypto.subtle.generateKey('X25519', true, ['deriveBits']);
        const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
        const pk8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
        return { pub, priv: pk8.slice(pk8.length - 32), key: kp.privateKey };  // pkcs8 tail = raw scalar
      } catch (e) { webX = false; }                    // mid-flight failure → vendored path
    }
    const priv = rand(32);
    priv[0] &= 248; priv[31] &= 127; priv[31] |= 64;
    const pub = new Uint8Array(32);
    scalarmultBase(pub, priv);
    return { pub, priv, key: null };
  }
  function keypairFromRaw(priv) {                      // deterministic (short-code channel)
    const k = priv.slice();
    k[0] &= 248; k[31] &= 127; k[31] |= 64;
    const pub = new Uint8Array(32);
    scalarmultBase(pub, k);
    return { pub, priv: k, key: null };
  }
  async function ecdh(mine, theirPub) {
    if (mine.key && webX) {
      try {
        const pk = await crypto.subtle.importKey('raw', theirPub, 'X25519', false, []);
        return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pk }, mine.key, 256));
      } catch (e) { /* vendored below */ }
    }
    const ss = new Uint8Array(32);
    scalarmult(ss, mine.priv, theirPub);
    return ss;
  }
  // pairKey = HKDF(ss, roomId||epoch, "smnet1"||lexmin(pubs)||lexmax(pubs)) → AES-GCM, non-extractable.
  async function derivePairKey(mine, theirPub, roomId8, epoch) {
    const ss = await ecdh(mine, theirPub);
    const lo = hex(mine.pub) < hex(theirPub) ? mine.pub : theirPub;
    const hi = lo === mine.pub ? theirPub : mine.pub;
    const okm = hkdfSha256(ss, cat(roomId8, new Uint8Array([epoch])), cat(utf8('smnet1'), lo, hi), 32);
    return crypto.subtle.importKey('raw', okm, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  /* -------------------------------------------------------------------------
     4. AEAD ENVELOPES — 'S' app frames (AES-GCM, counter nonce) + 'C' code
     channel (random-nonce NaCl box: no counter state exists pre-join).
     Replay rule: strict counter > highSeen per (pair, dir); highSeen moves
     only after a successful open (garbage cannot burn counters).
     ------------------------------------------------------------------------- */
  function makePair(aesKey, roomId8, epoch, sendDir) {
    return { key: aesKey, roomId: roomId8, epoch, dir: sendDir, sendCtr: 0, highSeen: -1 };
  }
  function envHead(pair, dir, ctr) {
    const iv = new Uint8Array(12);                      // dir(1) || counter u64 LE || 0x000000
    iv[0] = dir;
    const dv = new DataView(iv.buffer);
    dv.setUint32(1, ctr >>> 0, true);
    dv.setUint32(5, Math.floor(ctr / 4294967296), true);
    const aad = new Uint8Array(11);                     // ver || roomId(8) || epoch || dir
    aad[0] = PROTO; aad.set(pair.roomId, 1); aad[9] = pair.epoch; aad[10] = dir;
    return { iv, aad };
  }
  async function sealApp(pair, pt) {
    if (pair.sendCtr >= 4294967296) throw new Error('pair exhausted');   // ~13y @10Hz; assert anyway
    const ctr = pair.sendCtr++;
    const { iv, aad } = envHead(pair, pair.dir, ctr);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, pair.key, pt));
    const out = new Uint8Array(11 + ct.length);         // 'S' ver dir ctr(8) || ct+tag
    out[0] = ENV_S; out[1] = PROTO; out[2] = pair.dir;
    const dv = new DataView(out.buffer);
    dv.setUint32(3, ctr >>> 0, true);
    dv.setUint32(7, Math.floor(ctr / 4294967296), true);
    out.set(ct, 11);
    return out;
  }
  async function openApp(pair, wire) {                  // → {pt} | {err} — err names feed the strike table
    if (wire.length > WIRE_MAX) return { err: 'size' };
    if (wire.length < 11 + 16 || wire[0] !== ENV_S) return { err: 'ver' };
    if (wire[1] !== PROTO) return { err: 'ver' };
    const theirDir = pair.dir === DIR_G2H ? DIR_H2G : DIR_G2H;
    if (wire[2] !== theirDir) return { err: 'dir' };
    const dv = new DataView(wire.buffer, wire.byteOffset);
    const ctr = dv.getUint32(3, true) + dv.getUint32(7, true) * 4294967296;
    if (ctr <= pair.highSeen) return { err: 'replay' };
    const { iv, aad } = envHead(pair, theirDir, ctr);
    try {
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, pair.key, wire.subarray(11)));
      pair.highSeen = ctr;
      return { pt };
    } catch (e) { return { err: 'aead' }; }
  }
  function sealCode(pt, theirPub, myPriv) {             // 'C' ver nonce24 box
    const nonce = rand(24);
    return cat(new Uint8Array([ENV_C, PROTO]), nonce, boxSeal(pt, nonce, theirPub, myPriv));
  }
  function openCode(wire, theirPub, myPriv) {
    if (wire.length < 2 + 24 + 16 || wire[0] !== ENV_C || wire[1] !== PROTO) return null;
    return boxOpen(wire.subarray(26), wire.subarray(2, 26), theirPub, myPriv);
  }

  /* -------------------------------------------------------------------------
     5. INVITE + SHORT CODE — #j= payload codec, room proofs, code keypairs
     ------------------------------------------------------------------------- */
  function encodeInvite(inv) {   // {flags, roomId8, epoch, hostPub, region, relayHost?, secret16, expiryMin}
    const head = new Uint8Array(46);
    head[0] = 1; head[1] = inv.flags & 0xff;
    head.set(inv.roomId, 2); head[10] = inv.epoch;
    head.set(inv.hostPub, 11);
    for (let i = 0; i < 3; i++) head[43 + i] = (inv.region || 'nyc').charCodeAt(i) & 0x7f;
    let mid = new Uint8Array(0);
    if (inv.flags & 2) {
      const h = utf8(inv.relayHost);
      if (h.length > 64) throw new Error('relay host too long');
      mid = cat(new Uint8Array([h.length]), h);
    }
    const tail = new Uint8Array(20);
    tail.set(inv.secret, 0);
    new DataView(tail.buffer).setUint32(16, inv.expiryMin >>> 0, true);
    return b64uEnc(cat(head, mid, tail));
  }
  function decodeInvite(str) {   // → {inv} | {err: 'parse'|'version'|'expired'|'relayhost'}
    const b = b64uDec(String(str || '').trim());
    if (!b || b.length < 66) return { err: 'parse' };
    if (b[0] !== 1) return { err: 'version' };
    const flags = b[1];
    const roomId = b.slice(2, 10), epoch = b[10], hostPub = b.slice(11, 43);
    let region = '', off = 46;
    for (let i = 0; i < 3; i++) region += String.fromCharCode(b[43 + i]);
    if (!/^[a-z0-9]{3}$/.test(region)) return { err: 'parse' };
    let relayHost = '';
    if (flags & 2) {
      const n = b[46];
      if (n < 4 || n > 64 || b.length < 47 + n + 20) return { err: 'parse' };
      relayHost = td.decode(b.subarray(47, 47 + n));
      if (!/^[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(relayHost)) return { err: 'relayhost' };
      off = 47 + n;
    }
    if (b.length < off + 20) return { err: 'parse' };
    const secret = b.slice(off, off + 16);
    const expiryMin = new DataView(b.buffer, b.byteOffset + off + 16).getUint32(0, true);
    if (Date.now() / 60000 > expiryMin) return { err: 'expired' };
    return { inv: { flags, roomId, epoch, hostPub, region, relayHost, secret, expiryMin } };
  }
  // Join proof binds the room secret to (roomId, epoch, guest key, host key) — no replay surface.
  const joinProof = (secret, roomId8, epoch, gPub, hPub) =>
    hmacSha256(secret, cat(utf8('join1'), roomId8, new Uint8Array([epoch]), gPub, hPub)).slice(0, 16);
  const rejoinToken = (secret, gPub) => hmacSha256(secret, cat(utf8('rejoin'), gPub)).slice(0, 8);

  // Short-code channel: the code IS the keypair (possession = capability, like
  // overhearing it). Region-scoped so identical codes never collide across relays.
  const CODE_WORDS = (
    'AMBER ASPEN BADGE BANJO BASIL BEACH BERRY BISON BLAZE BLOOM BONGO BRAVO ' +
    'BRICK BROOK CABIN CANOE CARGO CEDAR CHALK CLIFF CLOUD COBALT COCOA COMET ' +
    'CORAL COSMOS CRANE CRISP DAISY DELTA DENIM DINGO DONUT DRIFT EAGLE EMBER ' +
    'FALCON FERN FIESTA FLAME FLINT FOREST FOSSIL FROST GALAXY GARNET GECKO GINGER ' +
    'GLIDE GRAPE GROVE GUITAR HARBOR HAZEL HELIX HOTEL IGLOO INDIGO ISLAND JAGUAR ' +
    'JUMBO JUNGLE KARMA KAYAK KIOSK KIWI KOALA LAGOON LEMON LILAC LOTUS ' +
    'LYRIC MANGO MAPLE MARBLE MEADOW METEOR MINT MOSAIC NECTAR NIMBUS NOODLE ' +
    'NUTMEG OASIS OCEAN OLIVE ONYX OPAL ORBIT OTTER PANDA PEBBLE PEPPER PIANO ' +
    'PICNIC PILOT PLAZA PLUTO PONCHO PRISM PUMA QUARTZ RADAR RAVEN RIVER ' +
    'ROBIN ROCKET SAFARI SALSA SIERRA SONNET SPRUCE SUNSET TANGO TEMPO TIGER ' +
    'TOPAZ TULIP TUNDRA TURBO VELVET VIOLET VOYAGE WAFFLE WALNUT WILLOW ZEBRA ZENITH'
  ).split(' ');                                        // 128 words × 100 suffixes = 12,800 codes
  function randomCode() {
    const r = rand(3);
    return CODE_WORDS[r[0] & 127] + '-' + String((r[1] % 10)) + String((r[2] % 10));
  }
  function codeKeypair(region, code) {
    const c = String(code || '').toUpperCase().trim();
    if (!/^[A-Z]{4,6}-\d\d$/.test(c)) return null;
    return keypairFromRaw(sha256(utf8('sm.code.v1|' + region + '|' + c)));
  }

  /* -------------------------------------------------------------------------
     6. RELAY MAP — embedded snapshot (OUR schema; self-hosted fleets swap this
     blob or use the settings override — zero protocol changes). Hostnames are
     data, honest and devtools-visible. Regenerated from the public relay map
     via the Dockerized QA tooling; cap 40 regions.
     ------------------------------------------------------------------------- */
  // Active relay directory (Addendum E — SUPERSEDES the old transformed snapshot).
  // The parsed map comes from SpaceManRelayDir (native official-format parser +
  // fallback ladder in src/relay-directory.js). A tiny seed keeps net.js
  // self-contained when that module is absent (unit tests / tools). Nothing here
  // fetches — parsing the baked copy is pure computation; a LIVE refresh happens
  // only via SpaceManNet.setRelayDirectory()/openRoom() (lazy rule preserved).
  const SEED_REGIONS = [
    { code: 'nyc', city: 'New York City', lat: 40.7128, lon: -74.006, hosts: ['derp1f.tailscale.com', 'derp1g.tailscale.com'] },
    { code: 'ord', city: 'Chicago', lat: 41.881944, lon: -87.627778, hosts: ['derp12d.tailscale.com', 'derp12e.tailscale.com'] },
    { code: 'sfo', city: 'San Francisco', lat: 37.8, lon: -122.4, hosts: ['derp2d.tailscale.com', 'derp2e.tailscale.com'] },
    { code: 'lhr', city: 'London', lat: 51.5, lon: 0.1, hosts: ['derp8e.tailscale.com', 'derp8f.tailscale.com'] },
  ];
  let _activeMap = null;
  function activeMap() {
    if (_activeMap) return _activeMap;
    const dir = root.SpaceManRelayDir;
    if (dir) { try { const m = dir.baked(); if (m && m.regions && m.regions.length) { _activeMap = m; return m; } } catch (e) {} }
    _activeMap = { v: 1, src: 'seed', regions: SEED_REGIONS };
    return _activeMap;
  }
  function setActiveMap(m) { if (m && m.regions && m.regions.length) _activeMap = m; return _activeMap; }
  // Back-compat alias: the transport still calls it RELAY_MAP; it is now a live view.
  const RELAY_MAP = { get regions() { return activeMap().regions; }, get v() { return activeMap().v; }, get src() { return activeMap().src; } };
  // Locality guess: tz → (lat,lon); wrong guesses only cost probe latency, never correctness.
  const TZ_LL = {
    'America/New_York': [40.7, -74], 'America/Chicago': [41.9, -87.6], 'America/Denver': [39.7, -105],
    'America/Phoenix': [33.4, -112.1], 'America/Los_Angeles': [34.1, -118.3], 'America/Vancouver': [49.3, -123.1],
    'America/Toronto': [43.7, -79.4], 'America/Mexico_City': [19.4, -99.1], 'America/Sao_Paulo': [-23.6, -46.6],
    'America/Argentina/Buenos_Aires': [-34.6, -58.4], 'America/Anchorage': [61.2, -149.9], 'Pacific/Honolulu': [21.3, -157.9],
    'Europe/London': [51.5, 0.1], 'Europe/Dublin': [53.3, -6.3], 'Europe/Paris': [48.9, 2.4],
    'Europe/Berlin': [52.5, 13.4], 'Europe/Madrid': [40.4, -3.7], 'Europe/Rome': [41.9, 12.5],
    'Europe/Amsterdam': [52.4, 4.9], 'Europe/Stockholm': [59.3, 18.1], 'Europe/Warsaw': [52.2, 21],
    'Europe/Helsinki': [60.2, 24.9], 'Europe/Moscow': [55.8, 37.6], 'Europe/Istanbul': [41, 29],
    'Africa/Johannesburg': [-26.2, 28], 'Africa/Nairobi': [-1.3, 36.8], 'Africa/Lagos': [6.5, 3.4],
    'Africa/Cairo': [30, 31.2], 'Asia/Dubai': [25.3, 55.3], 'Asia/Kolkata': [19.1, 72.9],
    'Asia/Bangkok': [13.8, 100.5], 'Asia/Singapore': [1.4, 103.8], 'Asia/Jakarta': [-6.2, 106.8],
    'Asia/Hong_Kong': [22.3, 114.2], 'Asia/Shanghai': [31.2, 121.5], 'Asia/Tokyo': [35.7, 139.7],
    'Asia/Seoul': [37.6, 127], 'Australia/Perth': [-31.9, 115.9], 'Australia/Sydney': [-33.9, 151.2],
    'Australia/Melbourne': [-37.8, 145], 'Pacific/Auckland': [-36.8, 174.8],
  };
  function greatCircle(a1, o1, a2, o2) {
    const r = Math.PI / 180;
    const s = Math.sin((a2 - a1) * r / 2), t = Math.sin((o2 - o1) * r / 2);
    return 12742 * Math.asin(Math.sqrt(s * s + Math.cos(a1 * r) * Math.cos(a2 * r) * t * t));
  }
  function regionOf(code) {
    for (const rg of RELAY_MAP.regions) if (rg.code === code) return rg;
    return null;
  }
  function cityOfHost(host) {
    for (const rg of RELAY_MAP.regions) if (rg.hosts.indexOf(host) >= 0) return rg.city;
    return 'custom relay';
  }
  // Probe: 2× opaque GETs (first discarded — connection warmup), 3s timeout, timing only.
  async function probeHost(host) {
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const t0 = performance.now();
      try {
        await fetch('https://' + host + '/derp/probe', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
        if (i > 0) best = Math.min(best, performance.now() - t0);
      } catch (e) { /* unreachable host = Infinity */ }
      clearTimeout(t);
    }
    return best;
  }
  async function pickRegion() {
    let lat = 40, lon = -95;                            // fallback: continental midpoint
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TZ_LL[tz]) { lat = TZ_LL[tz][0]; lon = TZ_LL[tz][1]; }
    } catch (e) { /* keep fallback */ }
    const near = RELAY_MAP.regions.slice()
      .sort((a, b) => greatCircle(lat, lon, a.lat, a.lon) - greatCircle(lat, lon, b.lat, b.lon))
      .slice(0, 5);
    const times = await Promise.all(near.map((rg) => probeHost(rg.hosts[0])));
    let win = 0;
    for (let i = 1; i < near.length; i++) if (times[i] < times[win]) win = i;
    return isFinite(times[win]) ? near[win] : near[0];  // all probes dead → nearest; connect will surface failure
  }

  /* -------------------------------------------------------------------------
     7. RELAY CLIENT — WebSocket byte-stream framing. The server treats the
     socket as a stream: one message may hold many frames or a fraction of one,
     so all parsing runs through a preallocated reassembly buffer.
     ------------------------------------------------------------------------- */
  function RelayClient(host, keys, cb) {                // cb: {onOpen,onPacket,onPeerGone,onRtt,onDown,onLog}
    const c = {
      host, keys, cb, ws: null, state: 'idle', closed: false,
      rx: null, rxLen: 0, boxK: null, serverInfo: null,
      lastRecv: 0, lastSend: 0, pingCtr: 0, pingSent: new Map(), rtt: 0,
      attempts: 0, timers: [], hq: Promise.resolve(),
    };
    const now = () => performance.now();
    const later = (fn, ms) => { const t = setTimeout(fn, ms); c.timers.push(t); return t; };
    const clearTimers = () => { for (const t of c.timers) clearTimeout(t); c.timers.length = 0; };
    const log = (m) => { if (cb.onLog) cb.onLog(m); };

    function sendFrame(type, payload) {
      if (!c.ws || c.ws.readyState !== 1) return;
      const b = new Uint8Array(5 + payload.length);
      b[0] = type;
      new DataView(b.buffer).setUint32(1, payload.length, false);   // relay lengths are big-endian
      b.set(payload, 5);
      c.ws.send(b);
      c.lastSend = now();
    }
    c.send = (dstPub, bytes) => sendFrame(F_SEND, cat(dstPub, bytes));

    function fail(why) {                                // dead socket / violation → backoff reconnect
      log('down: ' + why);
      clearTimers();
      if (c.ws) { try { c.ws.close(); } catch (e) {} c.ws = null; }
      if (c.state !== 'closed') c.state = 'down';
      if (cb.onDown) cb.onDown(why);
      if (c.closed) return;
      const n = Math.min(c.attempts++, 6);
      const base = Math.min(BACKOFF_BASE * Math.pow(2, n), BACKOFF_CAP);
      const delay = base * (0.75 + Math.random() * 0.5);           // ±25% full jitter
      later(() => c.connect(), delay);
    }

    async function handleFrame(type, payload) {
      c.lastRecv = now();
      if (type === F_SERVER_KEY) {
        if (payload.length < 40) return fail('short server key');
        for (let i = 0; i < 8; i++) if (payload[i] !== RELAY_MAGIC[i]) return fail('bad magic');
        const serverPub = payload.slice(8, 40);
        c.boxK = boxKeyFromShared(await ecdh(c.keys, serverPub));
        const nonce = rand(24);
        const info = utf8('{"version":2,"CanAckPings":true}');
        sendFrame(F_CLIENT_INFO, cat(c.keys.pub, nonce, secretboxSeal(info, nonce, c.boxK)));
        return;
      }
      if (type === F_SERVER_INFO) {
        if (payload.length > 24) {
          const pt = secretboxOpen(payload.subarray(24), payload.subarray(0, 24), c.boxK);
          if (pt) { try { c.serverInfo = JSON.parse(td.decode(pt)); } catch (e) {} }
          else return fail('server info reject');       // treat as tamper signal: reconnect
        }
        sendFrame(F_NOTE_PREFERRED, new Uint8Array([1]));
        c.state = 'established';
        later(() => { c.attempts = 0; }, BACKOFF_RESET);           // healthy for 30s → reset backoff
        if (cb.onOpen) cb.onOpen(c.serverInfo);
        return;
      }
      if (type === F_RECV) {
        if (payload.length < 32) return;
        // app-layer faults must never recycle the transport: strike logic lives above
        if (cb.onPacket) { try { await cb.onPacket(payload.slice(0, 32), payload.slice(32)); } catch (e) { log('packet: ' + (e && e.message)); } }
        return;
      }
      if (type === F_PING) { sendFrame(F_PONG, payload.slice(0, 8)); return; }
      if (type === F_PONG) {
        const t0 = c.pingSent.get(hex(payload.subarray(0, 8)));
        if (t0 !== undefined) {
          c.pingSent.delete(hex(payload.subarray(0, 8)));
          const sample = now() - t0;
          c.rtt = c.rtt ? 0.7 * c.rtt + 0.3 * sample : sample;
          if (cb.onRtt) cb.onRtt(c.rtt);
        }
        return;
      }
      if (type === F_PEER_GONE) {
        if (payload.length >= 32 && cb.onPeerGone) cb.onPeerGone(payload.slice(0, 32), payload.length > 32 ? payload[32] : 0);
        return;
      }
      if (type === F_HEALTH) { log('relay health: ' + td.decode(payload)); return; }
      if (type === F_RESTARTING) {
        const a = payload.length >= 4 ? new DataView(payload.buffer, payload.byteOffset).getUint32(0, false) : 1000;
        clearTimers();
        if (c.ws) { try { c.ws.close(); } catch (e) {} c.ws = null; }
        c.state = 'down';
        later(() => c.connect(), a);                    // scheduled restart carries no backoff penalty
        return;
      }
      /* KeepAlive and unknown types: liveness credit only, skip payload */
    }

    function onMessage(ev) {
      const d = new Uint8Array(ev.data);
      if (c.rxLen + d.length > c.rx.length) return fail('rx overflow');
      c.rx.set(d, c.rxLen);
      c.rxLen += d.length;
      let off = 0;
      const jobs = [];
      while (c.rxLen - off >= 5) {
        const type = c.rx[off];
        const len = ((c.rx[off + 1] << 24) | (c.rx[off + 2] << 16) | (c.rx[off + 3] << 8) | c.rx[off + 4]) >>> 0;
        if (len > RELAY_FRAME_MAX) return fail('frame too large');
        if (c.rxLen - off - 5 < len) break;
        jobs.push([type, c.rx.slice(off + 5, off + 5 + len)]);      // copy out so the ring can compact
        off += 5 + len;
      }
      if (off) { c.rx.copyWithin(0, off, c.rxLen); c.rxLen -= off; }
      for (const [t, p] of jobs) c.hq = c.hq.then(() => handleFrame(t, p)).catch((e) => fail('frame: ' + (e && e.message)));
    }

    c.connect = () => {
      if (c.closed) return;
      clearTimers();
      c.state = 'connecting';
      c.rx = c.rx || new Uint8Array(RX_RING);
      c.rxLen = 0;
      c.hq = Promise.resolve();
      let ws;
      try { ws = new WebSocket('wss://' + c.host + '/derp', 'derp'); }
      catch (e) { return fail('ws ctor: ' + (e && e.message)); }
      ws.binaryType = 'arraybuffer';
      c.ws = ws;
      const connectT = later(() => fail('connect timeout'), T_CONNECT);
      ws.onopen = () => {
        clearTimeout(connectT);
        c.state = 'handshake';
        c.lastRecv = now();
        later(() => { if (c.state === 'handshake') fail('handshake timeout'); }, T_HANDSHAKE);
        // liveness: server keepalives ≥1/60s refresh lastRecv; 90s of silence = dead
        const live = setInterval(() => {
          if (c.closed || !c.ws) { clearInterval(live); return; }
          if (now() - c.lastRecv > T_DEAD) { clearInterval(live); fail('liveness'); return; }
          if (c.state === 'established' && now() - c.lastSend > T_PING_IDLE) c.ping();
        }, 5000);
        c.timers.push(live);
      };
      ws.onmessage = onMessage;
      ws.onerror = () => {};                            // close always follows; fail() runs once there
      ws.onclose = () => { if (!c.closed && c.state !== 'down') fail('socket closed'); };
    };
    c.ping = () => {
      const p = new Uint8Array(8);
      new DataView(p.buffer).setUint32(0, ++c.pingCtr, true);
      c.pingSent.set(hex(p), now());
      if (c.pingSent.size > 8) c.pingSent.delete(c.pingSent.keys().next().value);
      sendFrame(F_PING, p);
    };
    c.close = () => {
      c.closed = true;
      c.state = 'closed';
      clearTimers();
      if (c.ws) { try { c.ws.close(); } catch (e) {} c.ws = null; }
    };
    return c;
  }

  /* -------------------------------------------------------------------------
     8. APP FRAME CODECS — flat fixed offsets, LE, one scratch buffer per
     session direction (no JSON, no per-frame allocation on the send path).
     Decoders ignore trailing bytes (forward compat within a version).
     ------------------------------------------------------------------------- */
  const HELLO_CORE = 36, HELLO_LEN = 43, WELCOME_LEN = 23, PRES_LEN = 21, SNAP_ENTRY = 19, SNAP_MAX = 11;
  const TAG_RE = /^[A-Z0-9]{3}$/;
  const wTag = (s) => (TAG_RE.test(s) ? s : 'AAA');     // whitelist, never a strike
  function makeScratch() { const b = new ArrayBuffer(WIRE_MAX); return { u8: new Uint8Array(b), dv: new DataView(b) }; }

  // HELLO core is bytes 0..35 (as N1). Bytes 36..42 append role/caps/callsign
  // (addenda A/C/D). The proof is over (gPub,hostPub), independent of the body,
  // so appending fields is always safe. Decoders read trailing fields only if
  // present (shorter frame from an older client → defaults) and ignore any bytes
  // beyond byte 42 (forward compat).
  function encHello(s, o) {  // o: {tag,suit,hat,rejoin8?,wantP,proof16, role?, caps?, adjIdx?, nounIdx?}
    const u = s.u8, dv = s.dv;
    u[0] = A_HELLO; u[1] = PROTO; u[2] = PROTO;
    const tag = wTag(o.tag);
    for (let i = 0; i < 3; i++) u[3 + i] = tag.charCodeAt(i);
    u[6] = o.suit & 0xff; u[7] = o.hat & 0xff;
    u.fill(0, 8, 20);
    if (o.rejoin8) u.set(o.rejoin8, 8);
    u[16] = o.wantP & 0xff;
    u.set(o.proof16, 20);
    u[36] = (o.role == null ? ROLE_PLAYER : o.role) & 0xff;
    dv.setUint32(37, (o.caps == null ? CAPS : o.caps) >>> 0, true);
    u[41] = (o.adjIdx == null ? CALLSIGN_NONE : o.adjIdx) & 0xff;
    u[42] = (o.nounIdx == null ? CALLSIGN_NONE : o.nounIdx) & 0xff;
    return u.subarray(0, HELLO_LEN);
  }
  function decHello(pt) {
    if (pt.length < HELLO_CORE) return null;
    const dv = new DataView(pt.buffer, pt.byteOffset);
    let tag = '';
    for (let i = 0; i < 3; i++) tag += String.fromCharCode(pt[3 + i]);
    return {
      protoMin: pt[1], protoMax: pt[2], tag: wTag(tag), suit: pt[6], hat: pt[7],
      rejoin8: pt.slice(8, 16), wantP: pt[16], proof16: pt.slice(20, 36),
      role: pt.length >= 37 ? (pt[36] === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER) : ROLE_PLAYER,
      caps: pt.length >= 41 ? dv.getUint32(37, true) : 0,
      adjIdx: pt.length >= 42 ? pt[41] : CALLSIGN_NONE,
      nounIdx: pt.length >= 43 ? pt[42] : CALLSIGN_NONE,
    };
  }
  // WELCOME keeps its 23B length: hostEpoch (Addendum F.1) rides byte 15 and the
  // capability bitfield (Addendum D) bytes 16..19, both inside the old reserved
  // tail. Decoders default them when absent (older host).
  function encWelcome(s, o) { // o: {yourP,seed,runId,epoch,hostTag,rosterN,boardN,roomFlags, hostEpoch?, caps?}
    const u = s.u8, dv = s.dv;
    u[0] = A_WELCOME; u[1] = PROTO; u[2] = o.yourP;
    dv.setUint32(3, o.seed >>> 0, true);
    u[7] = o.runId & 0xff; u[8] = o.epoch & 0xff;
    const tag = wTag(o.hostTag);
    for (let i = 0; i < 3; i++) u[9 + i] = tag.charCodeAt(i);
    u[12] = o.rosterN & 0xff; u[13] = o.boardN & 0xff; u[14] = o.roomFlags & 0xff;
    u.fill(0, 15, WELCOME_LEN);
    u[15] = (o.hostEpoch || 0) & 0xff;
    dv.setUint32(16, (o.caps == null ? CAPS : o.caps) >>> 0, true);
    return u.subarray(0, WELCOME_LEN);
  }
  function decWelcome(pt) {
    if (pt.length < WELCOME_LEN) return null;
    const dv = new DataView(pt.buffer, pt.byteOffset);
    let tag = '';
    for (let i = 0; i < 3; i++) tag += String.fromCharCode(pt[9 + i]);
    return {
      proto: pt[1], yourP: pt[2], seed: dv.getUint32(3, true), runId: pt[7], epoch: pt[8],
      hostTag: wTag(tag), rosterN: pt[12], boardN: pt[13], roomFlags: pt[14],
      hostEpoch: pt[15], caps: dv.getUint32(16, true),
    };
  }
  function encPres(s, o) {   // o: {seq,x,y,vx,state,chain,score,dist,runId}
    const u = s.u8, dv = s.dv;
    u[0] = A_PRES;
    dv.setUint16(1, o.seq & 0xffff, true);
    dv.setFloat32(3, o.x, true); dv.setFloat32(7, o.y, true);
    dv.setInt8(11, Math.max(-127, Math.min(127, o.vx | 0)));
    u[12] = o.state & 0x1f; u[13] = Math.min(4, o.chain | 0);
    dv.setUint32(14, Math.min(9999999, o.score >>> 0), true);
    dv.setUint16(18, Math.min(60000, o.dist | 0), true);
    u[20] = o.runId & 0xff;
    return u.subarray(0, PRES_LEN);
  }
  // Presence validation: clamps render weird, never escalate; NaN is the one strike.
  function decPresBody(dv, u8, off, prev) {            // body starts at seq; prev = last accepted row or null
    const x = dv.getFloat32(off + 2, true), y = dv.getFloat32(off + 6, true);
    if (!isFinite(x) || !isFinite(y)) return { err: 'nan' };
    let score = dv.getUint32(off + 13, true), dist = dv.getUint16(off + 17, true);
    const runId = u8[off + 19];
    if (score > 9999999) score = 9999999;
    if (dist > 60000) dist = 60000;
    if (prev && prev.runId === runId) {                // per-runId monotonic (desync-tolerant)
      if (score < prev.score) score = prev.score;
      if (dist < prev.dist) dist = prev.dist;
    }
    return {
      seq: dv.getUint16(off, true),
      x: Math.max(-1e6, Math.min(4e6, x)), y: Math.max(-4000, Math.min(4000, y)),
      vx: dv.getInt8(off + 10), state: u8[off + 11] & 0x1f, chain: Math.min(4, u8[off + 12]),
      score, dist, runId,
    };
  }
  function decPres(pt, prev) {
    if (pt.length < PRES_LEN) return { err: 'short' };
    return decPresBody(new DataView(pt.buffer, pt.byteOffset), pt, 1, prev);
  }
  function encSnap(s, tick, rows) {                    // rows: [{p, pres}] ≤ SNAP_MAX
    const u = s.u8, dv = s.dv;
    u[0] = A_SNAP;
    dv.setUint16(1, tick & 0xffff, true);
    const n = Math.min(rows.length, SNAP_MAX);
    u[3] = n;
    let off = 4;
    for (let i = 0; i < n; i++) {
      const r = rows[i], q = r.pres;
      u[off] = r.p;
      dv.setFloat32(off + 1, q.x, true); dv.setFloat32(off + 5, q.y, true);
      dv.setInt8(off + 9, q.vx); u[off + 10] = q.state; u[off + 11] = q.chain;
      dv.setUint32(off + 12, q.score, true); dv.setUint16(off + 16, q.dist, true);
      u[off + 18] = q.runId;
      off += SNAP_ENTRY;
    }
    return u.subarray(0, off);
  }
  function decSnap(pt) {
    if (pt.length < 4) return null;
    const dv = new DataView(pt.buffer, pt.byteOffset);
    const tick = dv.getUint16(1, true), n = pt[3];
    if (n > SNAP_MAX || pt.length < 4 + n * SNAP_ENTRY) return null;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const off = 4 + i * SNAP_ENTRY;
      const p = pt[off];
      if (p < 1 || p > ROOM_CAP) continue;             // bad slot → drop entry, keep frame
      const x = dv.getFloat32(off + 1, true), y = dv.getFloat32(off + 5, true);
      if (!isFinite(x) || !isFinite(y)) continue;
      rows.push({
        p,
        x: Math.max(-1e6, Math.min(4e6, x)), y: Math.max(-4000, Math.min(4000, y)),
        vx: dv.getInt8(off + 9), state: pt[off + 10] & 0x1f, chain: Math.min(4, pt[off + 11]),
        score: Math.min(9999999, dv.getUint32(off + 12, true)),
        dist: Math.min(60000, dv.getUint16(off + 16, true)),
        runId: pt[off + 18],
      });
    }
    return { tick, rows };
  }

  // EMOTE (0x06 G→H) — body {emoteId u8, seq u8}. EMOTEB (0x16 H→all) — body
  // {P u8, emoteId u8, seq u8}. The guest's seq is advisory; the host stamps a
  // monotonic per-sender seq into EMOTEB so the renderer detects a fresh bubble
  // without any clear-state handshake. emoteId is validated (clamp 0..5) by the
  // host at RECEIPT, not merely at render.
  function encEmote(s, emoteId, seq) { const u = s.u8; u[0] = A_EMOTE; u[1] = emoteId & 0xff; u[2] = seq & 0xff; return u.subarray(0, 3); }
  function decEmote(pt) { return pt.length < 3 ? null : { emoteId: pt[1], seq: pt[2] }; }
  function encEmoteB(s, p, emoteId, seq) { const u = s.u8; u[0] = A_EMOTEB; u[1] = p & 0xff; u[2] = emoteId & 0xff; u[3] = seq & 0xff; return u.subarray(0, 4); }
  function decEmoteB(pt) { return pt.length < 4 ? null : { p: pt[1], emoteId: pt[2], seq: pt[3] }; }
  // BYE (0x09 H→G) — body {reason u8, detail u8}. reason: 0 kicked, 1 closed,
  // 2 rotated, 3 version, 4 full, 5 banned, 6 not approved.
  function encBye(s, reason, detail) { const u = s.u8; u[0] = A_BYE; u[1] = reason & 0xff; u[2] = (detail || 0) & 0xff; return u.subarray(0, 3); }
  function decBye(pt) { return pt.length < 3 ? null : { reason: pt[1], detail: pt[2] }; }
  // ROUND body (rides the control-frame envelope §8.5): seed u32, runId u8,
  // countdown u8, flags u8. Players adopt seed at their NEXT run start (never
  // yanks a live run); runId scopes the leaderboard + PRES monotonicity.
  function encRoundBody(seed, runId, countdown, flags) {
    const b = new Uint8Array(7);
    new DataView(b.buffer).setUint32(0, seed >>> 0, true);
    b[4] = runId & 0xff; b[5] = (countdown || 0) & 0xff; b[6] = (flags || 0) & 0xff;
    return b;
  }
  function decRoundBody(b) {
    if (!b || b.length < 5) return null;
    return { seed: new DataView(b.buffer, b.byteOffset).getUint32(0, true), runId: b[4], countdown: b.length > 5 ? b[5] : 0, flags: b.length > 6 ? b[6] : 0 };
  }

  /* -------------------------------------------------------------------------
     8.5 ROOM PROTOCOL LAYER (Run Together, addenda A/C/D/F/G) — callsigns,
     roster/role codecs, the ~20-line anti-cheat envelope, the control-frame
     epoch/seq envelope, and the hide/block drop set. Every codec ignores
     unknown trailing bytes and defaults missing ones (forward compat).
     ------------------------------------------------------------------------- */

  // --- Callsigns (Addendum C): the wire carries two u8 indexes, NEVER text —
  // free text is UNREPRESENTABLE. Out-of-range OR denied pair → P-number
  // fallback (null). Wordlists live in the shipped, versioned SpaceManCallsigns
  // (src/callsigns.js); a client with an older list shows P# for an unknown idx.
  const CALLSIGN_NONE = 0xff;                 // sentinel index = "no callsign, use P#"
  function callsignData() { return root.SpaceManCallsigns || null; }
  function callsignDenied(cs, a, n) {
    if (!cs.deny) return false;
    for (let i = 0; i < cs.deny.length; i++) if (cs.deny[i][0] === a && cs.deny[i][1] === n) return true;
    return false;
  }
  // Validator used at PICK time (UI, N2b) AND at display: text or null (→ P#).
  function callsignText(a, n) {
    const cs = callsignData();
    if (!cs || a === CALLSIGN_NONE || n === CALLSIGN_NONE) return null;
    if (!(a >= 0 && a < cs.adj.length && n >= 0 && n < cs.noun.length)) return null;   // out-of-range → P#
    if (callsignDenied(cs, a, n)) return null;                                          // denied pair → P#
    return cs.adj[a] + ' ' + cs.noun[n];
  }
  const callsignValid = (a, n) => callsignText(a, n) !== null;  // pick-time deny/range gate

  // --- Anti-cheat envelope (Addendum G.1 Layer 1): inequalities from the EXACT
  // sim constants, read READ-ONLY from index.html and cited here:
  //   index.html:566  STEP = 1/60               → 60 sim steps / second
  //   index.html:569  maxRun: 6.8               → ground/air horizontal cap (px/step)
  //   index.html:1931 clamp(...,9.5,...)         → star-boost horizontal cap (px/step)
  //   index.html:571  jumpVel:-13.2, maxFall:14  → vertical velocity bounds (px/step)
  //   index.html:583  "10px = 1m"                → distance unit (also index.html:1815)
  //   index.html:578-580 scoreStomp:30 … chainCap:4 (x16) → score-rate bound
  // A frame past the HARD teleport bound is fabricated → strike. A softer
  // dist/score-vs-time inconsistency → the row renders DIMMED "unverified"
  // (visible but discounted); never a strike — a laggy honest client must live.
  const AC = {
    VMAX_PX: 9.5 * 60,     // 570 px/s horizontal (boosted cap × 60 steps/s)
    VYMAX_PX: 14 * 60,     // 840 px/s vertical (terminal fall × 60)
    PX_PER_M: 10,
    SCORE_PER_M: 60,       // generous ceiling: ~6 max-mult events per metre
    TELEPORT_TOL: 4,       // ×tolerance before a position delta is "impossible"
    TELEPORT_SLACK: 1500,  // px slack (spawn, camera warp, interp) before hard-flag
    DIST_TOL: 1.35, DIST_SLACK: 50, SCORE_SLACK: 1000,
  };
  function checkEnvelope(prev, cur, dtMs) {   // → {teleport, unverified}
    const out = { teleport: false, unverified: false };
    const dt = Math.max(0.001, dtMs / 1000);
    if (prev) {
      const dx = Math.abs(cur.x - prev.x), dy = Math.abs(cur.y - prev.y);
      if (dx > AC.VMAX_PX * dt * AC.TELEPORT_TOL + AC.TELEPORT_SLACK ||
          dy > AC.VYMAX_PX * dt * AC.TELEPORT_TOL + AC.TELEPORT_SLACK) out.teleport = true;
    }
    if (cur.elapsedMs > 0) {                  // dist/score vs elapsed run time
      const es = cur.elapsedMs / 1000;
      if (cur.dist > es * (AC.VMAX_PX / AC.PX_PER_M) * AC.DIST_TOL + AC.DIST_SLACK) out.unverified = true;
      if (cur.score > cur.dist * AC.SCORE_PER_M + AC.SCORE_SLACK) out.unverified = true;
    }
    return out;
  }

  // --- Hide / Block drop set (Addendum G). ONE membership check at frame
  // receipt; zero cost when empty. BLOCK persistence shape (written under sm2.*
  // by the UI/integrator, M2): { pubkey:hex, callsign:[a,n], room:hex, ts:ms };
  // cap 512. HIDE is session-only, BLOCK persisted. Both drop frames on receipt.
  const droppedKeys = new Set();              // hex pubkeys silently dropped on receipt
  const blocklist = new Map();                // hex → {pubkey, callsign, room, ts}
  const BLOCK_CAP = 512;
  function hideKey(h) { if (h) droppedKeys.add(h); }
  function unhideKey(h) { if (!blocklist.has(h)) droppedKeys.delete(h); }
  function blockKey(h, meta) {
    if (!h || (blocklist.size >= BLOCK_CAP && !blocklist.has(h))) return false;
    blocklist.set(h, Object.assign({ pubkey: h, ts: Date.now() }, meta || {}));
    droppedKeys.add(h);
    return true;
  }
  function unblockKey(h) { blocklist.delete(h); droppedKeys.delete(h); }

  // --- ROSTER frame (0x03): host→all, chunked. Carries roles + callsigns
  // (addenda A & C). entry = P u8 | pub 32 | tag 3 | suit | hat | role | adjIdx |
  // nounIdx = 41B. count ≤ 5 (5×41+5 = 210B ≤ 229 plaintext cap). op: 0 full,
  // 1 join, 2 leave, 3 kick.
  const ROSTER_ENTRY = 41, ROSTER_MAX = 5;
  function encRoster(s, op, chunkIdx, chunkTot, entries) {
    const u = s.u8;
    u[0] = A_ROSTER; u[1] = op & 0xff; u[2] = chunkIdx & 0xff; u[3] = chunkTot & 0xff;
    const n = Math.min(entries.length, ROSTER_MAX); u[4] = n;
    let off = 5;
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      u[off] = e.p & 0xff; u.set(e.pub, off + 1);
      const tag = wTag(e.tag); for (let j = 0; j < 3; j++) u[off + 33 + j] = tag.charCodeAt(j);
      u[off + 36] = e.suit & 0xff; u[off + 37] = e.hat & 0xff;
      u[off + 38] = (e.role || 0) & 0xff;
      u[off + 39] = (e.adjIdx == null ? CALLSIGN_NONE : e.adjIdx) & 0xff;
      u[off + 40] = (e.nounIdx == null ? CALLSIGN_NONE : e.nounIdx) & 0xff;
      off += ROSTER_ENTRY;
    }
    return u.subarray(0, off);
  }
  function decRoster(pt) {   // → {op, chunkIdx, chunkTot, entries} | null
    if (pt.length < 5) return null;
    const op = pt[1];
    if (op > 3) return null;                                  // W: unknown op → drop frame
    const n = pt[4];
    if (n > ROSTER_MAX || pt.length < 5 + n * ROSTER_ENTRY) return null;   // S: count overrun
    const entries = [];
    for (let i = 0; i < n; i++) {
      const off = 5 + i * ROSTER_ENTRY;
      const p = pt[off];
      if (p < 1 || p > ROOM_CAP) continue;                   // bad slot → drop entry, keep frame
      let tag = '';
      for (let j = 0; j < 3; j++) tag += String.fromCharCode(pt[off + 33 + j]);
      entries.push({
        p, pub: pt.slice(off + 1, off + 33), tag: wTag(tag),
        suit: pt[off + 36], hat: pt[off + 37],
        role: pt[off + 38] === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER,
        adjIdx: pt[off + 39], nounIdx: pt[off + 40],
      });
    }
    return { op, chunkIdx: pt[2], chunkTot: pt[3], entries };
  }

  // --- ROLE frame (0x0c): guest→host request {seq u16, newRole u8}. Host
  // validates caps + rate (≤1/10s per key) then acks via the next ROSTER.
  function encRole(s, seq, newRole) {
    const u = s.u8, dv = s.dv;
    u[0] = A_ROLE; dv.setUint16(1, seq & 0xffff, true); u[3] = newRole & 0xff;
    return u.subarray(0, 4);
  }
  function decRole(pt) {
    if (pt.length < 4) return null;
    return { seq: new DataView(pt.buffer, pt.byteOffset).getUint16(1, true), newRole: pt[3] === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER };
  }

  // --- Control-frame epoch/seq envelope (Addendum F.1). Host-authoritative
  // control frames (roster acks now; the M2 move/handoff/migrate frames on the
  // reserved 0x40-0x7F range later) bind {roomId, hostEpoch, seq}. Payloads
  // still ride the pair AEAD (authenticity); this is the anti-replay /
  // anti-stale-crown layer. Guests reject stale epochs (DEAD ON ARRIVAL) and
  // non-monotonic seq. Handoff/migration increments hostEpoch.
  function encCtrl(s, type, roomId8, hostEpoch, seq, body) {
    const u = s.u8;
    u[0] = type; u.set(roomId8, 1); u[9] = hostEpoch & 0xff;
    new DataView(u.buffer).setUint32(10, seq >>> 0, true);
    if (body && body.length) u.set(body, 14);
    return u.subarray(0, 14 + (body ? body.length : 0));
  }
  function decCtrl(pt) {
    if (pt.length < 14) return null;
    return { type: pt[0], roomId: pt.slice(1, 9), hostEpoch: pt[9],
      seq: new DataView(pt.buffer, pt.byteOffset).getUint32(10, true), body: pt.slice(14) };
  }
  const makeCtrlGate = () => ({ epoch: 0, seq: -1 });
  function ctrlGate(gate, roomId8, myRoomId8, hostEpoch, seq) {   // true = fresh, false = stale/replay
    if (myRoomId8 && !ctEq(roomId8, myRoomId8)) return false;     // wrong room
    if (hostEpoch < gate.epoch) return false;                    // stale epoch → dead on arrival
    if (hostEpoch > gate.epoch) { gate.epoch = hostEpoch; gate.seq = -1; }  // handoff bumped epoch
    if (seq <= gate.seq) return false;                           // replay / reorder
    gate.seq = seq;
    return true;
  }

  // --- Make-before-break relay slots + guest-enforced mobility rate tables
  // (Addendum F). Move/handoff FLOWS are M2; these are the inert state-machine
  // hooks so index.html can wire call sites once (they never run in N2).
  const makeSlots = () => ({ active: null, pending: null, moves: [], handoffs: [], fails: [] });
  function mobilityGate(times, minInterval, now) {   // ≤1 per minInterval (move 5min / handoff 2min)
    const last = times.length ? times[times.length - 1] : -Infinity;
    return (now - last) >= minInterval;
  }
  function moveUnstable(slots, now) {                // 2 rejected/failed moves in 10 min → "unstable room"
    slots.fails = slots.fails.filter((t) => now - t < MOVE_FAIL_WINDOW);
    return slots.fails.length >= MOVE_FAIL_MAX;
  }
  const reconnectJitter = () => Math.random() * RECONNECT_JITTER;   // 0–2s stampede spread

  /* -------------------------------------------------------------------------
     9. SESSIONS — star topology. Host: accept proven HELLOs, fan out SNAP at
     10Hz (round-robin ≤ 11 entries). Guest: HELLO → WELCOME → presence loop.
     Strikes/bans: 3 protocol violations ban the key for the room lifetime.
     ------------------------------------------------------------------------- */
  const STRIKE_LIMIT = 3;
  const PRELIM_CAP = 1024;     // pre-join tracking rows; oldest evicted (key-rotation spray must not grow host memory)
  function emitter() {
    const subs = [];
    return {
      on: (cb) => { if (typeof cb === 'function') subs.push(cb); },
      emit: (ev, data) => { for (const cb of subs) { try { cb(ev, data || {}); } catch (e) {} } },
    };
  }

  function HostSession(opts) {   // opts: {relayHost, region, tag, suit, hat, code:boolean, expiryMin?, role?, adjIdx?, nounIdx?}
    const S = {
      isHost: true, keys: null, relay: null, codeRelay: null, code: null, codeKeys: null,
      roomId: null, secret: null, epoch: 0, hostEpoch: 0, ctrlSeq: 0, caps: CAPS, seed: 0, runId: 1,
      roster: new Map(),         // pubHex → {p, pub, tag, suit, hat, role, adjIdx, nounIdx, pair, pres, strikes, bucket, lastHello, helloN, unverified, lastRole, runT0}
      banned: new Set(), joinTimes: [], prelim: new Map(),
      approveJoins: opts.approve === true, pending: new Map(), selfEmoteSeq: 0,   // held joins (approve mode) + host self-emote seq
      p: 1, tag: wTag(opts.tag || 'AAA'), suit: opts.suit | 0, hat: opts.hat | 0,
      role: opts.role === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER,   // host may sit out while hosting
      adjIdx: opts.adjIdx == null ? CALLSIGN_NONE : opts.adjIdx & 0xff,
      nounIdx: opts.nounIdx == null ? CALLSIGN_NONE : opts.nounIdx & 0xff,
      self: { seq: 0, x: 0, y: 0, vx: 0, state: 0, chain: 0, score: 0, dist: 0, runId: 1 },
      ev: emitter(), tick: 0, snapTimer: null, rr: 0, slots: makeSlots(),
      out: makeScratch(), outSnap: makeScratch(), outRoster: makeScratch(),
      started: 0,
      invite: '', link: '', region: opts.region || '', relayHostName: '',
      codeReplies: 0, codeRepliesMin: 0, codeMinMark: 0,
    };
    // Separate caps (Addendum A): count players vs spectators across the roster.
    function counts() {
      let players = S.role === ROLE_SPECTATOR ? 0 : 1, spectators = S.role === ROLE_SPECTATOR ? 1 : 0;
      for (const r of S.roster.values()) { if (r.role === ROLE_SPECTATOR) spectators++; else players++; }
      return { players, spectators };
    }

    function strike(row, why) {
      row.strikes++;
      S.ev.emit('strike', { p: row.p, why, strikes: row.strikes });
      if (row.strikes >= STRIKE_LIMIT) {
        S.banned.add(hex(row.pub));
        S.roster.delete(hex(row.pub));
        S.ev.emit('banned', { p: row.p });
      }
    }

    async function onPacket(srcPub, wire) {
      const key = hex(srcPub);
      if (S.banned.has(key)) return;                             // banned keys get silence, forever
      if (droppedKeys.has(key)) return;                          // hidden/blocked key (Addendum G): one check, dropped on receipt
      if (wire.length > WIRE_MAX) {                              // oversize strikes pre-decrypt, known key or not
        const r = S.roster.get(key);
        if (r) strike(r, 'size');
        else {
          let pre = S.prelim.get(key);
          if (!pre) { pre = { lastHello: -Infinity, helloN: 0, strikes: 0 }; prelimSet(key, pre); }
          preStrike(key, pre);
        }
        return;
      }
      const row = S.roster.get(key);
      if (!row) return joinAttempt(srcPub, key, wire);
      const res = await openApp(row.pair, wire);
      if (res.err) return strike(row, res.err);
      const pt = res.pt;
      if (!pt.length) return;
      // Frame-type partition (Addendum D): reserved (0x40-0x7F) & experimental
      // (0x80-0xFF) types are ignored silently and NEVER striked.
      if (pt[0] > FRAME_CORE_HI) return;
      // Host-only broadcast/control types never legitimately travel guest→host.
      // A guest emitting one is forging host authority (a fabricated kick /
      // new-world / roster / snap / emote-broadcast) → strike. The pair AEAD
      // already proved WHICH guest sent it; this refuses the forged ROLE.
      if (pt[0] === A_WELCOME || pt[0] === A_ROSTER || pt[0] === A_SNAP ||
          pt[0] === A_BYE || pt[0] === A_ROUND || pt[0] === A_EMOTEB) return strike(row, 'host-frame');
      if (pt[0] === A_EMOTE) {                                   // guest emote (spectators MAY emote, §4.6/Addendum A)
        const em = decEmote(pt);
        if (!em) return;
        if (em.emoteId > EMOTE_MAX) return;                     // clamp 0..5 AT RECEIPT: out-of-range dropped (no strike)
        // EMOTE token bucket: burst 3, refill 1 per 2s. Over-rate → drop, NO
        // strike (mashing is human, §3.4). Bucket seeded full at admit.
        const te = performance.now();
        row.emoteBucket = Math.min(3, row.emoteBucket + (te - row.emoteBucketT) / 2000);
        row.emoteBucketT = te;
        if (row.emoteBucket < 1) return;
        row.emoteBucket -= 1;
        // Attribute to the SENDER's P# (the guest cannot forge another peer's id
        // — P# comes from the authenticated pair's roster row, not the payload)
        // and surface it via the host's own presence() projection.
        row.emoteSeq = (row.emoteSeq | 0) + 1;
        row.emoteId = em.emoteId;
        broadcastEmoteB(row.p, em.emoteId, row.emoteSeq).catch(() => {});
        // Symmetric with the guest EMOTEB path (§4.6): emit locally so a host
        // client surfaces peer emotes too — incl. spectators, whose presence()
        // row is null (positionless) so no world bubble ever draws for them.
        S.ev.emit('emote', { p: row.p, id: em.emoteId, seq: row.emoteSeq });
        return;
      }
      if (pt[0] === A_PRES) {
        // Spectators are keepalive-only (Addendum A): a presence frame from a
        // spectator is a protocol violation → strike.
        if (row.role === ROLE_SPECTATOR) return strike(row, 'spectator-pres');
        // token bucket 14/s burst 20 — over-rate frames drop without a strike
        const t = performance.now();
        row.bucket = Math.min(20, row.bucket + (t - row.bucketT) * 0.014);
        row.bucketT = t;
        if (row.bucket < 1) return;
        row.bucket -= 1;
        const pres = decPres(pt, row.pres);
        if (pres.err === 'nan') return strike(row, 'nan');
        if (pres.err) return;
        // Anti-cheat envelope (Addendum G.1): hard teleport → strike; soft
        // dist/score-vs-time inconsistency → dim the row "unverified" (no strike).
        // New run → fresh trace: reset the run clock AND the dim flag (the
        // unverified mark discounts a TRACE, not a key — a laggy honest blip
        // must not dim a player forever; a cheater re-dims within one frame).
        if (row.runT0 == null || pres.runId !== row.runId) { row.runT0 = t; row.runId = pres.runId; row.unverified = false; }
        pres.elapsedMs = t - row.runT0;
        const env = checkEnvelope(row.pres, pres, row.lastSeen ? t - row.lastSeen : 0);
        if (env.teleport) return strike(row, 'teleport');
        if (env.unverified) row.unverified = true;
        row.pres = pres;
        row.lastSeen = t;
        return;
      }
      if (pt[0] === A_ROLE) {                                    // role change request (Addendum A)
        const rc = decRole(pt);
        if (!rc) return;
        const t3 = performance.now();
        if (row.lastRole && t3 - row.lastRole < ROLE_MIN_INTERVAL) return;   // ≤1/10s per key
        const c = counts();
        if (rc.newRole === ROLE_SPECTATOR && row.role !== ROLE_SPECTATOR && c.spectators >= SPECTATOR_CAP) return;
        if (rc.newRole === ROLE_PLAYER && row.role !== ROLE_PLAYER && c.players >= PLAYER_CAP) return;
        row.lastRole = t3;
        if (row.role !== rc.newRole) {
          row.role = rc.newRole;
          if (rc.newRole === ROLE_SPECTATOR) row.pres = null;   // spectators hide their ghost
          S.ev.emit('role', { p: row.p, role: row.role });
          sendRoster(0).catch(() => {});                        // ack via roster broadcast
        }
        return;
      }
      if (pt[0] === A_HELLO) {                                   // reconnect re-hello: verify proof, re-WELCOME
        const t2 = performance.now();
        if (row.lastHello && t2 - row.lastHello < 5000) return;
        row.lastHello = t2;
        const h = decHello(pt);
        if (!h) return strike(row, 'short');
        const want = joinProof(S.secret, S.roomId, S.epoch, row.pub, S.keys.pub);
        if (!ctEq(want, h.proof16)) return strike(row, 'proof');
        const w = encWelcome(S.out, {
          yourP: row.p, seed: S.seed, runId: S.runId, epoch: S.epoch, hostEpoch: S.hostEpoch, caps: S.caps,
          hostTag: S.tag, rosterN: S.roster.size + 1, boardN: 0, roomFlags: 0,
        });
        S.relay.send(row.pub, await sealApp(row.pair, w));
        return;
      }
      /* unknown core app type: ignore silently (forward compat) */
    }

    async function joinAttempt(srcPub, key, wire) {
      // Pre-roster rate limits: HELLO 1/5s per key, joins 10/min per room.
      const t = performance.now();
      let pre = S.prelim.get(key);
      if (!pre) { pre = { lastHello: -Infinity, helloN: 0, strikes: 0 }; prelimSet(key, pre); }   // first hello always eligible
      if (t - pre.lastHello < 5000 || pre.helloN >= 5) return;
      pre.lastHello = t; pre.helloN++;
      S.joinTimes = S.joinTimes.filter((x) => t - x < 60000);
      if (S.joinTimes.length >= 10) return;
      const pair = makePair(await derivePairKey(S.keys, srcPub, S.roomId, S.epoch), S.roomId, S.epoch, DIR_H2G);
      const res = await openApp(pair, wire);
      if (res.err || !res.pt.length || res.pt[0] !== A_HELLO) { preStrike(key, pre); return; }
      const h = decHello(res.pt);
      if (!h || h.protoMin > h.protoMax) { preStrike(key, pre); return; }
      if (h.protoMin > PROTO || h.protoMax < PROTO) return;      // version gap → BYE(3) in N2; drop for now
      const want = joinProof(S.secret, S.roomId, S.epoch, srcPub, S.keys.pub);
      if (!ctEq(want, h.proof16)) { preStrike(key, pre); return; }   // silent: no oracle for secret-guessers
      // Separate caps (Addendum A): 32 players + 16 spectators, checked by role.
      const c = counts();
      if (h.role === ROLE_SPECTATOR ? c.spectators >= SPECTATOR_CAP : c.players >= PLAYER_CAP) return;  // full → BYE(4) in N2
      S.joinTimes.push(t);
      // Approve-mode (Addendum G / §2.6): hold the proven join; the host UI shows
      // "X wants to join [✓][✕]" and calls approve(pubHex, ok). The join is fully
      // authenticated (proof verified) — approval gates ADMISSION, not identity.
      if (S.approveJoins) {
        if (!S.pending.has(key)) {
          S.pending.set(key, { srcPub: srcPub.slice(), h, pair });
          S.ev.emit('approve-wait', { pubHex: key, tag: h.tag, role: h.role });
        }
        S.prelim.delete(key);
        return;
      }
      await admitJoin(srcPub, key, h, pair);
    }
    // Roster insert + WELCOME + join-announce. Shared by the immediate join path
    // and approve() (an admitted held join). Re-checks caps at admit time — a
    // queue delay may have filled the room.
    async function admitJoin(srcPub, key, h, pair) {
      const c = counts();
      if (h.role === ROLE_SPECTATOR ? c.spectators >= SPECTATOR_CAP : c.players >= PLAYER_CAP) return false;
      const t = performance.now();
      let p = 2;
      const used = new Set([1]);
      for (const r of S.roster.values()) used.add(r.p);
      while (used.has(p)) p++;
      const row = {
        p, pub: srcPub.slice(), tag: h.tag, suit: h.suit, hat: h.hat,
        role: h.role, adjIdx: h.adjIdx, nounIdx: h.nounIdx, caps: h.caps, pair,
        pres: null, strikes: 0, lastSeen: t, bucket: 20, bucketT: t,
        emoteBucket: 3, emoteBucketT: t, emoteId: 0, emoteSeq: 0,
        unverified: false, lastRole: 0, runT0: null, runId: S.runId,
      };
      S.roster.set(key, row);
      S.prelim.delete(key);
      const w = encWelcome(S.out, {
        yourP: p, seed: S.seed, runId: S.runId, epoch: S.epoch, hostEpoch: S.hostEpoch, caps: S.caps,
        hostTag: S.tag, rosterN: S.roster.size + 1, boardN: 0, roomFlags: (S.approveJoins ? 1 : 0),
      });
      S.relay.send(row.pub, await sealApp(row.pair, w));
      S.ev.emit('join', { p, tag: row.tag, role: row.role });
      sendRoster(1, [row]).catch(() => {});                      // announce the new member to everyone
      return true;
    }
    function prelimSet(key, pre) {                                 // bounded: evict oldest under key spray
      if (S.prelim.size >= PRELIM_CAP) S.prelim.delete(S.prelim.keys().next().value);
      S.prelim.set(key, pre);
    }
    function preStrike(key, pre) {
      pre.strikes++;
      if (pre.strikes >= STRIKE_LIMIT) { S.banned.add(key); S.prelim.delete(key); S.ev.emit('banned', { p: 0 }); }
    }

    // Host self roster entry (P1) + a snapshot of the whole roster with roles &
    // callsigns (addenda A/C). Used for ROSTER fan-out.
    function selfEntry() {
      return { p: 1, pub: S.keys.pub, tag: S.tag, suit: S.suit, hat: S.hat, role: S.role, adjIdx: S.adjIdx, nounIdx: S.nounIdx };
    }
    function allEntries() {
      const out = [selfEntry()];
      for (const r of S.roster.values()) out.push({ p: r.p, pub: r.pub, tag: r.tag, suit: r.suit, hat: r.hat, role: r.role, adjIdx: r.adjIdx, nounIdx: r.nounIdx });
      return out.sort((a, b) => a.p - b.p);
    }
    // ROSTER fan-out (op 0 full / 1 join / 2 leave / 3 kick), chunked ≤ 5/entry,
    // sealed per peer. Roster carries roles + callsigns.
    async function sendRoster(op, entriesOpt) {
      if (!S.relay || S.relay.state !== 'established') return;
      const entries = entriesOpt || (op === 0 ? allEntries() : []);
      const chunks = [];
      for (let i = 0; i < entries.length; i += ROSTER_MAX) chunks.push(entries.slice(i, i + ROSTER_MAX));
      if (!chunks.length) chunks.push([]);
      for (let ci = 0; ci < chunks.length; ci++) {
        const pt = encRoster(S.outRoster, op, ci, chunks.length, chunks[ci]).slice();
        for (const r of S.roster.values()) S.relay.send(r.pub, await sealApp(r.pair, pt));
      }
    }

    // Emote re-broadcast (H→all): one encode, n seals. Fans the sender's P# +
    // clamped id + host-stamped seq to every peer (incl. the sender, whose UI
    // already self-echoed). Spectators are legitimate emote sources.
    async function broadcastEmoteB(p, emoteId, seq) {
      if (!S.relay || S.relay.state !== 'established') return;
      const pt = encEmoteB(S.out, p, emoteId, seq).slice();
      for (const r of S.roster.values()) S.relay.send(r.pub, await sealApp(r.pair, pt));
    }
    // ROUND (new-world) broadcast — rides the host-epoch/seq control envelope so
    // a guest CANNOT forge or replay it: encCtrl binds {roomId, hostEpoch, seq}
    // under the pair AEAD, guests validate via ctrlGate before adopting.
    async function broadcastRound(countdown) {
      if (!S.relay || S.relay.state !== 'established') return;
      const body = encRoundBody(S.seed, S.runId, countdown, 0);
      const pt = encCtrl(S.out, A_ROUND, S.roomId, S.hostEpoch, ++S.ctrlSeq, body).slice();
      for (const r of S.roster.values()) S.relay.send(r.pub, await sealApp(r.pair, pt));
    }

    async function snapTick() {
      if (S.relay.state !== 'established') return;
      S.tick = (performance.now() - S.started) | 0;
      const live = [];
      for (const r of S.roster.values()) if (r.pres && r.role !== ROLE_SPECTATOR) live.push(r);
      const rows = S.role === ROLE_SPECTATOR ? [] : [{ p: 1, pres: S.self }];   // a sitting-out host streams no ghost
      for (let i = 0; i < live.length && rows.length < SNAP_MAX; i++) {
        rows.push({ p: live[(S.rr + i) % live.length].p, pres: live[(S.rr + i) % live.length].pres });
      }
      S.rr = live.length ? (S.rr + (SNAP_MAX - 1)) % live.length : 0;
      const pt = encSnap(S.outSnap, (S.tick >> 4) & 0xffff, rows);
      for (const r of S.roster.values()) {
        S.relay.send(r.pub, await sealApp(r.pair, pt));          // one encode, n seals
      }
      if (S.roster.size) S.ev.emit('snap-out', { n: rows.length, peers: S.roster.size });
    }

    function onCodePacket(srcPub, wire) {
      // ≤6 replies/min, ≤64/room-life; anything else is silence (blind-scan posture).
      const t = performance.now();
      if (t - S.codeMinMark > 60000) { S.codeMinMark = t; S.codeRepliesMin = 0; }
      if (S.codeReplies >= 64 || S.codeRepliesMin >= 6) return;
      const pt = openCode(wire, srcPub, S.codeKeys.priv);
      if (!pt || pt.length < 33 || pt[0] !== C_REQ) return;
      const tmpPub = pt.subarray(1, 33);
      if (!ctEq(tmpPub, srcPub)) return;                         // sealed pub must match relay src
      S.codeReplies++; S.codeRepliesMin++;
      const inv = utf8(S.invite);
      const body = new Uint8Array(3 + inv.length);
      body[0] = C_RESP;
      new DataView(body.buffer).setUint16(1, inv.length, true);
      body.set(inv, 3);
      S.codeRelay.send(srcPub, sealCode(body, srcPub, S.codeKeys.priv));
      S.ev.emit('code-reply', {});
    }

    S.open = async () => {
      S.keys = await genKeypair();
      S.roomId = rand(8);
      S.secret = rand(16);
      S.seed = new DataView(rand(4).buffer).getUint32(0, true);
      let region = null, relayHost = opts.relayHost || '';
      if (!relayHost) {
        region = opts.region ? regionOf(opts.region) : await pickRegion();
        if (!region) throw new Error('unknown region');
        S.region = region.code;
        relayHost = region.hosts[0];
      } else {
        S.region = opts.region || RELAY_MAP.regions[0].code;
      }
      S.relayHostName = relayHost;
      S.invite = encodeInvite({
        flags: (opts.relayHost ? 2 : 0), roomId: S.roomId, epoch: S.epoch, hostPub: S.keys.pub,
        region: S.region, relayHost: opts.relayHost || '', secret: S.secret,
        expiryMin: opts.expiryMin || Math.floor(Date.now() / 60000) + 1440,
      });
      S.link = 'https://picatz.github.io/space-man/#j=' + S.invite;
      S.started = performance.now();
      await new Promise((resolve, reject) => {
        let settled = false;
        S.relay = RelayClient(relayHost, S.keys, {
          onOpen: () => { if (!settled) { settled = true; resolve(); } S.ev.emit('state', { state: 'established' }); },
          onPacket, onRtt: (ms) => S.ev.emit('rtt', { ms }),
          onDown: (why) => { S.ev.emit('state', { state: 'down', why }); },
          onPeerGone: () => {},
          onLog: (m) => S.ev.emit('log', { m }),
        });
        S.relay.connect();
        setTimeout(() => { if (!settled) { settled = true; reject(new Error('relay connect failed')); } }, T_CONNECT + T_HANDSHAKE);
      });
      if (opts.code !== false) {
        S.code = randomCode();
        S.codeKeys = codeKeypair(S.region, S.code);
        S.codeRelay = RelayClient(relayHost, S.codeKeys, {
          onOpen: () => S.ev.emit('code-live', { code: S.code }),
          onPacket: onCodePacket, onRtt: () => {}, onDown: () => {}, onPeerGone: () => {}, onLog: () => {},
        });
        S.codeRelay.connect();
      }
      S.snapTimer = setInterval(() => { snapTick().catch(() => {}); }, 100);   // 10Hz fan-out
      return S;
    };
    S.setPresence = (x, y, vx, state, chain, score, dist) => {
      const s = S.self;
      s.seq = (s.seq + 1) & 0xffff;
      s.x = x; s.y = y; s.vx = Math.max(-127, Math.min(127, vx | 0));
      s.state = state & 0x1f; s.chain = Math.min(4, chain | 0);
      s.score = Math.min(9999999, score >>> 0); s.dist = Math.min(60000, dist | 0); s.runId = S.runId;
    };
    // Presence + session-board projections for the render stage (N3). Read-only
    // views over host state — self (P1) plus each roster runner's last accepted
    // PRES. Spectators contribute no ghost (pres stays null / role-hidden).
    // board() accumulates per-P session bests (score/dist/chain), monotonic, and
    // carries the "unverified" dim (Layer-1 anti-cheat, G.1).
    S._board = new Map();
    function boardBump(p, callsign, score, dist, chain, unverified) {
      let b = S._board.get(p);
      if (!b) { b = { p, callsign, bestScore: 0, bestDist: 0, bestChain: 0, unverified: false }; S._board.set(p, b); }
      b.callsign = callsign;
      if (score > b.bestScore) b.bestScore = score;
      if (dist > b.bestDist) b.bestDist = dist;
      if (chain > b.bestChain) b.bestChain = chain;
      b.unverified = !!unverified;
    }
    S.presence = () => {
      const cs = (a, n, p) => callsignText(a, n) || ('P' + p);
      const out = [];
      const selfCall = cs(S.adjIdx, S.nounIdx, 1), sp = S.self;
      if (S.role !== ROLE_SPECTATOR && sp) {
        out.push({ p: 1, you: true, host: true, spectator: false, x: sp.x, y: sp.y, vx: sp.vx, state: sp.state, chain: sp.chain, score: sp.score, dist: sp.dist, runId: sp.runId, suit: S.suit, hat: S.hat, callsign: selfCall, unverified: false });
        boardBump(1, selfCall, sp.score, sp.dist, sp.chain, false);
      }
      for (const r of S.roster.values()) {
        const call = cs(r.adjIdx, r.nounIdx, r.p);
        if (r.pres && r.role !== ROLE_SPECTATOR) {
          const q = r.pres;
          out.push({ p: r.p, you: false, host: false, spectator: false, x: q.x, y: q.y, vx: q.vx, state: q.state, chain: q.chain, score: q.score, dist: q.dist, runId: q.runId, suit: r.suit, hat: r.hat, callsign: call, unverified: !!r.unverified, emoteId: r.emoteId, emoteSeq: r.emoteSeq });
          boardBump(r.p, call, q.score, q.dist, q.chain, r.unverified);
        }
      }
      return out;
    };
    S.board = () => Array.from(S._board.values()).sort((a, b) => b.bestScore - a.bestScore);
    S.myP = () => 1;
    // Host sits out / rejoins (Addendum A: administration ≠ participation).
    S.setRole = (role) => { S.role = role === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER; sendRoster(0).catch(() => {}); };
    S.setCallsign = (a, n) => { S.adjIdx = a & 0xff; S.nounIdx = n & 0xff; sendRoster(0).catch(() => {}); };
    S.sendRoster = sendRoster; S.counts = counts;

    // --- HOST CONTROL (§4.4 room card). All authenticated as coming from the
    // current host by construction: broadcasts ride the pair AEAD (only host+peer
    // share the key) and, for adopt-frames (new-world), the epoch/seq control
    // envelope on top. Guests reject anything not from the host key (I12) and any
    // stale/replayed control frame (ctrlGate) — a guest can forge none of these.

    // Emote from the host itself: authoritative, so fan EMOTEB(p=1) directly. The
    // UI self-echo is owned by NET.emote(); this shows the host's bubble to guests.
    S.sendEmote = (id) => {
      const e = id | 0;
      if (e < 0 || e > EMOTE_MAX) return;
      S.selfEmoteSeq = (S.selfEmoteSeq + 1) & 0xffff;
      broadcastEmoteB(1, e, S.selfEmoteSeq).catch(() => {});
    };
    // Kick (§4.4, Addendum G): ban the key for the room lifetime (survives
    // reconnect — the ban set is checked FIRST in onPacket, forever), BYE(0) the
    // target on its own pair, drop it from the roster, and announce op:3 to the
    // rest. The rotate-link prompt ("cut the link so they can't return?") is a UI
    // concern the caller drives next.
    S.kick = async (pubOrP) => {
      let row = null;
      if (typeof pubOrP === 'number') { for (const r of S.roster.values()) if (r.p === pubOrP) { row = r; break; } }
      else if (typeof pubOrP === 'string') row = S.roster.get(pubOrP) || null;
      if (!row) return false;
      const key = hex(row.pub);
      S.banned.add(key);                                          // room-lifetime key ban (I17)
      try { S.relay.send(row.pub, await sealApp(row.pair, encBye(S.out, 0, 0).slice())); } catch (e) {}   // BYE(kicked)
      S.roster.delete(key);
      S.ev.emit('kick', { p: row.p });
      await sendRoster(3, [{ p: row.p, pub: row.pub, tag: row.tag, suit: row.suit, hat: row.hat, role: row.role, adjIdx: row.adjIdx, nounIdx: row.nounIdx }]).catch(() => {});
      return true;
    };
    // New link / rotate (D8, I16): bump the PAIR epoch + issue a fresh secret so
    // prior invites & proofs go stale for FUTURE joins; existing members keep
    // their vetted pair keys (we never re-derive them). A fresh code + code
    // keypair replaces the old listener. Returns the fresh invite for the card.
    S.rotateLink = () => {
      S.epoch = (S.epoch + 1) & 0xff;
      S.secret = rand(16);
      if (opts.code !== false) {
        S.code = randomCode();
        S.codeKeys = codeKeypair(S.region, S.code);
        if (S.codeRelay) {                                        // reopen the listener on the new key (live only)
          try { S.codeRelay.close(); } catch (e) {}
          S.codeRelay = RelayClient(S.relayHostName, S.codeKeys, {
            onOpen: () => S.ev.emit('code-live', { code: S.code }),
            onPacket: onCodePacket, onRtt: () => {}, onDown: () => {}, onPeerGone: () => {}, onLog: () => {},
          });
          S.codeRelay.connect();
        }
      }
      S.invite = encodeInvite({
        flags: (opts.relayHost ? 2 : 0), roomId: S.roomId, epoch: S.epoch, hostPub: S.keys.pub,
        region: S.region || RELAY_MAP.regions[0].code, relayHost: opts.relayHost || '', secret: S.secret,
        expiryMin: opts.expiryMin || Math.floor(Date.now() / 60000) + 1440,
      });
      S.link = 'https://picatz.github.io/space-man/#j=' + S.invite;
      S.ev.emit('rotated', { epoch: S.epoch, code: S.code, link: S.link });
      return { link: S.link, code: S.code, epoch: S.epoch };
    };
    // New world (D7): pick a fresh seed + runId and broadcast ROUND. Players adopt
    // the seed at their NEXT run start (a live run is never yanked); runId scopes
    // the leaderboard + PRES monotonicity from here on.
    S.newWorld = () => {
      S.seed = new DataView(rand(4).buffer).getUint32(0, true);
      S.runId = S.runId >= 255 ? 1 : S.runId + 1;                 // u8, never 0 (0 = unknown → render-only ghost)
      S.self.runId = S.runId;
      broadcastRound(0).catch(() => {});
      S.ev.emit('world', { seed: S.seed, runId: S.runId });
      return { seed: S.seed, runId: S.runId };
    };
    // Approve a held join (approve-mode). ok=false rejects with BYE(6). The
    // pending peer was already proof-verified; this only gates admission.
    S.approve = async (pubHex, ok) => {
      const key = typeof pubHex === 'string' ? pubHex : null;
      if (!key) return false;
      const pend = S.pending.get(key);
      if (!pend) return false;
      S.pending.delete(key);
      if (ok === false) {
        try { S.relay.send(pend.srcPub, await sealApp(pend.pair, encBye(S.out, 6, 0).slice())); } catch (e) {}
        S.ev.emit('reject', { pubHex: key });
        return true;
      }
      return admitJoin(pend.srcPub, key, pend.h, pend.pair);
    };
    S.setApprove = (on) => { S.approveJoins = !!on; };
    S._onPacket = onPacket; S._onCodePacket = onCodePacket;   // harness seam (offline drive; underscore = not a contract)
    S.close = () => {
      if (S.snapTimer) clearInterval(S.snapTimer);
      if (S.relay) S.relay.close();
      if (S.codeRelay) S.codeRelay.close();
    };
    return S;
  }

  function GuestSession(inv, opts) {   // inv from decodeInvite; opts: {tag, suit, hat, hz, role, adjIdx, nounIdx}
    const S = {
      isHost: false, keys: null, relay: null, inv, welcomed: null,
      p: 0, tag: wTag(opts.tag || 'AAA'), suit: opts.suit | 0, hat: opts.hat | 0,
      role: opts.role === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER,
      adjIdx: opts.adjIdx == null ? CALLSIGN_NONE : opts.adjIdx & 0xff,
      nounIdx: opts.nounIdx == null ? CALLSIGN_NONE : opts.nounIdx & 0xff,
      caps: 0, hostEpoch: 0, gate: makeCtrlGate(), rosterMap: new Map(),   // p → {tag,suit,hat,role,adjIdx,nounIdx,you}
      pair: null, peers: new Map(),    // p → latest snap row
      ev: emitter(), out: makeScratch(), seq: 0, roleSeq: 0, emoteSeq: 0, hostHex: hex(inv.hostPub),
      helloTimer: null, slots: makeSlots(), byed: null,
    };

    async function sendHello() {
      const proof = joinProof(S.inv.secret, S.inv.roomId, S.inv.epoch, S.keys.pub, S.inv.hostPub);
      const pt = encHello(S.out, {
        tag: S.tag, suit: S.suit, hat: S.hat, wantP: 0, proof16: proof,
        role: S.role, caps: CAPS, adjIdx: S.adjIdx, nounIdx: S.nounIdx,
      });
      S.relay.send(S.inv.hostPub, await sealApp(S.pair, pt));
    }
    function helloLoop() {                             // relay may drop a hello (host busy/limits): retry until WELCOME
      if (S.helloTimer) clearInterval(S.helloTimer);
      let tries = 1;
      sendHello().catch(() => {});
      S.helloTimer = setInterval(() => {
        if (S.welcomed || tries >= 5) { clearInterval(S.helloTimer); S.helloTimer = null; return; }
        tries++;
        sendHello().catch(() => {});
      }, 5500);                                        // outside the host's 1-per-5s hello limiter
    }
    async function onPacket(srcPub, wire) {
      const key = hex(srcPub);
      if (key !== S.hostHex) return;                             // guests hear the host only (I12)
      if (droppedKeys.has(key)) return;                          // blocked host (Addendum G): dropped on receipt
      const res = await openApp(S.pair, wire);
      if (res.err) { S.ev.emit('drop', { why: res.err }); return; }
      const pt = res.pt;
      if (!pt.length) return;
      if (pt[0] > FRAME_CORE_HI) return;                         // reserved/experimental: ignore, never strike (Addendum D)
      if (pt[0] === A_WELCOME) {
        const w = decWelcome(pt);
        if (!w || w.proto !== PROTO) return;
        S.welcomed = w; S.p = w.yourP; S.caps = w.caps;
        // Adopt the host epoch MONOTONICALLY (Addendum F.1): a WELCOME must
        // never rewind the control gate — a downgrade would resurrect control
        // frames the stale-epoch rule already declared dead on arrival.
        if (w.hostEpoch > S.hostEpoch) S.hostEpoch = w.hostEpoch;
        if (w.hostEpoch > S.gate.epoch) S.gate.epoch = w.hostEpoch;
        S.ev.emit('welcomed', { p: w.yourP, seed: w.seed, runId: w.runId, hostTag: w.hostTag, rosterN: w.rosterN, caps: w.caps, hostEpoch: w.hostEpoch });
        return;
      }
      if (pt[0] === A_ROSTER) {                                  // roster with roles + callsigns (addenda A/C)
        const r = decRoster(pt);
        if (!r) return;
        if (r.op === 2 || r.op === 3) { for (const e of r.entries) S.rosterMap.delete(e.p); }
        else for (const e of r.entries) S.rosterMap.set(e.p, {
          tag: e.tag, suit: e.suit, hat: e.hat, role: e.role, adjIdx: e.adjIdx, nounIdx: e.nounIdx,
          callsign: callsignText(e.adjIdx, e.nounIdx), you: e.p === S.p,
        });
        // Adopt OUR host-confirmed role (the roster IS the role-change ack,
        // Addendum A). Never assume player locally before this ack: a guest
        // streaming PRES while the host still holds it as spectator would eat
        // spectator-pres strikes → ban an honest client on a rejected request.
        const me = S.p ? S.rosterMap.get(S.p) : null;
        if (me) S.role = me.role;
        S.ev.emit('roster', { op: r.op, n: S.rosterMap.size });
        return;
      }
      if (pt[0] === A_SNAP) {
        const snap = decSnap(pt);
        if (!snap) return;
        for (const row of snap.rows) {
          const prev = S.peers.get(row.p);                       // carry the transient emote across position updates
          if (prev) { row.emoteId = prev.emoteId; row.emoteSeq = prev.emoteSeq; }
          S.peers.set(row.p, row);
        }
        S.ev.emit('snap', { tick: snap.tick, n: snap.rows.length });
        return;
      }
      if (pt[0] === A_EMOTEB) {                                  // host emote fan-out → this peer's bubble
        const eb = decEmoteB(pt);
        if (!eb || eb.emoteId > EMOTE_MAX) return;               // ignore out-of-range (defense in depth; host already clamped)
        let peer = S.peers.get(eb.p);
        if (!peer) { peer = { p: eb.p }; S.peers.set(eb.p, peer); }
        peer.emoteId = eb.emoteId; peer.emoteSeq = eb.seq;       // presence() surfaces {emoteId,emoteSeq} to the renderer
        S.ev.emit('emote', { p: eb.p, id: eb.emoteId, seq: eb.seq });
        return;
      }
      if (pt[0] === A_ROUND) {                                   // new-world: host-authenticated control envelope
        const cf = decCtrl(pt);
        if (!cf) return;
        // Anti-forge / anti-stale: wrong-room, stale hostEpoch, or replayed seq
        // are DEAD ON ARRIVAL (ctrlGate). Pair AEAD already proved it is the host.
        if (!ctrlGate(S.gate, cf.roomId, S.inv.roomId, cf.hostEpoch, cf.seq)) { S.ev.emit('drop', { why: 'ctrl-stale' }); return; }
        if (cf.hostEpoch > S.hostEpoch) S.hostEpoch = cf.hostEpoch;
        const rb = decRoundBody(cf.body);
        if (!rb) return;
        if (S.welcomed) { S.welcomed.seed = rb.seed; S.welcomed.runId = rb.runId; }   // adopted at NEXT run start (game side)
        S.ev.emit('round', { seed: rb.seed, runId: rb.runId, countdown: rb.countdown });
        return;
      }
      if (pt[0] === A_BYE) {                                     // host kicked us / closed / rotated
        const b = decBye(pt);
        if (!b) return;
        S.byed = b.reason;                                       // stop presence + hello retries; reason maps to a kind message
        if (S.helloTimer) { clearInterval(S.helloTimer); S.helloTimer = null; }
        S.ev.emit('bye', { reason: b.reason, detail: b.detail });
        return;
      }
      /* unknown core app type: ignore silently */
    }

    S.join = async () => {
      S.keys = await genKeypair();
      const region = regionOf(S.inv.region);
      const hosts = (S.inv.flags & 2) ? [S.inv.relayHost] : (region ? region.hosts : null);
      if (!hosts) throw new Error('unknown relay region — update to play together');
      S.pair = makePair(await derivePairKey(S.keys, S.inv.hostPub, S.inv.roomId, S.inv.epoch), S.inv.roomId, S.inv.epoch, DIR_G2H);
      let lastErr = null;
      for (const h of hosts) {
        try {
          await new Promise((resolve, reject) => {
            let settled = false;
            S.relay = RelayClient(h, S.keys, {
              onOpen: () => {
                if (!settled) { settled = true; resolve(); }
                helloLoop();                             // (re)connect always re-hellos
                S.ev.emit('state', { state: 'established' });
              },
              onPacket, onRtt: (ms) => S.ev.emit('rtt', { ms }),
              onDown: (why) => S.ev.emit('state', { state: 'down', why }),
              onPeerGone: () => {},
              onLog: (m) => S.ev.emit('log', { m }),
            });
            S.relay.connect();
            setTimeout(() => { if (!settled) { settled = true; reject(new Error('relay connect failed')); } }, T_CONNECT + T_HANDSHAKE);
          });
          lastErr = null;
          break;
        } catch (e) { lastErr = e; if (S.relay) S.relay.close(); S.relay = null; }
      }
      if (lastErr) throw lastErr;
      return S;
    };
    S.sendPresence = async (x, y, vx, state, chain, score, dist) => {
      if (!S.welcomed || !S.relay || S.relay.state !== 'established' || S.byed != null) return;
      if (S.role === ROLE_SPECTATOR) return;                     // spectators are keepalive-only (Addendum A)
      S.seq = (S.seq + 1) & 0xffff;
      const pt = encPres(S.out, {
        seq: S.seq, x, y, vx, state, chain, score, dist, runId: S.welcomed.runId,
      });
      S.relay.send(S.inv.hostPub, await sealApp(S.pair, pt));
    };
    // Emote → host (§4.6). Spectators MAY emote (no role gate). The host clamps,
    // rate-limits, and re-broadcasts EMOTEB; the local self-echo is owned by
    // NET.emote(). seq is advisory (host re-stamps its own into EMOTEB).
    S.sendEmote = async (id) => {
      if (!S.welcomed || !S.relay || S.relay.state !== 'established' || S.byed != null) return;
      const e = id | 0;
      if (e < 0 || e > EMOTE_MAX) return;
      S.emoteSeq = (S.emoteSeq + 1) & 0xff;
      S.relay.send(S.inv.hostPub, await sealApp(S.pair, encEmote(S.out, e, S.emoteSeq)));
    };
    // Request a role change (Addendum A). Host validates caps + rate; the switch
    // is acked via the next ROSTER broadcast. Only the SPECTATOR direction flips
    // optimistically (stopping presence early is always safe); the PLAYER
    // direction waits for the roster ack — sending PRES before the host applied
    // the change would be striked as spectator-pres (rate-limited / cap-full
    // requests are silently rejected by the host).
    S.requestRole = async (role) => {
      if (!S.welcomed || !S.relay || S.relay.state !== 'established') return;
      const nr = role === ROLE_SPECTATOR ? ROLE_SPECTATOR : ROLE_PLAYER;
      S.roleSeq = (S.roleSeq + 1) & 0xffff;
      if (nr === ROLE_SPECTATOR) S.role = ROLE_SPECTATOR;        // stop streaming a ghost at once
      S.relay.send(S.inv.hostPub, await sealApp(S.pair, encRole(S.out, S.roleSeq, nr)));
    };
    S.setCallsign = (a, n) => { S.adjIdx = a & 0xff; S.nounIdx = n & 0xff; };
    // Presence + session board for the render stage (N3). A guest projects the
    // host's SNAP fan-out (S.peers, p → last snap row) joined to the roster
    // identity (S.rosterMap). The local player's own P is flagged you:true so
    // the renderer never draws a ghost over the sprite drawPlayer already owns.
    S._board = new Map();
    function gBoardBump(p, callsign, score, dist, chain, unverified) {
      let b = S._board.get(p);
      if (!b) { b = { p, callsign, bestScore: 0, bestDist: 0, bestChain: 0, unverified: false }; S._board.set(p, b); }
      b.callsign = callsign;
      if (score > b.bestScore) b.bestScore = score;
      if (dist > b.bestDist) b.bestDist = dist;
      if (chain > b.bestChain) b.bestChain = chain;
      b.unverified = !!unverified;
    }
    S.presence = () => {
      const out = [];
      for (const [p, q] of S.peers) {
        const id = S.rosterMap.get(p) || {};
        if (id.role === ROLE_SPECTATOR) continue;               // spectators stream no ghost
        if (q.x == null) continue;                              // emote-only stub with no position yet → nothing to draw
        const call = id.callsign || ('P' + p);
        out.push({ p, you: p === S.p, host: p === 1, spectator: false, x: q.x, y: q.y, vx: q.vx, state: q.state, chain: q.chain, score: q.score, dist: q.dist, runId: q.runId, suit: id.suit || 0, hat: id.hat || 0, callsign: call, unverified: false, emoteId: q.emoteId, emoteSeq: q.emoteSeq });
        gBoardBump(p, call, q.score, q.dist, q.chain, false);
      }
      return out;
    };
    S.board = () => Array.from(S._board.values()).sort((a, b) => b.bestScore - a.bestScore);
    S.myP = () => S.p;
    S._onPacket = onPacket;                                    // harness seam (offline drive)
    S.close = () => {
      if (S.helloTimer) { clearInterval(S.helloTimer); S.helloTimer = null; }
      if (S.relay) S.relay.close();
    };
    return S;
  }

  // Short-code rendezvous: throwaway keypair asks the code listener for the invite.
  async function fetchInviteByCode(region, code, relayHostOverride) {
    const ck = codeKeypair(region, code);
    if (!ck) throw new Error('bad code');
    const rg = regionOf(region);
    const host = relayHostOverride || (rg && rg.hosts[0]);
    if (!host) throw new Error('unknown relay region — update to play together');
    const tmp = await genKeypair();
    return new Promise((resolve, reject) => {
      let done = false;
      const relay = RelayClient(host, tmp, {
        onOpen: () => {
          const body = cat(new Uint8Array([C_REQ]), tmp.pub);
          relay.send(ck.pub, sealCode(body, ck.pub, tmp.priv));
        },
        onPacket: (srcPub, wire) => {
          if (done || !ctEq(srcPub, ck.pub)) return;             // reply must come from the code key
          const pt = openCode(wire, ck.pub, tmp.priv);           // box authenticity pins the listener
          if (!pt || pt.length < 3 || pt[0] !== C_RESP) return;
          const n = new DataView(pt.buffer, pt.byteOffset).getUint16(1, true);
          if (n > 200 || pt.length < 3 + n) return;
          done = true;
          relay.close();
          resolve(td.decode(pt.subarray(3, 3 + n)));
        },
        onRtt: () => {}, onDown: () => {}, onPeerGone: () => {}, onLog: () => {},
      });
      relay.connect();
      setTimeout(() => { if (!done) { done = true; relay.close(); reject(new Error('no answer for that code')); } }, 10000);
    });
  }

  /* -------------------------------------------------------------------------
     10. PUBLIC SURFACE — window.SpaceManNet. Everything above is unreachable
     until one of the three entry points runs. Room UI, ghosts, emotes, and
     the mock arrive in later stages; their slots exist so integrators can
     wire call sites once.
     ------------------------------------------------------------------------- */
  let session = null;
  const ev = emitter();
  const NET = {
    active: false,
    mockActive: false,
    ghosts: null,                                     // Ghost[32] pool arrives with the render stage

    // Relay directory (Addendum E). Loads via SpaceManRelayDir's fallback ladder
    // and installs the result as the active map. mode: 'default'|'custom'|'list'.
    // Only called intentionally (host, settings) — fetch/localStorage stay lazy.
    async setRelayDirectory(mode, o) {
      const dir = root.SpaceManRelayDir;
      if (!dir) return { source: 'seed', regions: activeMap().regions.length };
      const r = await dir.load(Object.assign({ mode: mode || 'default', active: NET.active }, o || {}));
      setActiveMap(r.map);
      return { source: r.source, regions: r.map.regions.length };
    },
    relayDirectory() { const m = activeMap(); return { src: m.src, regions: m.regions.map((r) => ({ code: r.code, city: r.city, hosts: r.hosts.length })) }; },

    async openRoom(opts) {
      if (session) return NET.info();
      const o = opts || {};
      // Optional live directory refresh (host only) before picking a relay; the
      // baked copy already backs activeMap() so a failed fetch never blocks.
      if (o.relayDir) { try { await NET.setRelayDirectory(o.relayDir.mode, o.relayDir); } catch (e) {} }
      session = HostSession(o);
      session.ev.on((e, d) => ev.emit(e, d));
      await session.open();
      NET.active = true;
      return NET.info();
    },
    async acceptJoin(payloadStr, opts) {
      if (session) return NET.info();
      const dec = decodeInvite(payloadStr);
      if (dec.err) {
        const msg = dec.err === 'version' ? 'update to play together'
          : dec.err === 'expired' ? 'that invite has expired — ask for a fresh link'
          : 'that invite did not scan — ask for a fresh link';
        throw new Error(msg);
      }
      session = GuestSession(dec.inv, opts || {});
      session.ev.on((e, d) => ev.emit(e, d));
      await session.join();
      NET.active = true;
      return NET.info();
    },
    // Peek an invite's host key WITHOUT connecting — pure decode, no sockets,
    // keys, crypto, or storage (safe to call on the join prompt before the user
    // commits). Returns {hostHex, custom, region} for the local-blocklist gate
    // (§6) + custom-relay disclosure (F.1: joining IS directory consent), or
    // {err} for a malformed/expired link (the real acceptJoin surfaces copy).
    peekInvite(payloadStr) {
      const dec = decodeInvite(payloadStr);
      if (dec.err) return { err: dec.err };
      return { hostHex: hex(dec.inv.hostPub), custom: !!(dec.inv.flags & 2), region: dec.inv.region };
    },
    async enterCode(str, opts) {
      const o = opts || {};
      const region = o.region || (session ? session.region : null) || RELAY_MAP.regions[0].code;
      const invite = await fetchInviteByCode(region, str, o.relayHost);
      return NET.acceptJoin(invite, o);
    },
    leave() {
      if (session) session.close();
      session = null;
      NET.active = false;
      NET.mockActive = false;
    },
    // Host-control surface (§4.4 room card). No-ops for a guest session (only the
    // host holds these). kick/approve return a Promise<boolean>; rotateLink/
    // newWorld return the fresh {link,code,epoch} / {seed,runId} for the card.
    rotateLink() { return session && session.rotateLink ? session.rotateLink() : undefined; },
    newWorld() { return session && session.newWorld ? session.newWorld() : undefined; },
    kick(pubOrP) { return session && session.kick ? session.kick(pubOrP) : Promise.resolve(false); },
    approve(pubHex, ok) { return session && session.approve ? session.approve(pubHex, ok) : Promise.resolve(false); },
    setApprove(on) { if (session && session.setApprove) session.setApprove(on); },

    // Emote (Addendum §4.6). Clamp to the shipped set 0-5; record a local
    // self-echo the renderer reads for the immediate own-bubble, and best-effort
    // relay it (the EMOTE/EMOTEB wire lands with the emote-frame stage — until
    // then this is a local echo only, never a throw).
    emote(id) {
      const e = id | 0;
      if (e < 0 || e > 5) return;
      NET._selfEmote = { id: e, seq: (NET._emoteSeq = (NET._emoteSeq || 0) + 1) };
      if (session && session.sendEmote) { try { session.sendEmote(e); } catch (x) {} }
      return e;
    },

    // Roles (Addendum A). Host sits out via setRole; a guest requests via the
    // rate-limited role frame. spectator=1, player=0.
    setRole(role) {
      if (!session) return;
      if (session.isHost) session.setRole(role);
      else session.requestRole(role).catch(() => {});
    },
    // Callsigns (Addendum C) — indexes only; the picker uses the validator to
    // re-roll out-of-range / denied pairs. UI (N2b) owns the spinner.
    setCallsign(adjIdx, nounIdx) { if (session && session.setCallsign) session.setCallsign(adjIdx, nounIdx); },
    callsignValid(a, n) { return callsignValid(a, n); },
    callsignText(a, n) { return callsignText(a, n); },
    // Hide / Block (Addendum G). Accepts a hex pubkey; block persists shape for
    // the UI/integrator. droppedKeys is consulted at frame receipt (one check).
    hide(pubHex) { hideKey(pubHex); }, unhide(pubHex) { unhideKey(pubHex); },
    block(pubHex, meta) { return blockKey(pubHex, meta); }, unblock(pubHex) { unblockKey(pubHex); },
    blocklist() { return Array.from(blocklist.values()); },
    isDropped(pubHex) { return droppedKeys.has(pubHex); },

    sendPresence(px, py, vx, state, chain, score, dist) {
      if (!NET.active || !session) return;            // cheap no-op from the game tick when idle
      if (session.isHost) session.setPresence(px, py, vx, state, chain, score, dist);
      else session.sendPresence(px, py, vx, state, chain, score, dist).catch(() => {});
    },
    roster() {
      if (!session) return [];
      const cs = (a, n, p) => callsignText(a, n) || ('P' + p);   // P-number fallback (Addendum C)
      if (session.isHost) {
        const out = [{ p: 1, tag: session.tag, you: true, host: true, role: session.role, spectator: session.role === ROLE_SPECTATOR, callsign: cs(session.adjIdx, session.nounIdx, 1), unverified: false }];
        for (const r of session.roster.values()) out.push({
          p: r.p, tag: r.tag, role: r.role, spectator: r.role === ROLE_SPECTATOR,
          callsign: cs(r.adjIdx, r.nounIdx, r.p), unverified: !!r.unverified, dimmed: !!r.unverified,
          pubHex: r.pub ? hex(r.pub) : undefined,   // for the hide/block/kick sheet (§7); guests can't see peer pubs
        });
        return out.sort((a, b) => a.p - b.p);
      }
      const out = [];
      for (const [p, e] of session.rosterMap) out.push({
        p, tag: e.tag, role: e.role, spectator: e.role === ROLE_SPECTATOR,
        callsign: e.callsign || ('P' + p), you: p === session.p, host: p === 1,
      });
      if (!out.length) for (const p of session.peers.keys()) out.push({ p, you: p === session.p, callsign: 'P' + p });
      return out.sort((a, b) => a.p - b.p);
    },
    // Live ghost samples for the render pool (N3): [{p, you, host, spectator,
    // x, y, vx, state, chain, score, dist, runId, suit, hat, callsign,
    // unverified, emoteId, emoteSeq}]. Allocation-light; the pool + interpolation
    // live on the game side (drawPlayer reuse). Empty when idle.
    presence() { return session && session.presence ? session.presence() : []; },
    board() { return session && session.board ? session.board() : []; },   // session leaderboard (per-P bests)
    info() {
      if (!session) return { city: '', rttMs: 0, players: 0, spectators: 0, cap: ROOM_CAP, specCap: SPECTATOR_CAP, code: '', link: '', isHost: false, caps: CAPS, role: ROLE_PLAYER, hostEpoch: 0, myP: 0, seed: 0, runId: 0, unstable: false };
      const c = session.isHost && session.counts ? session.counts() : null;
      return {
        city: cityOfHost(session.isHost ? session.relayHostName : ((session.inv.flags & 2) ? session.inv.relayHost : (regionOf(session.inv.region) || { hosts: [''] }).hosts[0])),
        rttMs: session.relay ? Math.round(session.relay.rtt) : 0,
        players: c ? c.players : Math.max(1, session.peers.size),
        spectators: c ? c.spectators : 0,
        cap: PLAYER_CAP, specCap: SPECTATOR_CAP,
        code: session.code || '',
        link: session.link || '',
        isHost: !!session.isHost,
        caps: session.caps || CAPS,
        role: session.role,
        hostEpoch: session.hostEpoch || 0,
        myP: session.myP ? session.myP() : (session.isHost ? 1 : session.p || 0),
        // Room world (D7): the seed the game reads at startRun and the runId that
        // scopes the board. Host owns them; a guest mirrors WELCOME/ROUND.
        seed: (session.isHost ? session.seed : (session.welcomed ? session.welcomed.seed : 0)) >>> 0,
        runId: (session.isHost ? session.runId : (session.welcomed ? session.welcomed.runId : 0)) | 0,
        mobility: session.mobility || [],
        unstable: !!session.unstable,
      };
    },
    onEvent(cb) { ev.on(cb); },
    // #shot=room — offline, deterministic room-card fixture (net-spec §6.2).
    // Pure data: a fake host session the read-only getters (info/roster/board)
    // project exactly like a real one. Constructs NO sockets, keys, or timers;
    // wall-clock never read (rtt/link/code are literals). Safe to call once at
    // boot under SHOT === 'room' only; a no-op if a real session already exists.
    mock(seed, opts) {
      if (session) return;
      NET.mockActive = true;
      const scene = (opts && opts.scene) || 'card';
      // Roster: 5 entries (host + 4). One spectator, one out-of-range callsign
      // index (→ P-number fallback, pins I7/I8: the hostile tag never reaches
      // DOM — the card shows the P#), one unverified/dimmed (Layer-1 anti-cheat).
      const R = new Map();
      R.set('mk2', { p: 2, tag: 'BLU', suit: 1, hat: 0, role: ROLE_PLAYER, adjIdx: 2, nounIdx: 0, unverified: false });    // COMET FOX
      R.set('mk3', { p: 3, tag: 'MAX', suit: 2, hat: 1, role: ROLE_SPECTATOR, adjIdx: 1, nounIdx: 2, unverified: false }); // TURBO WOMBAT (watching)
      R.set('mk4', { p: 4, tag: '<b>!', suit: 250, hat: 0, role: ROLE_PLAYER, adjIdx: 250, nounIdx: 3, unverified: false });// out-of-range → PLAYER 4
      R.set('mk5', { p: 5, tag: 'REX', suit: 4, hat: 3, role: ROLE_PLAYER, adjIdx: 0, nounIdx: 3, unverified: true });     // LUCKY SPUTNIK (dimmed)
      const DUMMY_LINK = 'https://picatz.github.io/space-man/#j=AQBrYWctcm9vbS1tb2NrLWZpeGVkLWRldGVybWluaXN0aWMtcXItcGF5bG9hZC1kZW1v';
      // Deterministic in-run fixture (net-spec §6.2, addenda A/B/G.1). Ghost
      // positions are a closed-form phase-offset of a world anchor the game side
      // supplies (mockAnchor) — no rng stream is touched, so the worldgen budget
      // is untouched and #shot goldens stay stable. P2 fires a heart emote in a
      // 1.2 s window at frame 180; P5 is an unverified/dimmed runner whose jitter
      // reads as "broken" to a watcher (Layer-2 anti-cheat is a visible property).
      const S1 = 1, S2 = 0, S3 = 4;   // suit ids for P2 / P4(→classic via whitelist) / P5
      function mstate(f, ph, air, slip) {
        let s = 1 | 8;                 // facing-right + in-run
        if (!air || Math.sin(f * 0.11 + ph) < 0.55) s |= 2;   // mostly grounded, brief hops
        if (slip) s |= 16;
        return s;
      }
      const anchor = { x: 0, y: 0, f: 0 };
      const spectate = scene === 'watch';
      session = {
        isHost: true, mock: true, scene, anchor,
        tag: 'KAG', adjIdx: 3, nounIdx: 1,
        role: spectate ? ROLE_SPECTATOR : ROLE_PLAYER,                     // NOVA OTTER (viewer sits out in the watch fixture)
        roster: R,
        relayHostName: 'derp12d.tailscale.com',                            // → cityOfHost = "Chicago"
        relay: { rtt: 23 },
        code: 'TANGO-42',
        link: DUMMY_LINK,
        caps: CAPS, hostEpoch: 0,
        counts() { let players = spectate ? 0 : 1, spectators = spectate ? 1 : 0; for (const r of R.values()) { if (r.role === ROLE_SPECTATOR) spectators++; else players++; } return { players, spectators }; },
        myP: () => 1,
        presence() {
          const a = anchor, f = a.f, out = [];
          const heart = (f >= 180 && f < 252) ? { emoteId: 3, emoteSeq: 1 } : {};
          // P1 NOVA OTTER (host). A runner in the watch fixture; the local sprite
          // (you:true) in the play fixture, where the renderer skips its ghost.
          out.push(Object.assign({ p: 1, you: !spectate, host: true, spectator: false,
            x: a.x + Math.sin(f * 0.06) * 22, y: a.y + Math.sin(f * 0.10) * 16,
            vx: Math.cos(f * 0.06) * 40, state: mstate(f, 0.5, true, false), chain: 1,
            score: 980 + (f * 3 | 0), dist: 812 + (f | 0), runId: 1, suit: 0, hat: 0, callsign: 'NOVA OTTER', unverified: false }));
          // P2 COMET FOX — just ahead, the emote source.
          out.push(Object.assign({ p: 2, you: false, host: false, spectator: false,
            x: a.x + 118 + Math.sin(f * 0.05) * 34, y: a.y - 8 + Math.sin(f * 0.09) * 22,
            vx: 70, state: mstate(f, 0.0, true, false), chain: 2,
            score: 1204 + (f * 4 | 0), dist: 940 + (f * 1.2 | 0), runId: 1, suit: S1, hat: 0, callsign: 'COMET FOX', unverified: false }, heart));
          // P4 PLAYER 4 — trailing, occasionally slipstreaming the pack.
          out.push({ p: 4, you: false, host: false, spectator: false,
            x: a.x - 96 + Math.sin(f * 0.045) * 18, y: a.y + 4 + Math.sin(f * 0.13) * 10,
            vx: 55, state: mstate(f, 2.0, false, Math.sin(f * 0.08) > 0), chain: 0,
            score: 640 + (f * 2 | 0), dist: 705 + (f | 0), runId: 1, suit: S2, hat: 0, callsign: 'PLAYER 4', unverified: false });
          // P5 LUCKY SPUTNIK — implausible pace: the ghost jitters through geometry
          // (a lie that LOOKS broken), row rendered dimmed/unverified.
          out.push({ p: 5, you: false, host: false, spectator: false,
            x: a.x + 250 + Math.sin(f * 0.5) * 44, y: a.y - 48 + Math.cos(f * 0.6) * 30,
            vx: 120, state: mstate(f, 1.0, true, false), chain: 4,
            score: 1500 + (f * 12 | 0), dist: 1480 + (f * 3 | 0), runId: 1, suit: S3, hat: 3, callsign: 'LUCKY SPUTNIK', unverified: true });
          return out;
        },
        board() {
          return [
            { p: 5, callsign: 'LUCKY SPUTNIK', bestScore: 1500, bestDist: 1480, bestChain: 4, unverified: true },
            { p: 2, callsign: 'COMET FOX', bestScore: 1204, bestDist: 940, bestChain: 2, unverified: false },
            { p: 1, callsign: 'NOVA OTTER', bestScore: 980, bestDist: 812, bestChain: 1, unverified: false },
            { p: 4, callsign: 'PLAYER 4', bestScore: 640, bestDist: 705, bestChain: 0, unverified: false },
          ];
        },
        close() {},
      };
    },
    // #shot=room only: the game side feeds the deterministic ghost fixture a world
    // anchor (the local player's position + sim frame) so mock ghosts render around
    // the run. No-op unless a mock session is live.
    mockAnchor(x, y, f) { if (session && session.mock && session.anchor) { session.anchor.x = x; session.anchor.y = y; session.anchor.f = f | 0; } },

    // Internal seam for the Dockerized QA harness and later stages. Not a
    // stability contract; underscore = do not wire game code to it.
    _n1: {
      PROTO, WIRE_MAX, RELAY_MAP,
      nacl: { scalarmult, scalarmultBase, coreHsalsa, streamXsalsaXor, poly1305, secretboxSeal, secretboxOpen, boxSeal, boxOpen, boxKey, boxKeyFromShared, sha256, hmacSha256, hkdfSha256 },
      bytes: { hex, cat, b64uEnc, b64uDec, utf8, ctEq },
      keys: { detectX25519, genKeypair, keypairFromRaw, ecdh, derivePairKey, isWebX: () => webX, forceVendored: () => { webX = false; } },
      env: { makePair, sealApp, openApp, sealCode, openCode, DIR_G2H, DIR_H2G },
      invite: { encodeInvite, decodeInvite, joinProof, rejoinToken, codeKeypair, randomCode, CODE_WORDS },
      map: { regionOf, cityOfHost, probeHost, pickRegion, greatCircle },
      frames: { encHello, decHello, encWelcome, decWelcome, encPres, decPres, encSnap, decSnap, makeScratch },
      RelayClient, HostSession, GuestSession, fetchInviteByCode,
      session: () => session,
    },
    // Room-protocol seam (N2): additive over _n1 for the harness + N2b UI.
    _room: {
      ROLE_PLAYER, ROLE_SPECTATOR, PLAYER_CAP, SPECTATOR_CAP, CAPS, CALLSIGN_NONE,
      caps: { CAP_CALLSIGN, CAP_SPECTATE, CAP_ROLECHANGE, CAP_ANTICHEAT, CAP_HOSTEPOCH },
      frameRange: { FRAME_CORE_HI, FRAME_RESERVED_HI },
      callsign: { text: callsignText, valid: callsignValid, denied: (a, n) => { const cs = callsignData(); return cs ? callsignDenied(cs, a, n) : false; }, data: callsignData },
      anticheat: { check: checkEnvelope, AC },
      block: { hideKey, unhideKey, blockKey, unblockKey, droppedKeys, blocklist, BLOCK_CAP },
      roster: { encRoster, decRoster, ROSTER_ENTRY, ROSTER_MAX },
      role: { encRole, decRole },
      emote: { encEmote, decEmote, encEmoteB, decEmoteB, EMOTE_MAX, A_EMOTE, A_EMOTEB },
      bye: { encBye, decBye, A_BYE },
      round: { encRoundBody, decRoundBody, A_ROUND },
      ctrl: { encCtrl, decCtrl, makeCtrlGate, ctrlGate },
      mobility: { makeSlots, mobilityGate, moveUnstable, reconnectJitter, MOVE_MIN_INTERVAL, HANDOFF_MIN_INTERVAL },
      dir: { activeMap, setActiveMap },
    },
  };
  root.SpaceManNet = NET;
})(typeof window !== 'undefined' ? window : globalThis);
