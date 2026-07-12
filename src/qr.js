/* ============================================================================
   SPACE MAN — QR encoder (vendored, byte-mode, EC level M).
   Classic script, fully inert on load: defines window.SpaceManQR = { draw }
   ONLY. No sockets, no storage, no timers, no DOM access beyond the single
   CanvasRenderingContext2D handed to draw(). Pure function of (ctx,x,y,size,text).

   Spec: ISO/IEC 18004:2015 "QR Code bar code symbology specification".
   Scope: byte mode only, error-correction level M, versions 1-15 (data
   capacity 16..415 codewords, ~14..412 bytes of URL text) — covers the
   ~120-180 char invite URL (net-spec §2.4) with wide headroom toward the
   ~256 char design target. Longer input is silently truncated (never throws;
   draw() must be safe to call from render code every time the link changes).

   Algorithm steps, top to bottom:
     1. GF(256) log/antilog tables (primitive poly 0x11d, generator 2).
     2. Reed-Solomon generator polynomial + systematic (LFSR-style) encoder.
     3. Per-version block tables (level M only) + alignment-pattern coords.
     4. Byte-mode bit-stream builder (mode/count/data/terminator/pad).
     5. Block split -> per-block RS encode -> column-major interleave.
     6. Matrix construction: finder/timing/alignment/format/version patterns.
     7. Zigzag data placement skipping reserved modules.
     8. Mask trial (all 8 patterns) + 4-rule penalty scoring -> best mask.
     9. Format/version info bits (BCH) written for the chosen mask.
    10. Render: quiet zone + module fills onto the caller's ctx.
   ========================================================================== */
