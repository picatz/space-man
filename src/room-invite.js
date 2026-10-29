/* ============================================================================
   SPACE MAN — room invite card.
   The "scan to join" card every friend room shows its host: a large QR of the
   invite link on a white tile (phone cameras need the contrast), the short
   room code when the relay issued one, and one line telling a new player what
   to do. Arena and Star Circuit share it so a friend learns one gesture.
   Defines window.SpaceManRoomInvite = { create } and nothing else on load.
   ========================================================================= */
(function (root) {
  'use strict';

  var STYLE_ID = 'sm-room-invite-style';
  // Sized for a phone held out at arm's length: the tile is the widest thing on
  // the card and never wider than the narrow viewport minus its gutters.
  var CSS =
    '.sm-invite{display:flex;flex-direction:column;align-items:center;gap:10px;margin:4px 0 12px;padding:14px 12px;' +
    'border:1px solid #2f6f8a;border-radius:18px;background:linear-gradient(180deg,#0f2c44,#0b2135);text-align:center}' +
    '.sm-invite[hidden]{display:none}' +
    '.sm-invite-title{margin:0;font:800 20px/1.15 system-ui,sans-serif;letter-spacing:.02em;color:#eafaff}' +
    '.sm-invite-tile{padding:10px;border-radius:16px;background:#fff;box-shadow:0 0 0 3px #46d9ff33,0 8px 24px #0008;line-height:0}' +
    '.sm-invite-qr{display:block;width:min(260px,62vw,46vh);height:auto;aspect-ratio:1;image-rendering:pixelated}' +
    '.sm-invite-code{margin:0;font:800 24px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#9ff1ff;overflow-wrap:anywhere}' +
    '.sm-invite-code[hidden]{display:none}' +
    '.sm-invite-help{margin:0;max-width:30em;font:13px/1.4 system-ui,sans-serif;color:#bcd6e6}';

  function ensureStyle(doc) {
    if (doc.getElementById && doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.body || doc.documentElement).appendChild(style);
  }

  // create({ document, game, qrSize }) returns { el, qr, set(link, code) }.
  // set() hides the card without a link and redraws the QR only when the link
  // changes; game names the mode in the canvas label for screen readers.
  function create(options) {
    var opts = options || {};
    var doc = opts.document || root.document;
    ensureStyle(doc);
    var card = doc.createElement('figure');
    card.className = 'sm-invite';
    card.hidden = true;
    var title = doc.createElement('p');
    title.className = 'sm-invite-title';
    title.textContent = 'Scan to join';
    var tile = doc.createElement('div');
    tile.className = 'sm-invite-tile';
    var qr = doc.createElement('canvas');
    qr.className = 'sm-invite-qr';
    qr.width = qr.height = opts.qrSize || 288;
    qr.setAttribute('role', 'img');
    qr.setAttribute('aria-label', 'QR code to join this ' + (opts.game || 'room') + ' with a phone camera');
    tile.appendChild(qr);
    var code = doc.createElement('p');
    code.className = 'sm-invite-code';
    code.hidden = true;
    var help = doc.createElement('figcaption');
    help.className = 'sm-invite-help';
    card.append(title, tile, code, help);
    var drawn = '';
    function set(link, roomCode) {
      card.hidden = !link;
      if (!link) return;
      if (link !== drawn && root.SpaceManQR) {
        var ctx = qr.getContext('2d');
        if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, qr.width, qr.height); root.SpaceManQR.draw(ctx, 0, 0, qr.width, link); }
        drawn = link;
      }
      code.textContent = roomCode || '';
      code.hidden = !roomCode;
      help.textContent = roomCode
        ? 'Friends point their camera here, or type this code in Join.'
        : 'Friends point their camera here. Far away? Tap Share to send the link.';
    }
    return { el: card, qr: qr, set: set };
  }

  root.SpaceManRoomInvite = { create: create };
})(window);
