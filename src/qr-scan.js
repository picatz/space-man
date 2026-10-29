/* ============================================================================
   SPACE MAN — in-game QR scanner.
   "Scan QR code" in every join flow: opens the rear camera full screen, reads
   frames with the browser's BarcodeDetector and hands the first invite it
   accepts back to the caller. Nothing leaves the device; frames are read in
   place and the camera stops the moment the sheet closes.
   Browsers without BarcodeDetector (Safari, Firefox today) get a short sheet
   that points to the phone's own Camera app, which reads the same QR and opens
   the invite link directly. Defines window.SpaceManQRScan = { canDecode, open }.
   ========================================================================= */
(function (root) {
  'use strict';

  var STYLE_ID = 'sm-qr-scan-style';
  var CSS =
    '.sm-scan{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
    'padding:calc(env(safe-area-inset-top,0px) + 20px) 16px calc(env(safe-area-inset-bottom,0px) + 20px);background:#040b16f2;color:#eafaff;' +
    'font:15px/1.4 system-ui,sans-serif;text-align:center}' +
    '.sm-scan[hidden]{display:none}' +
    '.sm-scan-title{margin:0;font:800 22px/1.15 system-ui,sans-serif}' +
    '.sm-scan-view{position:relative;width:min(84vw,62vh,420px);aspect-ratio:1;border-radius:22px;overflow:hidden;background:#000;box-shadow:0 0 0 3px #46d9ff55,0 12px 40px #000a}' +
    '.sm-scan-view[hidden]{display:none}' +
    '.sm-scan-view video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.sm-scan-frame{position:absolute;inset:14%;border:3px solid #9ff1ff;border-radius:16px;box-shadow:0 0 0 999px #0006}' +
    '.sm-scan-line{position:absolute;left:16%;right:16%;top:50%;height:2px;background:#9ff1ff;box-shadow:0 0 12px #46d9ff;animation:sm-scan-sweep 2.2s ease-in-out infinite alternate}' +
    '@keyframes sm-scan-sweep{from{top:17%}to{top:83%}}' +
    '.sm-scan[data-calm=true] .sm-scan-line{animation:none}' +
    '.sm-scan-view[data-found=true] .sm-scan-frame{border-color:#ffd166;box-shadow:0 0 0 999px #0006,0 0 24px #ffd166}' +
    '.sm-scan-msg{margin:0;max-width:26em;color:#bcd6e6}' +
    '.sm-scan-msg[data-tone=warn]{color:#ffd8a8}' +
    '.sm-scan-close{min-width:160px;min-height:48px;padding:10px 22px;border:1px solid #547183;border-radius:14px;background:#10263b;color:#eafaff;font:700 16px system-ui,sans-serif;cursor:pointer}' +
    '.sm-scan-close:focus-visible{outline:3px solid #9ff1ff;outline-offset:3px}';

  function ensureStyle(doc) {
    if (doc.getElementById && doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.body || doc.documentElement).appendChild(style);
  }

  // True when this browser can read QR codes from the camera itself.
  function canDecode() {
    var nav = root.navigator;
    return !!(root.BarcodeDetector && nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
  }

  var FALLBACK = 'This browser can’t read QR codes inside the game. On a phone, open the Camera app, point it at the QR and tap the link that appears. Or type the room code.';

  function cameraMessage(e) {
    var name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is off for this page. Allow the camera in your browser’s site settings, or use your phone’s Camera app to scan the QR.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device. Type the room code instead, or paste the invite link.';
    if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again, or type the room code.';
    return 'The camera didn’t start. Type the room code instead, or paste the invite link.';
  }

  var current = null;

  // open({ title, accept(text) -> bool, onResult(text), onClose(), calm })
  // Shows the sheet and starts the camera. accept() filters QR codes that are
  // not invites, so a stray menu QR keeps the scanner open with a gentle note.
  // Returns a close() function; closing never calls onResult.
  function open(options) {
    var opts = options || {};
    var doc = opts.document || root.document;
    if (current) current.close();
    ensureStyle(doc);
    var sheet = doc.createElement('div');
    sheet.className = 'sm-scan';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', opts.title || 'Scan a QR code');
    sheet.dataset.calm = String(!!opts.calm);
    var title = doc.createElement('p');
    title.className = 'sm-scan-title';
    title.textContent = opts.title || 'Scan a friend’s QR code';
    var view = doc.createElement('div');
    view.className = 'sm-scan-view';
    var video = doc.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    var frame = doc.createElement('div');
    frame.className = 'sm-scan-frame';
    var line = doc.createElement('div');
    line.className = 'sm-scan-line';
    view.append(video, frame, line);
    var msg = doc.createElement('p');
    msg.className = 'sm-scan-msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    var close = doc.createElement('button');
    close.type = 'button';
    close.className = 'sm-scan-close';
    close.textContent = 'Cancel';
    sheet.append(title, view, msg, close);
    (doc.body || doc.documentElement).appendChild(sheet);

    var stream = null, timer = 0, closed = false, busy = false, returnFocus = doc.activeElement;
    function say(text, tone) { msg.textContent = text; if (tone) msg.dataset.tone = tone; else delete msg.dataset.tone; }
    function stop() {
      if (timer) { root.clearTimeout(timer); timer = 0; }
      if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); stream = null; }
      try { video.srcObject = null; } catch (_) {}
    }
    function finish(result) {
      if (closed) return;
      closed = true; stop();
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('visibilitychange', onHidden);
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      if (current && current.sheet === sheet) current = null;
      if (result !== undefined) { if (opts.onResult) opts.onResult(result); }
      else {
        try { if (returnFocus && returnFocus.focus) returnFocus.focus(); } catch (_) {}
        if (opts.onClose) opts.onClose();
      }
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } }
    function onHidden() { if (doc.hidden) finish(); }
    close.addEventListener('click', function () { finish(); });
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('visibilitychange', onHidden);
    try { close.focus(); } catch (_) {}

    if (!canDecode()) {
      view.hidden = true;
      title.textContent = 'Scan with your Camera app';
      close.textContent = 'Got it';
      say(FALLBACK);
    } else {
      say('Point the camera at the QR on your friend’s screen.');
      var detector;
      try { detector = new root.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; }
      if (!detector) { view.hidden = true; say(FALLBACK); }
      else root.navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
        if (closed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; video.srcObject = s;
        var playing = video.play && video.play();
        if (playing && playing.catch) playing.catch(function () {});
        scan();
      }).catch(function (e) { if (!closed) { view.hidden = true; say(cameraMessage(e), 'warn'); close.textContent = 'Back'; } });
      var scan = function () {
        if (closed) return;
        timer = root.setTimeout(function () {
          timer = 0;
          if (closed || busy || video.readyState < 2) { scan(); return; }
          busy = true;
          detector.detect(video).then(function (codes) {
            busy = false;
            if (closed) return;
            var text = codes && codes[0] && codes[0].rawValue;
            if (text && (!opts.accept || opts.accept(text))) {
              view.dataset.found = 'true';
              try { if (root.navigator.vibrate) root.navigator.vibrate(30); } catch (_) {}
              say('Got it. Joining…');
              root.setTimeout(function () { finish(text); }, 180);
              return;
            }
            if (text) say('That QR isn’t a Space Man invite. Try the one on your friend’s screen.', 'warn');
            scan();
          }).catch(function () { busy = false; scan(); });
        }, 140);
      };
    }
    current = { sheet: sheet, close: function () { finish(); } };
    return current.close;
  }

  root.SpaceManQRScan = { canDecode: canDecode, open: open };
})(window);