(function (root) {
  'use strict';

  /* -------------------------------------------------------------------------
     1. GF(256) ARITHMETIC — ISO 18004 Annex A: primitive polynomial
        x^8+x^4+x^3+x^2+1 (0x11d), generator element 2. exp/log tables built
        once; gmul() below is the only multiply anyone needs.
     ------------------------------------------------------------------------- */
  var GF_EXP = new Uint8Array(512); // doubled so gmul never needs a modulo
  var GF_LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();
  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /* -------------------------------------------------------------------------
     2. REED-SOLOMON — generator polynomial g(x) = prod_{i=0}^{nsym-1} (x - a^i),
        coefficients stored highest-degree-first, g[0] always 1 (monic).
        Systematic encode = remainder of data(x)*x^nsym divided by g(x),
        computed via the standard shift-register (synthetic division) form.
     ------------------------------------------------------------------------- */
  function polyMul(p, q) { // both highest-degree-first; plain convolution
    var out = new Array(p.length + q.length - 1).fill(0);
    for (var i = 0; i < p.length; i++) for (var j = 0; j < q.length; j++) out[i + j] ^= gmul(p[i], q[j]);
    return out;
  }
  function rsGeneratorPoly(nsym) {
    var g = [1];
    for (var i = 0; i < nsym; i++) g = polyMul(g, [1, GF_EXP[i]]); // *(x + a^i); sub==add in GF(2^n)
    return g;
  }
  function rsEncode(dataBytes, nsym) {
    var gen = rsGeneratorPoly(nsym);
    var buf = dataBytes.concat(new Array(nsym).fill(0));
    for (var i = 0; i < dataBytes.length; i++) {
      var coef = buf[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) buf[i + j] ^= gmul(gen[j], coef);
      }
    }
    return buf.slice(dataBytes.length);
  }

  /* -------------------------------------------------------------------------
     3. VERSION TABLES — level M only (this file never uses L/Q/H).
        BLOCKS[v] = { ec: codewords-per-block, groups: [[blockCount, dataLen], ...] }
        (values verified against ISO 18004 Table 9 data-codeword totals).
        ALIGN[v] = alignment-pattern center coordinates (Annex E.1); empty
        for v1 (no alignment pattern below version 2).
     ------------------------------------------------------------------------- */
  var BLOCKS = {
    1: { ec: 10, groups: [[1, 16]] },
    2: { ec: 16, groups: [[1, 28]] },
    3: { ec: 26, groups: [[1, 44]] },
    4: { ec: 18, groups: [[2, 32]] },
    5: { ec: 24, groups: [[2, 43]] },
    6: { ec: 16, groups: [[4, 27]] },
    7: { ec: 18, groups: [[4, 31]] },
    8: { ec: 22, groups: [[2, 38], [2, 39]] },
    9: { ec: 22, groups: [[3, 36], [2, 37]] },
    10: { ec: 26, groups: [[4, 43], [1, 44]] },
    11: { ec: 30, groups: [[1, 50], [4, 51]] },
    12: { ec: 22, groups: [[6, 36], [2, 37]] },
    13: { ec: 22, groups: [[8, 37], [1, 38]] },
    14: { ec: 24, groups: [[4, 40], [5, 41]] },
    15: { ec: 24, groups: [[5, 41], [5, 42]] }
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
    15: [6, 26, 48, 70]
  };
  // Remainder bits appended after interleaved codewords, before placement (Table 1).
  var REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 3, 15: 3 };

  function totalDataCodewords(v) {
    var b = BLOCKS[v], n = 0;
    for (var i = 0; i < b.groups.length; i++) n += b.groups[i][0] * b.groups[i][1];
    return n;
  }

  /* -------------------------------------------------------------------------
     4. BYTE-MODE BIT STREAM — mode indicator 0100, count indicator (8 bits
        for v<=9, 16 bits for v>=10), raw UTF-8 bytes, terminator, pad bytes.
     ------------------------------------------------------------------------- */
  function pickVersion(byteLen) {
    for (var v = 1; v <= 15; v++) {
      var countBits = v <= 9 ? 8 : 16;
      var headerBits = 4 + countBits;
      var capBits = totalDataCodewords(v) * 8;
      if (headerBits + byteLen * 8 + 4 <= capBits) return v; // +4 = terminator worst case
    }
    return 15; // longer than supported; caller truncates to fit below
  }

  function buildBits(bytes, version) {
    var bits = [];
    function push(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(0x4, 4); // byte-mode indicator
    push(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var capBits = totalDataCodewords(version) * 8;
    var term = Math.min(4, capBits - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var codewords = [];
    for (var c = 0; c < bits.length; c += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[c + k];
      codewords.push(byte);
    }
    var need = totalDataCodewords(version);
    var pad = [0xec, 0x11], p = 0;
    while (codewords.length < need) { codewords.push(pad[p & 1]); p++; }
    return codewords.slice(0, need);
  }

  /* -------------------------------------------------------------------------
     5. BLOCK SPLIT -> RS ENCODE -> INTERLEAVE (column-major across blocks,
        shorter groups simply exhausted first — standard QR interleave rule).
     ------------------------------------------------------------------------- */
  function interleave(dataCodewords, version) {
    var b = BLOCKS[version], nsym = b.ec;
    var dataBlocks = [], ecBlocks = [], off = 0, maxData = 0;
    for (var g = 0; g < b.groups.length; g++) {
      var count = b.groups[g][0], len = b.groups[g][1];
      for (var i = 0; i < count; i++) {
        var block = dataCodewords.slice(off, off + len);
        off += len;
        dataBlocks.push(block);
        ecBlocks.push(rsEncode(block, nsym));
        if (len > maxData) maxData = len;
      }
    }
    var out = [];
    for (var c = 0; c < maxData; c++) {
      for (var db = 0; db < dataBlocks.length; db++) if (c < dataBlocks[db].length) out.push(dataBlocks[db][c]);
    }
    for (var e = 0; e < nsym; e++) {
      for (var eb = 0; eb < ecBlocks.length; eb++) out.push(ecBlocks[eb][e]);
    }
    return out;
  }

  /* -------------------------------------------------------------------------
     6/9. FORMAT + VERSION INFO — binary BCH codes (GF(2) polynomial division
          via shift/xor, the standard CRC-style construction).
     ------------------------------------------------------------------------- */
  function bch(data, dataBits, genPoly, genBits) {
    var val = data << (genBits - 1);
    for (var i = dataBits - 1; i >= 0; i--) {
      if (val & (1 << (i + genBits - 1))) val ^= genPoly << i;
    }
    return (data << (genBits - 1)) | val;
  }
  var EC_M_BITS = 0x0; // level indicator bits for M (L=01,M=00,Q=11,H=10)
  function formatBits(maskId) {
    var data5 = (EC_M_BITS << 3) | maskId;
    return bch(data5, 5, 0x537, 11) ^ 0x5412; // generator x^10+x^8+x^5+x^4+x^2+x+1, then fixed mask
  }
  function versionBits(v) {
    return bch(v, 6, 0x1f25, 13); // generator degree 12 (Annex D)
  }

  /* -------------------------------------------------------------------------
     6/7. MATRIX CONSTRUCTION
     ------------------------------------------------------------------------- */
  function buildMatrix(version, dataCw) {
    var n = version * 4 + 17;
    var mat = [], rsv = [];
    for (var r = 0; r < n; r++) { mat.push(new Uint8Array(n)); rsv.push(new Uint8Array(n)); }
    function set(r, c, v, reserved) {
      if (r < 0 || r >= n || c < 0 || c >= n) return;
      mat[r][c] = v; if (reserved) rsv[r][c] = 1;
    }
    function finder(r0, c0) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        var dark = (r >= 0 && r <= 6 && c >= 0 && c <= 6) &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, dark ? 1 : 0, 1);
      }
    }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    // timing patterns
    for (var i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0, 1); set(i, 6, i % 2 === 0 ? 1 : 0, 1); }
    // alignment patterns (skip the three finder corners)
    var ac = ALIGN[version], first = ac[0], last = ac[ac.length - 1];
    for (var ai = 0; ai < ac.length; ai++) for (var aj = 0; aj < ac.length; aj++) {
      var r0 = ac[ai], c0 = ac[aj];
      if ((r0 === first && c0 === first) || (r0 === first && c0 === last) || (r0 === last && c0 === first)) continue;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
        var dark2 = (Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        set(r0 + dr, c0 + dc, dark2 ? 1 : 0, 1);
      }
    }
    // reserve format-info strips (values filled in after mask selection)
    for (var f = 0; f <= 8; f++) { if (f !== 6) rsv[8][f] = 1; if (f !== 6) rsv[f][8] = 1; }
    for (var f2 = 0; f2 < 8; f2++) { rsv[n - 1 - f2][8] = 1; rsv[8][n - 1 - f2] = 1; }
    set(n - 8, 8, 1, 1); // fixed dark module
    // reserve version-info blocks (version >= 7 only)
    if (version >= 7) {
      for (var vr = 0; vr < 6; vr++) for (var vc = 0; vc < 3; vc++) {
        rsv[vr][n - 11 + vc] = 1; rsv[n - 11 + vc][vr] = 1;
      }
    }
    // zigzag data placement: two columns at a time, right-to-left of the pair,
    // moving bottom-up then top-down, skipping the vertical timing column (6).
    var bits = [];
    for (var k = 0; k < dataCw.length; k++) for (var bi = 7; bi >= 0; bi--) bits.push((dataCw[k] >> bi) & 1);
    var bitIdx = 0, upward = true;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--; // never place in the timing column
      for (var step = 0; step < n; step++) {
        var row = upward ? n - 1 - step : step;
        for (var cc2 = 0; cc2 < 2; cc2++) {
          var c2 = col - cc2;
          if (rsv[row][c2]) continue;
          var bit = bitIdx < bits.length ? bits[bitIdx] : 0;
          bitIdx++;
          set(row, c2, bit, 0);
        }
      }
      upward = !upward;
    }
    return { n: n, mat: mat, rsv: rsv };
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (((r / 2) | 0) + ((c / 3) | 0)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function applyMask(built, maskId) {
    var n = built.n, mat = built.mat, rsv = built.rsv, fn = MASKS[maskId];
    var out = [];
    for (var r = 0; r < n; r++) {
      out.push(new Uint8Array(mat[r]));
      for (var c = 0; c < n; c++) if (!rsv[r][c] && fn(r, c)) out[r][c] ^= 1;
    }
    return out;
  }

  // 4-rule penalty scoring (ISO 18004 Annex J).
  function penalty(m, n) {
    var score = 0, i, j, run, v;
    for (i = 0; i < n; i++) { // rows, rule 1
      run = 1;
      for (j = 1; j < n; j++) {
        if (m[i][j] === m[i][j - 1]) run++; else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (j = 0; j < n; j++) { // columns, rule 1
      run = 1;
      for (i = 1; i < n; i++) {
        if (m[i][j] === m[i - 1][j]) run++; else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1; j++) { // rule 2
      v = m[i][j];
      if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
    }
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]; // rule 3
    function matchAt(rowArr, start, pat) {
      for (var k = 0; k < pat.length; k++) if (rowArr[start + k] !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < n; i++) for (j = 0; j <= n - 11; j++) {
      var row = m[i];
      if (matchAt(row, j, pat1) || matchAt(row, j, pat2)) score += 40;
    }
    for (j = 0; j < n; j++) for (i = 0; i <= n - 11; i++) {
      var col = []; for (var k2 = 0; k2 < 11; k2++) col.push(m[i + k2][j]);
      if (matchAt(col, 0, pat1) || matchAt(col, 0, pat2)) score += 40;
    }
    var dark = 0; // rule 4
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) dark += m[i][j];
    var pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function writeInfo(mat, n, version, maskId) {
    var fb = formatBits(maskId);
    function fbit(i) { return (fb >> i) & 1; }
    for (var i = 0; i <= 5; i++) mat[8][i] = fbit(i);
    mat[8][7] = fbit(6); mat[8][8] = fbit(7); mat[7][8] = fbit(8);
    for (var i2 = 9; i2 <= 14; i2++) mat[14 - i2][8] = fbit(i2);
    for (var i3 = 0; i3 <= 7; i3++) mat[n - 1 - i3][8] = fbit(i3);
    for (var i4 = 8; i4 <= 14; i4++) mat[8][n - 15 + i4] = fbit(i4);
    mat[n - 8][8] = 1; // fixed dark module
    if (version >= 7) {
      var vb = versionBits(version);
      function vbit(i) { return (vb >> i) & 1; }
      for (var k = 0; k < 18; k++) {
        var bit = vbit(k), a = (k % 3), b = (k / 3) | 0;
        mat[n - 11 + a][b] = bit;
        mat[b][n - 11 + a] = bit;
      }
    }
  }

  /* -------------------------------------------------------------------------
     ENCODE — orchestrates 3-9 for one text string, returns {n, mat, version}.
     ------------------------------------------------------------------------- */
  function encode(text) {
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(String(text)));
    if (bytes.length > totalDataCodewords(15) - 3) bytes = bytes.slice(0, totalDataCodewords(15) - 3); // never throw on oversize input
    var version = pickVersion(bytes.length);
    var dataCw = buildBits(bytes, version);
    var allCw = interleave(dataCw, version);
    var built = buildMatrix(version, allCw);
    // append remainder bits already accounted for by placement running out of data (zeros fill naturally)
    var bestScore = Infinity, bestMat = null, bestMask = 0;
    for (var mId = 0; mId < 8; mId++) {
      var candidate = applyMask(built, mId);
      var s = penalty(candidate, built.n);
      if (s < bestScore) { bestScore = s; bestMat = candidate; bestMask = mId; }
    }
    writeInfo(bestMat, built.n, version, bestMask);
    return { n: built.n, mat: bestMat, version: version };
  }

  /* -------------------------------------------------------------------------
     10. RENDER — quiet zone (4 modules) + solid module fills on the caller's
         ctx. No canvas allocation, no DOM lookups; ctx is used exactly as
         handed in. Re-encodes each call (cheap: link only changes rarely,
         per net-spec §4.5 "re-rendered only on link change").
     ------------------------------------------------------------------------- */
  function draw(ctx, x, y, size, text) {
    if (!ctx || !text) return;
    var q = encode(text);
    var quiet = 4, total = q.n + quiet * 2;
    var m = size / total;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#000';
    for (var r = 0; r < q.n; r++) {
      for (var c = 0; c < q.n; c++) {
        if (q.mat[r][c]) ctx.fillRect(x + (c + quiet) * m, y + (r + quiet) * m, m, m);
      }
    }
  }

  root.SpaceManQR = { draw: draw };
})(window);
