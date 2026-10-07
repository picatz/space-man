/* Star Circuit: lazy, isolated canvas presentation for the race simulation. */
(function (root) {
  "use strict";
  const TAU = Math.PI * 2,
    clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(text, cls, action) {
    const n = el("button", "race-button " + (cls || ""), text);
    n.type = "button";
    n.addEventListener("click", action);
    return n;
  }
  // Network snapshots arrive at 20Hz. Preserve DOM text nodes while their
  // value is unchanged, including during an in-flight pointer click in WebKit.
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }
  function setDisabled(node, value) {
    if (node.disabled !== !!value) node.disabled = !!value;
  }
  function round(g, x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }
  // Acknowledgements certify two distinct visible paint opportunities, never
  // merely receipt of a network snapshot or a hidden/modal update.
  function createWarningReceipt() {
    let context = "", lastFrame = -1, pending = Array(5).fill(0),
      began = Array(5).fill(-1), acknowledged = Array(5).fill(0);
    function reset() {
      context = ""; lastFrame = -1;
      pending.fill(0); began.fill(-1); acknowledged.fill(0);
    }
    return Object.freeze({ reset, observe(serials, options = {}) {
      const key = String(options.epoch ?? "") + ":" + String(options.actorId || "");
      if (key !== context || !Number.isInteger(options.frame) || options.frame < lastFrame) {
        reset(); context = key;
      }
      lastFrame = options.frame;
      for (let i = 0; i < 5; i++) {
        const value = Array.isArray(serials) ? serials[i] : 0;
        const serial = options.visible && Number.isInteger(options.frame) &&
          Number.isInteger(value) && value > 0 && value <= 65535 ? value : 0;
        if (!serial) { pending[i] = acknowledged[i] = 0; began[i] = -1; }
        else if (acknowledged[i] !== serial) {
          if (pending[i] !== serial) { pending[i] = serial; began[i] = options.frame; }
          else if (options.frame > began[i]) acknowledged[i] = serial;
        }
      }
      return acknowledged.slice();
    }});
  }
  function pulseGuide(actor, course, effects, nearest) {
    const road = nearest(course, actor.x, actor.y);
    const d = clamp(-(actor.x-road.x)*road.ty + (actor.y-road.y)*road.tx, -90, 90);
    const dangerous = effects.map(effect => clamp(effect.d || 0, -44, 44));
    // Prefer a comfortably clear lane rather than a pixel-thin gap between two
    // simultaneous waves. Unclear counterplay is never acknowledged as ready.
    const lanes = [-62, 0, 62].filter(lane => dangerous.every(danger => Math.abs(lane-danger) >= 48));
    lanes.sort((a,b) => Math.abs(a-d)-Math.abs(b-d));
    const safe = lanes.length ? lanes[0] : null;
    const direction = safe === null ? "shield" : Math.abs(safe-d) < 10 ? "hold" : safe < d ? "left" : "right";
    const laneName = value => value < -15 ? "left" : value > 15 ? "right" : "middle";
    const names = [...new Set(dangerous.map(laneName))];
    return { d, dangerous, safe, direction,
      // Cover the full 54-tick charge + 28-tick wave, plus two paint frames.
      actionable: safe !== null || actor.item === "shield" || actor.shieldTicks > 84,
      label: (effects.length > 1 ? effects.length + " PULSES" : names[0]?.toUpperCase() + " LANE PULSE") + " · " +
        (direction === "left" ? "MOVE LEFT / SHIELD" : direction === "right" ? "MOVE RIGHT / SHIELD" : direction === "hold" ? "HOLD YOUR LANE" : "SHIELD IF READY"),
      description: "Pulse danger in " + names.join(" and ") + " lane. " +
        (safe === null ? "No comfortably clear lane is visible." : "Clear lane: " + laneName(safe) + "."),
    };
  }
  // Native taps can begin and end between physics steps. Establish one neutral
  // Item sample, then emit one fresh press; never repeat it while the key stays
  // down or let it survive a menu/epoch/ownership reset.
  function createItemRequest() {
    let phase = 0;
    return Object.freeze({
      request() { if (!phase) phase = 1; },
      reset() { phase = 0; },
      sample(held, ready = true) {
        if (!phase) return !!held;
        if (!ready) { phase = 1; return false; }
        if (phase === 1) { phase = 2; return false; }
        phase = 0; return true;
      },
    });
  }
  function sourceBearingArrow(sx, sy) {
    return ["→","↘","↓","↙","←","↖","↑","↗"][(Math.round(Math.atan2(sy,sx)/(Math.PI/4))+8)%8];
  }
  const CSS = `
.race-root{position:fixed;inset:0 auto auto 0;width:100%;height:100dvh;background:#080f24;color:#eef7fb;z-index:1000;isolation:isolate;overflow:hidden;font:14px/1.45 ui-rounded,system-ui,sans-serif;touch-action:none;user-select:none;color-scheme:dark;--race-top:max(0px,calc(var(--game-ui-top,env(safe-area-inset-top,0px)) - var(--race-vv-top,0px)));--race-bottom:max(0px,calc(var(--game-ui-bottom,env(safe-area-inset-bottom,0px)) - var(--race-vv-bottom,0px)));--race-left:max(0px,calc(var(--game-ui-left,env(safe-area-inset-left,0px)) - var(--race-vv-left,0px)));--race-right:max(0px,calc(var(--game-ui-right,env(safe-area-inset-right,0px)) - var(--race-vv-right,0px)))}
.race-root,.race-root *{box-sizing:border-box}.race-root[hidden],.race-root [hidden]{display:none!important}.race-root :focus-visible{outline:3px solid #fff09d;outline-offset:-3px}.race-root button{-webkit-tap-highlight-color:transparent;appearance:none;cursor:pointer;font:inherit}.race-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.race-canvas:focus-visible{outline:2px solid #73ecff50!important;outline-offset:-2px!important}
.race-button{min-height:46px;padding:10px 17px;color:#d9edf8;border:1px solid #38536b;border-radius:13px;background:#192f45;font-weight:700;font-size:12px;line-height:1.4;max-width:100%}.race-button:hover{background:#26445b}.race-button:active,.race-pressed{transform:translateY(2px);background:#38617b!important}.race-primary{background:#c7f47d;color:#152b30;border-color:#deffae;min-height:54px;box-shadow:0 4px 0 #53783d;font-size:14px}.race-primary:hover{background:#e0ffa9}.race-text{border-color:transparent;background:transparent;color:#9eb9cc}.race-small{padding:8px 12px;min-height:44px}.race-kicker{font-size:calc(10px * var(--ui-scale, 1));font-weight:800;letter-spacing:.18em;color:#90acbf}.race-tag{color:#c7f47d;font-size:calc(10px * var(--ui-scale, 1));font-weight:800;letter-spacing:.12em}.race-pill{padding:7px 11px;border:1px solid #628754;border-radius:20px;background:#172d2e;display:inline-block;color:#d3f9a6;font-size:calc(10px * var(--ui-scale, 1));letter-spacing:.12em;font-weight:750}
.race-modal{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:calc(var(--race-top) + 20px) calc(var(--race-right) + 24px) calc(var(--race-bottom) + 20px) calc(var(--race-left) + 24px);background:linear-gradient(110deg,#080f24ed,#080f2466);overflow:hidden}.race-dialog{width:min(1060px,100%);max-height:100%;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#38617b transparent;min-width:0}.race-lobby-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;gap:12px}.race-grid{display:grid;grid-template-columns:1fr 1.12fr;align-items:center;gap:48px}.race-intro{min-width:0}.race-title{font-size:clamp(42px,5vw,68px);font-weight:950;letter-spacing:-.06em;line-height:.95;margin:20px 0}.race-title span{display:block;color:#c7f47d}.race-lede{max-width:310px;color:#a9bed0;font-size:14px;line-height:1.65}.race-hero{width:100%;height:auto;display:block;max-width:390px;margin:-8px 0}.race-facts{display:flex;gap:18px;color:#9eb8ca;font-size:calc(11px * var(--ui-scale, 1));flex-wrap:wrap}.race-facts strong{color:#eef7fb;display:block;font-size:15px}
.race-setup{padding:23px;border:1px solid #344e64;border-radius:22px;background:linear-gradient(130deg,#172b41ef,#0e1e33ef);min-width:0}.race-label{margin:0 0 10px;color:#a9bed0;font-size:calc(10px * var(--ui-scale, 1));letter-spacing:.12em;font-weight:800}.race-track-list{display:grid;gap:8px}.race-track{width:100%;display:flex;align-items:center;gap:13px;text-align:left;min-height:78px;padding:9px 12px;background:#0d1e32;min-width:0}.race-track[aria-pressed=true]{border-color:#c7f47d;background:#203b3d}.race-track canvas{width:95px;height:57px;flex:0 0 95px}.race-track strong{display:block;font-size:12px;color:#eff9ff;letter-spacing:-.01em}.race-track small{font-size:calc(9px * var(--ui-scale, 1));font-weight:800;letter-spacing:.15em;color:#8faaBE}.race-track-description{color:#91aabf;font-size:calc(11px * var(--ui-scale, 1));min-height:30px;margin:10px 0 14px}.race-options{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 20px}.race-segments{display:flex;gap:3px;background:#0b1a2b;border:1px solid #2a4258;padding:3px;border-radius:10px}.race-segment{background:transparent;border-color:transparent;min-height:36px;padding:7px 12px;font-size:calc(11px * var(--ui-scale, 1))}.race-segment[aria-pressed=true]{background:#35516a;color:#fff}.race-launch{width:100%}.race-local-note{font-size:calc(10px * var(--ui-scale, 1));color:#92aabf;text-align:center;margin:15px 0 0}.race-help{border-top:1px solid #293f56;padding-top:10px;margin-top:17px;color:#a4bdcf;font-size:calc(11px * var(--ui-scale, 1))}.race-help summary{min-height:35px;cursor:pointer;color:#c4d9e7;padding:7px 0}.race-help p{margin:5px 0 12px}
.race-hud{position:absolute;left:calc(var(--race-left) + 20px);right:calc(var(--race-right) + 20px);top:calc(var(--race-top) + 16px);z-index:3;pointer-events:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.race-hud-box{display:flex;align-items:center;gap:18px;background:#091727df;border:1px solid #426174;border-radius:15px;padding:11px 15px;box-shadow:0 4px 24px #0004;min-width:0}.race-position{font-size:39px;font-weight:900;line-height:1;color:#c7f47d;letter-spacing:-.05em}.race-position small{font-size:14px;color:#8facbf}.race-metric{display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums}.race-metric strong{font-size:17px}.race-metric span{font-size:calc(9px * var(--ui-scale, 1));color:#93adbf;font-weight:700;letter-spacing:.14em}.race-hud-left{display:grid;gap:6px;min-width:0;max-width:190px}.race-identity{display:flex;align-items:center;gap:8px;min-width:0;padding:3px 4px;background:transparent;border:0;border-radius:0;color:#EAF7FF;text-shadow:0 1px 3px #071522}.race-identity canvas{width:30px;height:30px;flex:0 0 30px;background:transparent;border-radius:0}.race-identity-copy{display:flex;flex-direction:column;min-width:0;line-height:1.25}.race-identity-role{font-size:calc(9px * var(--ui-scale, 1));letter-spacing:.08em;font-weight:700}.race-identity-name{font-size:calc(11px * var(--ui-scale, 1));font-weight:650;color:#eef7fb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.race-hud-right{display:flex;gap:8px;align-items:center}.race-pause{pointer-events:auto;width:48px;height:48px;padding:10px;font-size:19px;background:#112a3ee8}.race-time{color:#e7f3fb;font-size:18px;font-weight:750;font-variant-numeric:tabular-nums;background:#091727df;border:1px solid #344e64;border-radius:12px;padding:10px 13px}.race-speed{position:absolute;left:calc(var(--race-left) + 23px);bottom:calc(var(--race-bottom) + 22px);z-index:3;color:#e5f6ff;pointer-events:none;background:#091727d9;border:1px solid #34505d80;border-radius:10px;padding:8px 10px}.race-speed strong{font-size:29px;line-height:1;font-variant-numeric:tabular-nums}.race-speed span{font-size:calc(9px * var(--ui-scale, 1));letter-spacing:.1em;color:#94b7ca}.race-drive-feedback{font-size:calc(10px * var(--ui-scale, 1));font-weight:900;letter-spacing:.08em;color:#8ceaff;margin-top:6px}.race-drive-feedback[data-kind=boost]{color:#d6ff96}.race-boostbar{width:130px;height:5px;background:#2d4456;border-radius:9px;overflow:hidden;margin-top:7px}.race-boostfill{height:100%;background:#c7f47d;transform-origin:left}.race-hint{position:absolute;bottom:calc(var(--race-bottom) + 23px);left:50%;transform:translateX(-50%);padding:6px 10px;background:#091727d9;color:#a8c7d9;z-index:3;font-size:calc(10px * var(--ui-scale, 1));white-space:nowrap;border-radius:8px;pointer-events:none}.race-minimap{position:absolute;right:calc(var(--race-right) + 20px);bottom:calc(var(--race-bottom) + 20px);width:170px;height:120px;background:#091727a9;border:1px solid #426174;border-radius:14px;z-index:3;pointer-events:none}.race-banner{position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:4;color:#eefaff;font-size:72px;font-weight:950;text-shadow:0 5px 0 #122c42}.race-banner small{display:block;font-size:calc(10px * var(--ui-scale, 1));letter-spacing:.18em;color:#c7f47d;background:#091727c9;border-radius:18px;padding:7px 12px;text-shadow:none}.race-warning{position:absolute;top:calc(var(--race-top) + 142px);left:50%;transform:translateX(-50%);background:#543421e0;border:1px solid #c18c5e;border-radius:20px;padding:6px 14px;font-size:calc(10px * var(--ui-scale, 1));color:#ffe0b5;z-index:3;pointer-events:none;white-space:nowrap}
.race-touch{display:none;position:absolute;inset:0;z-index:4;pointer-events:none}.race-root[data-touch=true] .race-touch{display:block}.race-root[data-touch=true] .race-hint,.race-root[data-screen=lobby] .race-hint{display:none}.race-touch-group{display:flex;align-items:end;gap:10px;position:absolute;bottom:calc(var(--race-bottom) + 22px);pointer-events:auto;touch-action:none}.race-steering{left:calc(var(--race-left) + 18px)}.race-actions{right:calc(var(--race-right) + 18px)}.race-touch-button{width:65px;height:65px;border-radius:20px;background:#102e42d9;border:1.5px solid #73a9bd;color:#e7faff;font-size:27px;padding:5px;box-shadow:0 4px 0 #071522;touch-action:none}.race-touch-button small{display:block;font-size:calc(9px * var(--ui-scale, 1));letter-spacing:.08em;color:#b3d1e1}.race-touch-boost{background:#334735db;border-color:#c7f47d;color:#daffae}.race-touch-boost span{font-size:22px}.race-root[data-handed=left] .race-steering{left:auto;right:calc(var(--race-right) + 18px)}.race-root[data-handed=left] .race-actions{right:auto;left:calc(var(--race-left) + 18px)}.race-root[data-touch=true] .race-speed{bottom:calc(var(--race-bottom) + 104px)}.race-root[data-touch=true] .race-minimap{bottom:calc(var(--race-bottom) + 106px);width:132px;height:92px}.race-recover{position:absolute;left:50%;bottom:calc(var(--race-bottom) + 25px);transform:translateX(-50%);pointer-events:auto;background:#0b2235d9;font-size:calc(9px * var(--ui-scale, 1));padding:7px 10px;min-height:44px}
.race-compact{width:min(430px,100%);padding:25px;background:#0d2035f5;border:1px solid #456174;border-radius:23px;box-shadow:0 18px 100px #0006}.race-compact h2{font-size:34px;letter-spacing:-.05em;line-height:1.08;margin:16px 0 12px}.race-compact p{color:#aac3d3;font-size:13px}.race-compact>.race-button{width:100%;margin-top:10px}.race-results{margin:20px 0}.race-result-row{display:flex;align-items:center;gap:14px;padding:10px 4px;border-bottom:1px solid #294054;color:#d2e6f3;font-size:12px}.race-result-row strong{flex:1}.race-result-row span:first-child{font-size:19px;color:#c7f47d;font-weight:800}.race-result-row span:last-child{font-variant-numeric:tabular-nums;color:#93b2c6}.race-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:760px){.race-grid{gap:22px;grid-template-columns:1fr}.race-intro{display:grid;grid-template-columns:1fr .8fr;column-gap:10px;align-items:center}.race-intro>.race-pill{grid-column:1;justify-self:start;font-size:calc(9px * var(--ui-scale, 1));letter-spacing:.1em;padding:6px 9px}.race-title{font-size:34px;line-height:1;margin:13px 0;grid-column:1}.race-lede{font-size:12px;margin:0;grid-column:1/-1;max-width:none}.race-hero{grid-column:2;grid-row:1/4;width:100%;margin:0}.race-facts{display:none}.race-lobby-header{margin-bottom:8px}.race-setup{padding:17px}.race-track{min-height:68px}.race-track canvas{width:85px;height:50px;flex-basis:85px}.race-options{margin-bottom:15px}.race-modal{padding:calc(var(--race-top) + 12px) calc(var(--race-right) + 16px) calc(var(--race-bottom) + 14px) calc(var(--race-left) + 16px)}.race-hud{left:calc(var(--race-left) + 12px);right:calc(var(--race-right) + 12px);top:calc(var(--race-top) + 12px);gap:7px}.race-hud-box{gap:13px;padding:10px 12px}.race-position{font-size:32px}.race-metric strong{font-size:15px}.race-time{font-size:14px;padding:11px 10px}.race-pause{width:44px;height:44px;min-height:44px}.race-touch-group{gap:7px}.race-touch-button{width:59px;height:63px}.race-steering{left:calc(var(--race-left) + 13px)}.race-actions{right:calc(var(--race-right) + 13px)}.race-recover{font-size:calc(9px * var(--ui-scale, 1));padding:7px;bottom:calc(var(--race-bottom) + 31px)}.race-hint{max-width:60%;white-space:normal;text-align:center}.race-warning{top:calc(var(--race-top) + 128px)}}
@media(max-height:520px) and (min-width:600px){.race-hud-left{grid-template-columns:auto minmax(0,170px);align-items:center;max-width:360px}.race-warning{top:calc(var(--race-top) + 103px)}.race-grid{grid-template-columns:.85fr 1.15fr;gap:25px;align-items:start}.race-intro{display:block}.race-title{font-size:42px}.race-hero{max-width:190px}.race-lede{font-size:calc(11px * var(--ui-scale, 1))}.race-lobby-header{margin-bottom:9px}.race-track{min-height:61px;padding:5px 10px}.race-track canvas{height:43px;width:75px;flex-basis:75px}.race-setup{padding:15px}.race-track-description{min-height:0}.race-touch-button{width:57px;height:55px}.race-minimap,.race-root[data-touch=true] .race-minimap{width:100px;height:70px;bottom:calc(var(--race-bottom) + 85px)}.race-root[data-touch=true] .race-speed{bottom:calc(var(--race-bottom) + 91px)}.race-banner{top:25%;font-size:44px}.race-compact{padding:19px}.race-compact h2{font-size:28px}.race-compact>.race-button{margin-top:6px}.race-compact p{margin:6px 0}.race-results{margin:9px 0}.race-result-row{padding:5px 4px}}
@media(max-width:350px){.race-touch-button{width:54px;height:60px}.race-root .race-recover{width:44px;font-size:0;padding:5px 2px}.race-recover:after{content:"↺";font-size:23px}.race-boostbar{width:100px}.race-root[data-touch=true] .race-minimap{width:100px;height:70px}.race-hud-box{padding:9px 10px;gap:10px}.race-hud{gap:5px}.race-time{padding:10px 8px}}
.race-ready-row{display:grid;gap:8px;margin:10px 0}.race-ready-row[hidden],.race-ready-row>[hidden],.race-compact>.race-text[hidden]{display:none!important}.race-auto-label{display:flex;gap:8px;align-items:center;font-size:13px;min-height:44px}.race-auto-label input{width:22px;height:22px;flex:none}.race-vote-note{margin:6px 0;font-size:13px;line-height:1.5;color:#c7e2ef;min-height:0}.race-vote-note:empty{display:none}
.race-online-panel{margin-top:18px;padding:13px 18px;border:1px solid #38536b;border-radius:16px;background:#10263be8}.race-online-panel>summary{cursor:pointer;min-height:44px;padding:10px 0;font-weight:750;color:#d6efbf}.race-online-entry{display:grid;gap:10px}.race-online-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.race-room-input{width:100%;min-height:46px;border:1px solid #547183;border-radius:10px;background:#071c2e;color:#e1f5ff;font:inherit;padding:10px;user-select:text;touch-action:auto}.race-room-members{padding-left:20px;color:#c7e2ef;font-size:12px}.race-room-code{font-size:18px;letter-spacing:.08em}.race-watch-tools{position:absolute;bottom:calc(var(--race-bottom) + 18px);left:50%;transform:translateX(-50%);z-index:4;background:#10263be8;border:1px solid #38536b;border-radius:12px;display:flex;align-items:center;gap:8px;max-width:95%;font-size:calc(10px * var(--ui-scale, 1))}.race-watch-tools>.race-button{width:44px;min-width:44px;height:44px;padding:8px;flex:0 0 44px}.race-watch-tools>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.race-root button:disabled{opacity:.5;cursor:default}.race-root[data-online=true] .race-hint{display:none}
.race-audio-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.race-audio-volume{display:flex;gap:8px;align-items:center;font-size:calc(11px * var(--ui-scale, 1));color:#a9bed0}.race-audio-volume input{max-width:140px;min-height:44px;touch-action:pan-x}.race-compact .race-audio-controls{border-top:1px solid #294054;padding-top:12px}

.race-warning-source{width:14px;height:14px;vertical-align:-3px;margin-right:5px}.race-threat-map{display:block;width:140px;height:30px;margin:4px auto 0;border-radius:5px}.race-item{position:absolute;right:calc(var(--race-right) + 20px);bottom:calc(var(--race-bottom) + 151px);z-index:3;width:76px;height:62px;min-height:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:3px;background:#12283fec;border:2px solid #71879b;border-radius:16px;touch-action:none;box-shadow:0 3px 0 #071522}.race-item-icon{font-size:25px;line-height:1}.race-item-name{font-size:calc(9px * var(--ui-scale, 1));letter-spacing:.06em;line-height:1.25}.race-item[data-item=shield]{border-color:#89eaff;color:#c5f6ff}.race-item[data-item=pulse]{border-color:#ffb17b;color:#ffe4cc}.race-item[aria-disabled=true]{color:#a7b8c5;border-color:#506779}.race-item[data-active=true]{box-shadow:0 0 0 3px #89eaff44}.race-item-key{font-size:calc(9px * var(--ui-scale, 1));color:#abc0cc}.race-root[data-touch=true] .race-item-key{display:none}.race-root[data-touch=true] .race-item{right:calc(var(--race-right) + 18px);bottom:calc(var(--race-bottom) + 97px);width:65px;height:55px}.race-root[data-touch=true][data-handed=left] .race-item{right:auto;left:calc(var(--race-left) + 18px)}.race-root[data-touch=true][data-features=true] .race-minimap{bottom:calc(var(--race-bottom) + 166px)}.race-warning[data-kind=pulse]{background:#43291feb;border-color:#ffc48b;color:#fff0d8;font-size:calc(11px * var(--ui-scale, 1));white-space:normal;text-align:center;max-width:min(340px,calc(100% - 32px));top:calc(var(--race-top) + 145px)}
@media(max-width:760px){.race-root[data-touch=true] .race-item{right:calc(var(--race-right) + 13px);width:59px;bottom:calc(var(--race-bottom) + 96px)}.race-root[data-touch=true][data-handed=left] .race-item{left:calc(var(--race-left) + 13px)}}
@media(max-height:520px) and (min-width:600px){.race-root[data-touch=true] .race-item{right:calc(var(--race-right) + 18px);width:57px;height:48px;bottom:calc(var(--race-bottom) + 87px)}.race-root[data-touch=true][data-handed=left] .race-item{left:calc(var(--race-left) + 18px)}.race-root[data-touch=true][data-features=true] .race-minimap{bottom:calc(var(--race-bottom) + 145px)}.race-warning[data-kind=pulse]{top:calc(var(--race-top) + 70px)}}
@media(max-width:350px){.race-root[data-touch=true] .race-item{width:54px;bottom:calc(var(--race-bottom) + 93px)}}
@media(prefers-reduced-motion:reduce){.race-root *{transition:none!important}}

@media(max-width:360px) and (max-height:650px){.race-root[data-touch=true] .race-minimap{display:none}}
`;
  function create(opts = {}) {
    const R = root.SpaceManRace;
    const cosmeticSession = Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 9);
    let cosmeticRound = 0;
    let active = false,
      built = false,
      destroyed = false,
      state = null,
      view = "lobby",
      paused = false,
      frameId = 0,
      last = 0,
      acc = 0,
      width = 1,
      height = 1,
      dpr = 1,
      viewport = null,
      rootEl,
      canvas,
      g,
      modal,
      lobby,
      pausePanel,
      resultPanel,
      live,
      hud,
      touch,
      minimap,
      mg,
      position,
      identity,
      identityPortrait,
      identityRole,
      identityName,
      identitySignature = "",
      lap,
      time,
      speed,
      fuel,
      driveFeedback,
      itemSlot, itemIcon, itemName, itemKey,
      banner,
      warning, warningCopy, warningSource, sourceG, threatMap, threatG,
      resultRows,
      resultTitle,
      description,
      hero,
      savedFocus,
      oldOverflow,
      inert = [],
      prefs = {},
      prefersReduced = false,
      padNeutral = true,
      padPrevious = {},
      pad = { steer: 0, boost: false, brake: false, recover: false },
      lastControl = { steer: 0, brake: false },
      lastPad = null,
      audio = null,
      perspective = null,
      previousPose = null,
      renderDt = 1 / 60,
      renderFrame = 0,
      itemRequest = createItemRequest(),
      displayedWarnings = Array(5).fill(0),
      noticeText = "", noticeUntil = 0, noticeTick = -1, noticeSerial = 0, warningSoundKey = "";
    const warningReceipt = createWarningReceipt();
    const flatPresentation = root.SpaceManRacePresentation?.createSampler();
    const flatCamera = root.SpaceManRaceCamera?.createTopdown();
    const audioControls = [], audioOverrides = {};
    let localSession = null, sharedSession = null, inputSuspended = false;
    let selected = { trackId: "starlight", difficulty: "normal" },
      keys = new Map(),
      touches = new Map(),
      listeners = [],
      trackButtons = [],
      difficultyButtons = [],
      camera = { x: 0, y: 0, rotation: 0 },
      recoveryTap = null,
      recoveryClickCleanup = null;
    let room = null,
      roomStatus = null,
      roomPaused = false,
      localRoomMenu = false,
      roomClosing = false;
    let roomReady, roomReadyRow, roomAutoLabel, roomAuto, roomVotes, roomAutoCancel, roomRejoin, againNote, againCancel,
      lastVoteNote = "";
    const social = () => root.SpaceManRoomSocial;
    const lastRoomEntry = () => opts.lastRoom && opts.lastRoom.load("race");
    function paintRejoin() {
      if (!roomRejoin) return;
      const r = social() && lastRoomEntry(),
        idle = !(roomStatus && (roomStatus.active || roomStatus.busy));
      roomRejoin.hidden = !(r && idle);
      if (r) setText(roomRejoin, "Rejoin " + social().lastRoomText(r));
    }
    let roomUtilities,
      roomDetails,
      roomEntry,
      roomBox,
      roomInput,
      roomInvite,
      roomHint,
      roomMembers,
      roomRole,
      roomLeave,
      roomCode,
      roomCopy,
      roomShare,
      watchTools,
      watchName;
    let roomButtons = [],
      watchId = null,
      roomSignature = "",
      networkEpoch = -1;
    const onlineActive = () => !!room?.active;
    const ownActor = () =>
      state?.actors.find((a) => a.controller === "human") || null;
    const followActor = () =>
      ownActor() ||
      state?.actors.find((a) => a.id === watchId) ||
      state?.actors[0];
    const canControl = () =>
      !onlineActive() ||
      (!!ownActor() &&
        !ownActor().forfeited &&
        ownActor().finishTick === null &&
        !roomStatus?.stale &&
        !roomStatus?.connection);
    function syncRoomChoices() {
      if (!room) return;
      paintRejoin();
      const online = onlineActive(),
        host = room.isHost,
        busy = room.busy;
      for (const b of [...trackButtons, ...difficultyButtons])
        setDisabled(b, busy || (online && !host));
      const launch = rootEl.querySelector(".race-launch");
      setDisabled(
        launch,
        busy || (online && (!host || !!roomStatus?.connection)),
      );
      const votes = online && roomStatus?.active ? roomStatus.votes : null;
      setText(
        launch,
        online
          ? host
            ? "Start together" + (votes && votes.ready.m > 1 ? " (" + votes.ready.n + "/" + votes.ready.m + " ready)" : "")
            : "Waiting for host…"
          : "Launch race",
      );
      for (const b of roomButtons) setDisabled(b, busy);
      setDisabled(roomInput, busy);
      for (const id of ["raceRestart", "raceNext"])
        setDisabled(rootEl.querySelector("#" + id), online && !host);
      {
        const rematch = rootEl.querySelector("#raceRematch"),
          seated = roomStatus?.info?.role === 0,
          again = votes && votes.again;
        if (!online) { setDisabled(rematch, false); setText(rematch, "Race again"); rematch.removeAttribute("aria-pressed"); }
        else if (host) {
          setDisabled(rematch, false);
          setText(rematch, "Race again together" + (again && again.m > 1 ? " (" + again.n + "/" + again.m + " want one)" : ""));
          rematch.removeAttribute("aria-pressed");
        } else if (!seated || !again) { setDisabled(rematch, true); setText(rematch, "Waiting for host…"); rematch.removeAttribute("aria-pressed"); }
        else {
          // Pending stays focusable (aria-disabled) so keyboard focus survives the tap.
          setDisabled(rematch, !!roomStatus.connection);
          rematch.setAttribute("aria-disabled", String(again.pending));
          rematch.setAttribute("aria-pressed", String(again.mine));
          setText(rematch, again.pending ? "Telling the host…" : again.mine ? "Waiting for host… · tap to undo" : "Race again?");
        }
      }
      paintVotes(votes);
      const resume = rootEl.querySelector("#raceResume");
      setDisabled(
        resume,
        online && ((!host && roomPaused) || !!roomStatus?.connection),
      );
      setText(resume, resume.disabled ? "Waiting for host…" : "Resume race");
      rootEl.querySelector("#raceLobby").hidden = !!(localSession || sharedSession);
      rootEl.querySelector("#raceRestart").hidden = !!sharedSession;
      setText(
        rootEl.querySelector("#raceLobby"),
        (localSession || sharedSession) ? "Finish expedition" : online
          ? host
            ? "Back to room lobby"
            : "Leave race room"
          : "Choose a circuit",
      );
      setText(
        rootEl.querySelector(".race-setup > .race-local-note"),
        online
          ? "Shared laps, boost and collisions. Empty grid slots get CPUs."
          : "3 laps · You + 4 CPU pilots",
      );
      touch.hidden = view !== "play" || paused || (online && !canControl());
      watchTools.hidden = !online || view !== "play" || paused || !!ownActor();
      if (!watchTools.hidden)
        setText(watchName, "WATCHING " + (followActor()?.name || "RACE"));
    }
    function paintVotes(votes) {
      if (!roomReady) return;
      const host = room.isHost,
        seated = roomStatus?.info?.role === 0,
        inLobby = roomStatus?.current?.status === "lobby",
        names = new Map((roomStatus?.roster || []).map((r) => [r.p, r.callsign || "PLAYER " + r.p])),
        who = (ps) => ps.map((p) => names.get(p) || "PLAYER " + p).join(", ");
      roomReadyRow.hidden = !(votes && seated && inLobby);
      let note = "", resultNote = "";
      if (votes) {
        const r = votes.ready, a = votes.again;
        roomReady.setAttribute("aria-pressed", String(r.mine));
        setDisabled(roomReady, !!roomStatus.connection);
        roomReady.setAttribute("aria-disabled", String(r.pending));
        setText(roomReady, r.pending ? "Telling the host…" : r.mine ? "Ready ✓ · tap to undo" : "I’m ready");
        roomAutoLabel.hidden = !host;
        roomAuto.checked = votes.autoStart;
        roomAutoCancel.hidden = votes.auto !== "ready";
        if (host)
          note = votes.auto === "ready" ? "Everyone is ready. Starting in a few seconds…"
            : r.m > 1 ? r.n + " of " + r.m + " ready" + (r.missing.length && r.n ? " · waiting for " + who(r.missing) : "") : "";
        else if (r.unconfirmed) note = "Sent. If the host runs an older version they will not see your ready signal.";
        else if (r.mine) note = "You are ready. The host starts the race.";
        againCancel.hidden = votes.auto !== "again";
        if (host)
          resultNote = votes.auto === "again" ? "Everyone wants another race. Starting in a few seconds…"
            : a.m > 1 ? a.n + " of " + a.m + " want another race" + (a.missing.length ? " · waiting for " + who(a.missing) : "") : "";
        else if (a.unconfirmed) resultNote = "Sent. If the host runs an older version they will not see your rematch request.";
        else if (a.mine) resultNote = "You asked for another race. Waiting for the host.";
      } else { roomAutoCancel.hidden = true; againCancel.hidden = true; }
      setText(roomVotes, note);
      setText(againNote, resultNote);
      const spoken = (inLobby ? note : resultNote) || "";
      if (spoken && spoken !== lastVoteNote) announce(spoken);
      lastVoteNote = spoken;
    }
    function roomChanged(status) {
      if (!active || roomClosing) return;
      const previous = roomStatus;
      roomStatus = status;
      rootEl.dataset.online = String(status.active);
      roomEntry.hidden = status.active;
      roomBox.hidden = !status.active;
      roomLeave.hidden = !status.active && !status.busy;
      setText(
        roomLeave,
        status.busy
          ? "Cancel connecting"
          : status.host
            ? "Close race room"
            : "Leave race room",
      );
      setText(
        roomHint,
        status.error ||
          status.closedReason ||
          (status.busy
            ? "Connecting… You can cancel below."
            : status.connection ||
              (status.stale
                ? "Waiting for host · controls released"
                : status.active
                  ? status.host
                    ? "You host the race. Keep this tab open; stepping away pauses everyone."
                    : "The host chooses the circuit. Mid-race arrivals watch until the next lobby."
                  : "Up to 4 friends + 4 spectators. CPUs fill the five-pilot grid.")),
      );
      if (status.active) {
        const signature = JSON.stringify(
          status.roster.map((r) => [r.p, r.callsign, r.role]),
        ) + (status.votes && status.current?.status === "lobby" ? "|" + status.votes.ready.missing : "");
        if (signature !== roomSignature) {
          roomSignature = signature;
          roomMembers.replaceChildren();
          for (const r of status.roster)
            roomMembers.append(
              el(
                "li",
                "",
                (r.callsign || "PLAYER " + r.p) +
                  (r.you ? " · YOU" : "") +
                  (r.host ? " · HOST" : "") +
                  (r.spectator ? " · WATCHING" : " · RACER") +
                  (status.votes && status.current?.status === "lobby" && !r.spectator && !status.votes.ready.missing.includes(r.p) ? " · READY ✓" : ""),
              ),
            );
        }
        const link =
          status.host && typeof status.info.link === "string"
            ? status.info.link
            : "";
        if (roomInvite.value !== link) roomInvite.value = link;
        roomInvite.hidden = roomCopy.hidden = roomShare.hidden = !link;
        setText(
          roomCode,
          status.info.joinCode ||
            (link ? "Invite link · same build" : "Friend race"),
        );
        setText(
          roomRole,
          status.info.role === 1 ? "Join next race" : "Watch instead",
        );
        setDisabled(
          roomRole,
          !status.current || status.current.status !== "lobby",
        );
        const interrupted = !!(status.connection || status.stale),
          wasInterrupted = !!(previous?.connection || previous?.stale),
          ownershipChanged = previous?.active &&
            (previous.info?.role !== status.info?.role || previous.info?.myP !== status.info?.myP);
        // Clear queued native presses as well as held controls. Only transitions
        // release, so repeated stale-status refreshes cannot exhaust generations.
        if (interrupted !== wasInterrupted || ownershipChanged) resetInput();
      } else if (previous?.active || status.closedReason) {
        state = null;
        view = "lobby";
        paused = roomPaused = localRoomMenu = false;
        networkEpoch = -1;
        roomSignature = "";
        setPanel(lobby);
        announce(status.closedReason || "Left race room");
      }
      syncRoomChoices();
    }
    function networkSnapshot(snapshot) {
      if (!active || roomClosing) return;
      const old = state,
        next = snapshot.state,
        choicesChanged =
          selected.trackId !== next.trackId ||
          selected.difficulty !== next.difficulty;
      selected.trackId = next.trackId;
      selected.difficulty = next.difficulty;
      if (snapshot.status === "lobby") {
        const enteringLobby = view !== "lobby" || !!state;
        if (enteringLobby) {
          resetInput();
          state = null;
          view = "lobby";
          paused = roomPaused = localRoomMenu = false;
          setPanel(lobby);
        }
        networkEpoch = -1;
        if (enteringLobby || choicesChanged) syncChoices();
        else syncRoomChoices();
        return;
      }
      const newRound =
        !old ||
        old.tick > next.tick ||
        old.trackId !== next.trackId ||
        (old.phase === "finished" && next.phase !== "finished");
      const oldPilot = old?.actors.find(a => a.controller === "human"),
        nextPilot = next.actors.find(a => a.controller === "human"),
        inputChanged = networkEpoch !== snapshot.epoch ||
          oldPilot?.id !== nextPilot?.id || oldPilot?.peerP !== nextPilot?.peerP;
      state = next;
      networkEpoch = snapshot.epoch;
      // A lost paused snapshot can hide an entire pause/resume cycle. The epoch
      // still invalidates the old native queue, even at the same simulation tick.
      if (inputChanged && !newRound) resetInput();
      if (newRound) {
        cosmeticRound++;
        previousPose = null;
        perspective?.reset();
        flatPresentation?.reset();
        flatCamera?.reset();
        resetInput();
        view = "play";
        paused = roomPaused = localRoomMenu = false;
        last = 0;
        acc = 0;
        watchId = null;
        const a = followActor();
        camera = {
          x: a.x,
          y: a.y,
          rotation: height > width && !calm() ? -a.heading - Math.PI / 2 : 0,
        };
        setPanel(null);

      }
      const wasPaused = roomPaused;
      roomPaused = snapshot.status === "paused";
      if (roomPaused) {
        paused = true;
        resetInput();
        setText(
          pausePanel.querySelector("p"),
          snapshot.isHost
            ? "The whole race is paused. Resume when you’re ready."
            : "The host paused the race. Everyone is safely parked.",
        );
        if (rootEl.dataset.screen !== "pause") setPanel(pausePanel);
      } else if (wasPaused && !localRoomMenu) {
        paused = false;
        setPanel(null);
      }
      if (state.phase === "finished" && view !== "results") {
        paused = false;
        localRoomMenu = false;
        results();
      }
      if (!paused && !document.hidden) audio?.update(state, followActor());
      syncRoomChoices();
      ensureFrame();
    }
    function cycleWatch(direction) {
      if (!state) return;
      const list = state.actors;
      const i = list.findIndex((a) => a.id === followActor()?.id);
      watchId = list[(i + direction + list.length) % list.length].id;
      syncRoomChoices();
    }
    function leaveRaceRoom() {
      if (!room) return true;
      if (
        room.active &&
        room.isHost &&
        (roomStatus?.info.players || 0) + (roomStatus?.info.spectators || 0) >
          1 &&
        !root.confirm("Close the race room? This ends the race for everyone.")
      )
        return false;
      roomClosing = true;
      room.close();
      roomClosing = false;
      roomStatus = null;
      roomPaused = localRoomMenu = false;
      networkEpoch = -1;
      roomSignature = "";
      state = null;
      view = "lobby";
      paused = false;
      resetInput();
      setPanel(lobby);
      roomChanged(room.status());
      return true;
    }
    function buildRoomControls() {
      if (!opts.net || !root.SpaceManRaceRoom) return;
      roomDetails = el("details", "race-online-panel");
      roomDetails.append(
        el("summary", "", "Play with friends · Create, join or watch"),
      );
      roomEntry = el("div", "race-online-entry");
      const host = button("Create race room", "race-primary", async () => {
        roomDetails.open = true;
        await room.hosting(selected);
      });
      host.id = "raceHost";
      roomInput = el("input", "race-room-input");
      roomInput.id = "raceRoomInput";
      roomInput.placeholder = opts.build?.preview
        ? "Full invite link from this preview"
        : "Room code or invite link";
      roomInput.setAttribute("aria-label", "Race room code or invite link");
      roomInput.autocomplete = "off";
      const join = button("Join race", "", () => room.join(roomInput.value, 0));
      join.id = "raceJoin";
      const watch = button("Watch race", "race-text", () =>
        room.join(roomInput.value, 1),
      );
      watch.id = "raceWatch";
      roomButtons = [host, join, watch];
      const joins = el("div", "race-online-actions");
      joins.append(join, watch);
      roomRejoin = button("Rejoin last room", "race-text", () => {
        const r = lastRoomEntry();
        if (!r) return;
        const text = social().lastRoomText(r);
        roomInput.value = text;
        room.join(text, 0);
      });
      roomRejoin.id = "raceRejoin";
      roomRejoin.hidden = true;
      roomEntry.append(host, roomInput, joins, roomRejoin);
      roomBox = el("div");
      roomBox.hidden = true;
      roomCode = el("strong", "race-room-code");
      roomMembers = el("ul", "race-room-members");
      roomMembers.id = "raceRoomMembers";
      roomInvite = el("input", "race-room-input");
      roomInvite.id = "raceInvite";
      roomInvite.readOnly = true;
      roomInvite.setAttribute("aria-label", "Race invite link");
      roomCopy = button("Copy invite link", "", async () => {
        try {
          await root.navigator.clipboard.writeText(roomInvite.value);
          roomHint.textContent = "Invite copied. Send it to your friends.";
        } catch (_) {
          roomInvite.focus();
          roomInvite.select();
          roomHint.textContent = "Select and copy this invite link.";
        }
      });
      roomShare = button("Share", "race-text", async () => {
        if (root.navigator.share) {
          try {
            await root.navigator.share({
              title: "Space Man · Star Circuit",
              url: roomInvite.value,
            });
          } catch (_) {}
        } else roomCopy.click();
      });
      roomRole = button("Watch instead", "race-text", async () => {
        roomRole.disabled = true;
        const ok = await room.role(roomStatus.info.role === 1 ? 0 : 1);
        if (!ok)
          roomHint.textContent =
            "No seat available yet. Try again in the next lobby.";
      });
      roomRole.id = "raceRoomRole";
      const sharing = el("div", "race-online-actions");
      sharing.append(roomCopy, roomShare, roomRole);
      roomReadyRow = el("div", "race-ready-row");
      roomReadyRow.hidden = true;
      roomReady = button("I’m ready", "", () => room.vote("ready"));
      roomReady.id = "raceReady";
      roomReady.setAttribute("aria-pressed", "false");
      roomAutoLabel = el("label", "race-auto-label");
      roomAuto = el("input");
      roomAuto.type = "checkbox";
      roomAuto.checked = true;
      roomAuto.id = "raceAutoStart";
      roomAuto.addEventListener("change", () => room.setAutoStart(roomAuto.checked));
      roomAutoLabel.append(roomAuto, document.createTextNode("Auto-start when everyone is ready"));
      roomVotes = el("p", "race-vote-note");
      roomVotes.id = "raceReadyNote";
      roomAutoCancel = button("Cancel auto-start", "race-text", () => room.cancelAuto());
      roomAutoCancel.id = "raceAutoCancel";
      roomAutoCancel.hidden = true;
      roomReadyRow.append(roomReady, roomVotes, roomAutoLabel, roomAutoCancel);
      roomBox.append(roomCode, roomMembers, roomReadyRow, roomInvite, sharing);
      roomHint = el("p", "race-local-note");
      roomHint.id = "raceRoomHint";
      roomHint.setAttribute("role", "status");
      roomLeave = button("Leave race room", "race-text", leaveRaceRoom);
      roomLeave.id = "raceRoomLeave";
      roomLeave.hidden = true;
      roomDetails.append(roomEntry, roomBox, roomHint, roomLeave);
      roomDetails.addEventListener("toggle", paintRejoin);
      roomUtilities.prepend(roomDetails);
      watchTools = el("div", "race-watch-tools");
      watchTools.hidden = true;
      const previous = button("←", "race-small", () => cycleWatch(-1));
      previous.id = "raceWatchPrevious";
      previous.setAttribute("aria-label", "Watch previous kart");
      const next = button("→", "race-small", () => cycleWatch(1));
      next.id = "raceWatchNext";
      next.setAttribute("aria-label", "Watch next kart");
      watchName = el("span");
      watchName.id = "raceWatchName";
      watchTools.append(previous, watchName, next);
      rootEl.append(watchTools);
      room = root.SpaceManRaceRoom.create({
        net: opts.net,
        build: opts.build,
        identity: opts.identity,
        hostOptions: opts.hostOptions,
        baseUrl: opts.baseUrl,
        lastRoom: opts.lastRoom,
        onAutoStart: () => { if (room?.isHost) start(); },
        onChange: roomChanged,
        onSnapshot: networkSnapshot,
      });
    }

    const fmt = (t) => {
      const s = Math.max(0, t);
      return Math.floor(s / 60) + ":" + (s % 60).toFixed(2).padStart(5, "0");
    };
    const listen = (target, type, fn, settings) => {
      target.addEventListener(type, fn, settings);
      listeners.push([target, type, fn, settings]);
    };
    const isRunning = () => active && state && !paused && view === "play";
    const announce = (text) => {
      live.textContent = text;
    };
    const calm = () =>
      prefs.reduceMotion === undefined ? prefersReduced : !!prefs.reduceMotion;
    function preferences() {
      prefs = { ...(typeof opts.settings === "function" ? opts.settings() : {}), ...audioOverrides };
      syncAudioControls();
      prefersReduced = !!root.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches;
      rootEl.dataset.calm = String(calm());
      rootEl.dataset.handed =
        prefs.lefty || prefs.handedness === "left" || prefs.leftHanded
          ? "left"
          : "right";
    }
    function load() {
      try {
        const v = JSON.parse(
          root.localStorage.getItem(opts.storageKey || "sm2.race.v1"),
        );
        if (v && R.tracks.some((t) => t.id === v.trackId))
          selected.trackId = v.trackId;
        if (v && ["easy", "normal", "hard"].includes(v.difficulty))
          selected.difficulty = v.difficulty;
      } catch (_) {}
    }
    function save() {
      if (localSession || sharedSession) return; // Expedition settings are temporary.
      try {
        root.localStorage.setItem(
          opts.storageKey || "sm2.race.v1",
          JSON.stringify(selected),
        );
      } catch (_) {}
    }
    function raceAudio() {
      if (!audio && root.SpaceManRaceAudio) audio = root.SpaceManRaceAudio.create({
        getSettings: () => ({ ...(typeof opts.settings === "function" ? opts.settings() : prefs), ...audioOverrides }),
      });
      return audio;
    }
    function syncAudioControls() {
      for (const { mute, music, volume } of audioControls) {
        setText(mute, prefs.muted ? "Sound off" : "Sound on");
        mute.setAttribute("aria-pressed", String(!prefs.muted));
        setText(music, prefs.music === false ? "Music off" : "Music on");
        music.setAttribute("aria-pressed", String(prefs.music !== false));
        volume.value = String(Math.round(Math.max(prefs.musicVol ?? .5, prefs.sfxVol ?? .5) * 100));
      }
    }
    function audioSetting(changes) {
      if (typeof opts.onAudioSettings === "function") opts.onAudioSettings(changes);
      else Object.assign(audioOverrides, changes);
      preferences();
      if (isRunning()) raceAudio()?.unlock();
      announce(prefs.muted ? "Race audio muted" : "Race audio updated");
    }
    function buildAudioControls(parent) {
      const row = el("div", "race-audio-controls");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Race audio");
      const mute = button("Sound on", "race-small", () => audioSetting({ muted: !prefs.muted }));
      mute.setAttribute("aria-label", "Toggle race sound");
      const music = button("Music on", "race-small", () => audioSetting({ music: prefs.music === false }));
      music.setAttribute("aria-label", "Toggle race music");
      const label = el("label", "race-audio-volume", "Volume"), volume = el("input");
      volume.type = "range"; volume.min = "0"; volume.max = "100"; volume.step = "1";
      volume.setAttribute("aria-label", "Race audio volume");
      volume.addEventListener("input", () => audioSetting({ musicVol: Number(volume.value)/100, sfxVol: Number(volume.value)/100 }));
      label.append(volume); row.append(mute, music, label); parent.append(row);
      audioControls.push({ mute, music, volume });
    }
    function unlockAudioGesture(e) {
      if (!ownsInput()) return;
      if (!active || !e.isTrusted) return;
      const controller = raceAudio(), inMenu = view === "lobby" || paused;
      // Keep the first menu gesture for online host-start permission. Once
      // authorized, menu controls must not queue a native resume after stop.
      // Explicit launch/resume handlers still unlock inside their own gesture.
      if (inMenu && controller?.diagnostics().unlocked) return;
      controller?.unlock();
      if (inMenu) controller?.pause();
    }
    function cancelCorner() {
      lastControl = { steer: 0, brake: false };
      itemRequest.reset(); displayedWarnings = Array(5).fill(0); warningReceipt.reset(); warningSoundKey = "";
      if (onlineActive()) room.release();
      else R.cancelControl(state);
    }
    function resetTouch() {
      const old = Array.from(touches);
      if (old.length) cancelCorner();
      touches.clear();
      recoveryTap = null;
      for (const [id, t] of old) {
        t.el.classList.remove("race-pressed");
        try {
          if (t.el.hasPointerCapture(id)) t.el.releasePointerCapture(id);
        } catch (_) {}
      }
    }
    function resetInput() {
      rescueRequest = false;
      cancelCorner();
      keys.clear();
      resetTouch();
      pad = { steer: 0, boost: false, brake: false, recover: false };
      padNeutral = true;
    }
    function ownsInput() {
      if (!active) return false;
      const suspended = !!rootEl.inert;
      if (suspended !== inputSuspended) { inputSuspended = suspended; resetInput(); }
      return !suspended;
    }
    function release(e) {
      const t = touches.get(e.pointerId);
      if (!t) return;
      if (e.type === "pointercancel" || e.type === "lostpointercapture") cancelCorner();
      touches.delete(e.pointerId);
      if (!Array.from(touches.values()).some((x) => x.el === t.el))
        t.el.classList.remove("race-pressed");
      try {
        if (t.el.hasPointerCapture(e.pointerId))
          t.el.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
    function guard(e) {
      if (!ownsInput()) return;
      if (["pointerup", "pointercancel", "lostpointercapture"].includes(e.type))
        release(e);
      if (
        e.type === "pointerdown" &&
        e.pointerType !== "mouse" &&
        e.isPrimary &&
        touches.size &&
        !touches.has(e.pointerId)
      )
        resetTouch();
      if (!(e.target instanceof root.Node) || !rootEl.contains(e.target)) {
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
      }
    }
    function touchEnd(e) {
      if (!ownsInput()) return;
      if (e.type === "touchcancel" || (e.touches && e.touches.length === 0))
        resetTouch();
    }
    // Settings > Keyboard actions → race actions. Bound keys win over the fixed
    // alternates below; Esc always pauses and Space still boosts.
    const BOUND_ACTIONS = { left: "left", right: "right", down: "brake", dash: "boost", rescue: "recover", fire: "item" };
    function actionFor(e) {
      const key = (e.key || "").toLowerCase();
      if (prefs.keys) {
        for (const a in BOUND_ACTIONS)
          if (prefs.keys[a] === key) return BOUND_ACTIONS[a];
        if (prefs.keys.camera === key || prefs.keys.pause === key) return undefined;   // bound to a non-driving action
      }
      const fixed = {
        ArrowLeft: "left",
        KeyA: "left",
        ArrowRight: "right",
        KeyD: "right",
        ArrowDown: "brake",
        KeyS: "brake",
        Space: "boost",
        ShiftLeft: "boost",
        ShiftRight: "boost",
        KeyR: "recover",
      }[e.code];
      if (fixed) return fixed;
      // Keep all established driving/camera/menu bindings ahead of Item remaps.
      if (["KeyC", "Escape", "Tab", "Enter"].includes(e.code)) return undefined;
      if (e.code === "KeyF" || e.code === "KeyJ") return "item";
      return undefined;
    }
    function focusables() {
      return Array.from(
        (modal.hidden ? hud : modal).querySelectorAll(
          "button:not([disabled]),input:not([disabled]),summary",
        ),
      ).filter((n) => n.getClientRects().length);
    }
    function focusStep(d) {
      const nodes = focusables(),
        i = nodes.indexOf(document.activeElement);
      if (nodes.length) nodes[(i + d + nodes.length) % nodes.length].focus();
    }
    function escape() {
      if (sharedSession && !state) { sharedSession.adapter.openCrew?.(); return; }
      if (view === "lobby") close();
      else if (view === "results") showLobby();
      else if (paused) resume();
      else pause();
    }
    function keydown(e) {
      if (!ownsInput()) return;
      e.stopImmediatePropagation();
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (!e.repeat) escape();
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        if (sharedSession && !state) { sharedSession.adapter.openCrew?.(); return; }
        if (!isRunning()) focusStep(e.shiftKey ? -1 : 1);   // Tab never pauses a live race (Esc does)
        return;
      }
      const bound = (e.key || "").toLowerCase();
      if (prefs.keys?.pause && bound === prefs.keys.pause && e.target?.tagName !== "INPUT" && (isRunning() || paused)) {
        e.preventDefault();
        if (!e.repeat) escape();   // the bound Pause key acts like Esc during a race (and resumes), never in the lobby
        return;
      }
      if (!modal.hidden) {
        if (e.target?.tagName === "INPUT") return;
        if (["Enter", "Space"].includes(e.code)) {
          e.preventDefault();
          if (!e.repeat && modal.contains(document.activeElement))
            document.activeElement.click();
        } else if (e.code.startsWith("Arrow")) {
          e.preventDefault();
          focusStep(["ArrowLeft", "ArrowUp"].includes(e.code) ? -1 : 1);
        }
        return;
      }
      if (e.target === itemSlot && ["Enter", "Space"].includes(e.code)) {
        e.preventDefault();
        if (!e.repeat && isRunning() && canControl() && ownActor()?.item) itemRequest.request();
        return;
      }
      if (!e.repeat && bound === (prefs.keys?.camera || "c") && !actionFor(e)) {
        e.preventDefault();
        perspective?.cycle();
        return;
      }
      const a = actionFor(e);
      if (a) {
        e.preventDefault();
        if (e.repeat && !keys.has(e.code)) return;
        if (a === "item" && !e.repeat && isRunning() && canControl() && ownActor()?.item) itemRequest.request();
        keys.set(e.code, a);
      }
    }
    function keyup(e) {
      if (!ownsInput()) return;
      e.stopImmediatePropagation();
      if (actionFor(e)) e.preventDefault();
      keys.delete(e.code);
    }
    function pollPad() {
      if (!ownsInput()) return;
      let p;
      try {
        p = Array.from(root.navigator.getGamepads?.() || []).find(
          (p) => p && p.connected,   // mapping "" pads get the standard indices; the page announces them
        );
      } catch (_) {}
      if (!p) {
        pad = { steer: 0, boost: false, brake: false, recover: false };
        lastPad = null;
        return;
      }
      if (lastPad !== p.index) {
        lastPad = p.index;
        padNeutral = true;
        padPrevious = {};
      }
      const b = (i) =>
        !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.55));
      const raw = {
          boost: b(0) || b(7),
          brake: b(1) || b(6),
          recover: b(2),
          item: b(5),
          pause: b(9),
          left: b(14) || p.axes[0] < -0.55,
          right: b(15) || p.axes[0] > 0.55,
          up: b(12) || p.axes[1] < -0.55,
          down: b(13) || p.axes[1] > 0.55,
        },
        steer = b(14)
          ? -1
          : b(15)
            ? 1
            : Math.abs(p.axes[0] || 0) > 0.17
              ? p.axes[0]
              : 0;
      if (padNeutral) {
        if (!Object.values(raw).some(Boolean) && !steer) padNeutral = false;
        padPrevious = raw;
        return;
      }
      const edge = (k) => raw[k] && !padPrevious[k];
      if (edge("pause")) escape();
      else if (!modal.hidden) {
        if (edge("left") || edge("up")) focusStep(-1);
        if (edge("right") || edge("down")) focusStep(1);
        if (edge("boost") && modal.contains(document.activeElement))
          document.activeElement.click();
        if (edge("brake")) escape();
      } else {
        if (edge("item") && isRunning() && canControl() && ownActor()?.item) itemRequest.request();
        pad = {
          steer,
          boost: raw.boost,
          brake: raw.brake,
          recover: raw.recover,
          item: raw.item,
        };
      }
      padPrevious = raw;
    }
    function input() {
      if (!ownsInput()) return { steer: 0, throttle: 0, boost: false, brake: false, recover: false };
      const held = (a) =>
        Array.from(keys.values()).includes(a) ||
        Array.from(touches.values()).some((t) => t.action === a);
      return {
        steer: clamp(
          (held("right") ? 1 : 0) - (held("left") ? 1 : 0) + pad.steer,
          -1,
          1,
        ),
        throttle: 1,
        boost: held("boost") || pad.boost,
        brake: held("brake") || pad.brake,
        recover: held("recover") || pad.recover,
        item: itemRequest.sample(held("item") || pad.item, !onlineActive() || room.itemReady?.() !== false),
        warnings: displayedWarnings.slice(),
      };
    }
    // Recovery taps are idempotent and work even when iOS drops a click after a canceled drag.
    function recoveryButton(text, cls, fn) {
      const n = button(text, cls, fn);
      n.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch" && e.isPrimary)
          recoveryTap = { el: n, id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      n.addEventListener("pointermove", (e) => {
        if (
          recoveryTap?.el === n &&
          Math.hypot(e.clientX - recoveryTap.x, e.clientY - recoveryTap.y) > 10
        )
          recoveryTap = null;
      });
      for (const type of ["pointercancel", "lostpointercapture"])
        n.addEventListener(type, () => {
          recoveryTap = null;
        });
      n.addEventListener("pointerup", (e) => {
        const t = recoveryTap;
        if (!t || t.el !== n || t.id !== e.pointerId) return;
        recoveryTap = null;
        const r = n.getBoundingClientRect();
        if (
          Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 ||
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          return;
        if (recoveryClickCleanup) recoveryClickCleanup();
        let timer;
        const clear = () => {
          root.removeEventListener("click", swallow, true);
          root.removeEventListener("pointerdown", clear, true);
          root.clearTimeout(timer);
          recoveryClickCleanup = null;
        };
        const swallow = (e) => {
          if (rootEl && rootEl.inert) { clear(); return; }
          if (!e.isTrusted || e.detail === 0) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          clear();
        };
        root.addEventListener("click", swallow, true);
        root.addEventListener("pointerdown", clear, true);
        timer = root.setTimeout(clear, 700);
        recoveryClickCleanup = clear;
        fn();
      });
      return n;
    }
    function setPanel(panel) {
      if (panel === lobby) audio?.stop();
      else if (panel === pausePanel || document.hidden) audio?.pause();
      else if (!paused && state) audio?.resume();
      modal.hidden = !panel;
      for (const p of [lobby, pausePanel, resultPanel]) p.hidden = p !== panel;
      hud.hidden = view === "lobby";
      touch.hidden = !!panel || (onlineActive() && !canControl());
      if (watchTools)
        watchTools.hidden = !!panel || !onlineActive() || !!ownActor();
      minimap.hidden = view === "lobby";
      rootEl.dataset.screen =
        view === "lobby"
          ? "lobby"
          : view === "results"
            ? "results"
            : paused
              ? "pause"
              : "play";
      if (panel) {
        // A returned lobby or reopened pause menu must not focus an offscreen
        // control left above the previous scroll position.
        panel.scrollTop = 0;
        const b = panel.querySelector("button");
        b?.focus({ preventScroll: true });
      } else canvas.focus({ preventScroll: true });
    }
    function syncChoices() {
      trackButtons.forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.track === selected.trackId),
        ),
      );
      difficultyButtons.forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.difficulty === selected.difficulty),
        ),
      );
      setText(description, R.course(selected.trackId).subtitle);
      save();
      drawHero();
      syncRoomChoices();
    }
    function build() {
      if (built) return;
      if (!R) throw Error("Race simulation is unavailable");
      load();
      rootEl = el("section", "race-root");
      rootEl.id = "raceRoot";
      rootEl.hidden = true;
      rootEl.setAttribute("aria-label", "Space Man Star Circuit");
      const style = el("style");
      style.textContent = CSS;
      rootEl.append(style);
      canvas = el("canvas", "race-canvas");
      canvas.tabIndex = -1;
      canvas.setAttribute(
        "aria-label",
        "Star Circuit. Auto acceleration. Left and right to steer, Down to brake; brake while turning to drift, release the brake after a corner for boost. Space to boost, F or J to use an item, R to recover, Escape to pause.",
      );
      g = canvas.getContext("2d", { alpha: false });
      rootEl.append(canvas);
      perspective = root.SpaceManRaceView?.create({
        root: rootEl,
        canvas,
        storageKey: opts.storageKey,
        settings: () => prefs,
        announce,
      });
      hud = el("div", "race-hud");
      const stats = el("div", "race-hud-box");
      position = el("div", "race-position");
      const lapWrap = el("div", "race-metric");
      lap = el("strong");
      lapWrap.append(el("span", "", "LAP"), lap);
      stats.append(position, lapWrap);
      const left = el("div", "race-hud-left");
      identity = el("div", "race-identity");
      identityPortrait = el("canvas");
      identityPortrait.width = identityPortrait.height = 72;
      identityPortrait.setAttribute("aria-hidden", "true");
      const identityCopy = el("div", "race-identity-copy");
      identityRole = el("span", "race-identity-role");
      identityName = el("span", "race-identity-name");
      identityCopy.append(identityRole, identityName);
      identity.append(identityPortrait, identityCopy);
      left.append(stats, identity);
      const right = el("div", "race-hud-right");
      time = el("div", "race-time", "0:00.00");
      const pb = button("Ⅱ", "race-pause", () => pause());
      pb.setAttribute("aria-label", "Pause race");
      right.append(time, pb);
      hud.append(left, right);
      rootEl.append(hud);
      const speedWrap = el("div", "race-speed");
      speed = el("strong", "", "0");
      const bar = el("div", "race-boostbar");
      fuel = el("div", "race-boostfill");
      bar.append(fuel);
      speedWrap.append(
        speed,
        el("span", "", "  KM/H"),
        bar,
        el("span", "", "BOOST RESERVE"),
      );
      driveFeedback = el("div", "race-drive-feedback", "");
      driveFeedback.hidden = true;
      speedWrap.append(driveFeedback);
      rootEl.append(
        speedWrap,
        el(
          "div",
          "race-hint",
          "← → STEER · ↓ + TURN DRIFT · F / J ITEM",
        ),
      );
      minimap = el("canvas", "race-minimap");
      minimap.width = 340;
      minimap.height = 240;
      mg = minimap.getContext("2d");
      rootEl.append(minimap);
      banner = el("div", "race-banner");
      warning = el("div", "race-warning");
      warning.setAttribute("role", "status");
      warningCopy = el("span");
      warningSource = el("canvas", "race-warning-source");
      warningSource.width = warningSource.height = 28; warningSource.hidden = true;
      warningSource.setAttribute("role", "img"); sourceG = warningSource.getContext("2d");
      threatMap = el("canvas", "race-threat-map");
      threatMap.width = 280; threatMap.height = 60;
      threatMap.setAttribute("role", "img"); threatMap.hidden = true;
      threatG = threatMap.getContext("2d");
      warning.append(warningSource, warningCopy, threatMap);
      rootEl.append(banner, warning);
      itemSlot = button("", "race-item", e => {
        if (e.detail === 0 && isRunning() && canControl() && ownActor()?.item) itemRequest.request();
      });
      itemSlot.dataset.action = "item";
      itemSlot.setAttribute("aria-label", "Use item");
      itemSlot.hidden = true;
      itemIcon = el("span", "race-item-icon", "◇");
      itemName = el("span", "race-item-name", "ITEM");
      itemKey = el("span", "race-item-key", "F / J");
      itemSlot.append(itemIcon, itemName, itemKey);
      itemSlot.addEventListener("pointerdown", e => {
        if (!isRunning() || !canControl() || !ownActor()?.item) return;
        e.preventDefault();
        itemRequest.request();
        if (e.pointerType === "mouse") return;
        rootEl.dataset.touch = "true";
        touches.set(e.pointerId, { action: "item", el: itemSlot });
        itemSlot.classList.add("race-pressed");
        try { itemSlot.setPointerCapture(e.pointerId); } catch (_) {}
      });
      rootEl.append(itemSlot);
      touch = el("div", "race-touch");
      const steering = el("div", "race-touch-group race-steering"),
        actions = el("div", "race-touch-group race-actions");
      for (const [action, label, parent] of [
        ["left", "‹", steering],
        ["right", "›", steering],
        ["brake", "↙", actions],
        ["boost", "✦", actions],
      ]) {
        const b = button(
          "",
          "race-touch-button " + (action === "boost" ? "race-touch-boost" : ""),
          () => {},
        );
        b.append(el("span", "", label), el("small", "", action === "brake" ? "BRAKE / DRIFT" : action.toUpperCase()));
        b.setAttribute(
          "aria-label",
          action === "left"
            ? "Steer left"
            : action === "right"
              ? "Steer right"
              : action === "brake"
                ? "Brake"
                : "Boost",
        );
        if (action === "brake") b.setAttribute("aria-description", "Hold while steering to drift. Hold through a corner, then release for a short boost. Brake alone slows down.");
        b.dataset.action = action;
        b.addEventListener("pointerdown", (e) => {
          if (!isRunning() || e.pointerType === "mouse") return;
          e.preventDefault();
          rootEl.dataset.touch = "true";
          touches.set(e.pointerId, { action, el: b });
          b.classList.add("race-pressed");
          try {
            b.setPointerCapture(e.pointerId);
          } catch (_) {}
        });
        parent.append(b);
      }
      const rescue = button("RESCUE ↺", "race-recover", () => {
        if (isRunning()) rescueRequest = true;
      });
      rescue.setAttribute("aria-label", "Rescue kart to last checkpoint");
      touch.append(steering, actions, rescue);
      rootEl.append(touch);
      modal = el("div", "race-modal");
      lobby = el("div", "race-dialog race-lobby");
      lobby.setAttribute("role", "dialog");
      lobby.setAttribute("aria-label", "Choose your race");
      const header = el("div", "race-lobby-header");
      header.append(
        el("span", "race-kicker", "SPACE MAN / STAR CIRCUIT"),
        recoveryButton("← All games", "race-text race-small", close),
      );
      const grid = el("div", "race-grid"),
        intro = el("div", "race-intro");
      const title = el("h1", "race-title", "Find your ");
      title.append(el("span", "", "fast lane."));
      hero = el("canvas", "race-hero");
      hero.width = 780;
      hero.height = 340;
      const facts = el("div", "race-facts");
      for (const [a, b] of [
        ["3 laps", "One great orbit"],
        ["5 pilots", "You + 4 CPUs"],
        ["All boost", "No brakes required*"],
      ]) {
        const x = el("div");
        x.append(el("strong", "", a), el("span", "", b));
        facts.append(x);
      }
      facts.lastChild.lastChild.textContent = "Until the next bend";
      intro.append(
        el("span", "race-pill", "STAR CIRCUIT"),
        title,
        el(
          "p",
          "race-lede",
          "Steer into the bends. Catch a boost. Find your rhythm.",
        ),
        hero,
        facts,
      );
      const setup = el("div", "race-setup"),
        list = el("div", "race-track-list");
      for (const t of R.tracks) {
        const b = button("", "race-track", () => {
          selected.trackId = t.id;
          syncChoices();
          if (onlineActive()) room.configure(selected);
        });
        b.dataset.track = t.id;
        const preview = el("canvas");
        preview.width = 190;
        preview.height = 114;
        drawMap(preview.getContext("2d"), R.course(t.id), 190, 114);
        const copy = el("span");
        copy.append(el("small", "", t.difficulty), el("strong", "", t.name));
        b.append(preview, copy);
        list.append(b);
        trackButtons.push(b);
      }
      description = el("p", "race-track-description");
      const options = el("div", "race-options"),
        segments = el("div", "race-segments");
      segments.setAttribute("role", "group");
      segments.setAttribute("aria-label", "CPU pace");
      for (const [id, label] of [
        ["easy", "Chill"],
        ["normal", "Sport"],
        ["hard", "Expert"],
      ]) {
        const b = button(label, "race-segment", () => {
          selected.difficulty = id;
          syncChoices();
          if (onlineActive()) room.configure(selected);
        });
        b.dataset.difficulty = id;
        segments.append(b);
        difficultyButtons.push(b);
      }
      options.append(el("span", "race-label", "CPU PACE"), segments);
      const launch = button(
        "Launch race",
        "race-primary race-launch",
        start,
      );
      const help = el("details", "race-help");
      help.append(
        el("summary", "", "Controls & tips"),
        el(
          "p",
          "",
          "Auto-drive is on. Steer with A/D or ←/→. Hold S/↓ while turning to drift. Hold a full turn for at least 0.4 seconds, then release Brake for an exit boost. Brake alone slows down. Space/Shift boosts; R rescues you to the last checkpoint with a 1.5-second stop. Escape pauses. Touch: steering on the left; hold Brake + a turn to drift, then release Brake. Boost is on the right. Starlight ramps launch automatically; stars refill boost. Choose a Shield or Pulse item by steering through its icon, then press F/J, the Item button, or controller R1/RB to use it. Move out of a warned pulse lane or activate Shield. Controller: stick/D-pad, B/L2 brake/drift, A/R2 boost, X rescue, Menu pause. Friend-room handling follows the host build; everyone should refresh for drift rewards.",
        ),
      );
      setup.append(
        el("p", "race-label", "CHOOSE YOUR CIRCUIT"),
        list,
        description,
        options,
        launch,
        el(
          "p",
          "race-local-note",
          "3 laps · You + 4 CPU pilots",
        ),
      );
      roomUtilities = el("div", "race-utilities");
      const preferences = el("section", "race-preferences");
      preferences.setAttribute("aria-label", "Race preferences");
      preferences.append(el("h2", "race-label", "YOUR FLIGHT DECK"));
      if (perspective) {
        preferences.append(el("p", "race-setting-label", "Camera"));
        perspective.panel(preferences);
      }
      preferences.append(el("p", "race-setting-label", "Audio"));
      buildAudioControls(preferences);
      preferences.append(help);
      roomUtilities.append(preferences);
      grid.append(intro, setup, roomUtilities);
      lobby.append(header, grid);
      pausePanel = el("div", "race-dialog race-compact race-pause-panel");
      pausePanel.setAttribute("role", "dialog");
      pausePanel.setAttribute("aria-label", "Race paused");
      pausePanel.append(
        el("span", "race-pill", "PARKED IN ORBIT"),
        el("h2", "", "Take a pit stop."),
        el("p", "", "Your race is paused. The other pilots will wait."),
        recoveryButton("Resume race", "race-primary", resume),
        button("Restart race", "", start),
        button("Choose a circuit", "race-text", showLobby),
        recoveryButton("All games", "race-text", close),
      );
      const pauseCopy = el("div", "race-menu-copy");
      for (const n of Array.from(pausePanel.children).slice(0, 3)) pauseCopy.append(n);
      pausePanel.prepend(pauseCopy);
      const pauseActions = el("div", "race-menu-actions");
      for (const n of pausePanel.querySelectorAll("button")) pauseActions.append(n);
      pausePanel.append(pauseActions);
      const pausePreferences = el("div", "race-menu-preferences");
      perspective?.panel(pausePreferences);
      pausePanel.append(pausePreferences);

      resultPanel = el("div", "race-dialog race-compact race-result-panel");
      resultPanel.setAttribute("role", "dialog");
      resultPanel.setAttribute("aria-label", "Race results");
      resultTitle = el("h2");
      resultRows = el("div", "race-results");
      resultPanel.append(
        el("span", "race-pill", "CIRCUIT COMPLETE"),
        resultTitle,
        resultRows,
        button("Race again", "race-primary", () => {
          if (onlineActive() && !room.isHost) room.vote("again");
          else start();
        }),
        button("Next circuit  ↗", "", () => {
          selected.trackId =
            R.tracks[
              (R.tracks.findIndex((t) => t.id === selected.trackId) + 1) %
                R.tracks.length
            ].id;
          syncChoices();
          start();
        }),
        button("Choose a circuit", "race-text", showLobby),
        recoveryButton("All games", "race-text", close),
      );
      const resultActions = el("div", "race-menu-actions");
      for (const n of resultPanel.querySelectorAll("button")) resultActions.append(n);
      resultPanel.append(resultActions);
      againNote = el("p", "race-vote-note");
      againNote.id = "raceAgainNote";
      againCancel = button("Cancel auto-start", "race-text", () => room.cancelAuto());
      againCancel.id = "raceAgainCancel";
      againCancel.hidden = true;
      resultPanel.append(againNote, againCancel);
      pausePanel.querySelectorAll("button")[0].id = "raceResume";
      pausePanel.querySelectorAll("button")[1].id = "raceRestart";
      pausePanel.querySelectorAll("button")[2].id = "raceLobby";
      pausePanel.querySelectorAll("button")[3].id = "raceExit";
      resultPanel.querySelectorAll("button")[3].id = "raceResultExit";
      resultPanel.querySelectorAll("button")[0].id = "raceRematch";
      resultPanel.querySelectorAll("button")[1].id = "raceNext";
      buildRoomControls();

      buildAudioControls(pausePreferences);
      modal.append(lobby, pausePanel, resultPanel);
      rootEl.append(modal);
      live = el("div", "race-sr");
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      rootEl.append(live);
      for (const type of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "click",
        "dblclick",
        "touchstart",
        "touchmove",
        "touchend",
        "touchcancel",
        "wheel",
      ])
        rootEl.addEventListener(type, (e) => e.stopPropagation(), {
          passive: type.startsWith("touch") || type === "wheel",
        });
      rootEl.addEventListener("contextmenu", (e) => e.preventDefault());
      document.body.append(rootEl);
      built = true;
      syncChoices();
    }
    let rescueRequest = false;
    function start() {
      if (sharedSession) return;
      if (!active) return;
      raceAudio()?.unlock();
      if (onlineActive()) {
        if (room.isHost) {
          localRoomMenu = false;
          const next = { ...selected };
          if (room.current?.status !== "lobby") room.lobby();
          room.configure(next);
          room.start();
        }
        return;
      }
      resetInput();
      rescueRequest = false;
      preferences();
      state = R.create(localSession ? { ...localSession.config, ...selected, expedition: true, laps: 1, seed: localSession.seed } : selected);
      cosmeticRound++;
      if (root.SpaceManCosmetics && typeof opts.appearance === "function") { const human = state.actors.find(a => a.controller === "human"); if (human) human.appearance = root.SpaceManCosmetics.normalizeAppearance(opts.appearance()); }
      previousPose = null;
      perspective?.reset();
      flatPresentation?.reset();
      flatCamera?.reset();
      view = "play";
      paused = false;
      last = 0;
      acc = 0;
      const a = state.actors[0];
      camera = {
        x: a.x,
        y: a.y,
        rotation: height > width && !calm() ? -a.heading - Math.PI / 2 : 0,
      };
      setPanel(null);
      announce(localSession ? "Expedition sprint. One lap. Auto-drive is on." : "Three laps. Auto-drive is on. Race starts in three.");
      audio?.update(state, followActor());
      ensureFrame();
    }
    function showLobby() {
      if (!active) return;
      if (localSession || sharedSession) { close(); return; }
      if (onlineActive()) {
        if (!room.isHost) {
          leaveRaceRoom();
          return;
        }
        if (room.current?.status !== "lobby") room.lobby();
      }
      resetInput();
      state = null;
      view = "lobby";
      paused = false;
      last = 0;
      acc = 0;
      syncChoices();
      setPanel(lobby);
      announce("Choose your circuit");
    }
    function pause() {
      if (!isRunning() || state.phase === "finished") return;
      paused = true;
      if (onlineActive()) {
        localRoomMenu = true;
        room.pause(true);
        setText(
          pausePanel.querySelector("p"),
          room.isHost
            ? "The whole race is paused. Resume when you’re ready."
            : roomPaused
              ? "The host paused the race. Everyone is safely parked."
              : "The race keeps going. Your kart coasts while this menu is open.",
        );
      }
      resetInput();
      last = 0;
      acc = 0;
      setPanel(pausePanel);
      announce("Race paused");
      syncRoomChoices();
    }
    function resume() {
      if (!active || !paused || document.hidden) return;
      if (
        onlineActive() &&
        ((roomPaused && !room.isHost) || roomStatus?.connection)
      )
        return;
      if (onlineActive()) {
        localRoomMenu = false;
        room.pause(false);
      }
      raceAudio()?.unlock();
      resetInput();
      rescueRequest = false;
      paused = false;
      last = 0;
      acc = 0;
      setPanel(null);
      previousPose = root.SpaceManRacePresentation?.capture(state);
      announce("Race resumed");
      ensureFrame();
    }
    function results() {
      if (sharedSession) { resetInput(); return; }
      resetInput();
      view = "results";
      resultRows.replaceChildren();
      const me = state.results.find((r) => r.id === ownActor()?.id);
      if (localSession) {
        if (!localSession.reported) {
          localSession.reported = true;
          localSession.onResult({ position: me?.position || 5, finished: !!me?.finished, time: me?.time ?? null });
        }
        return;
      }
      resultTitle.textContent = !me
        ? "The stars have spoken."
        : me.position === 1
          ? "You took the stars!"
          : me.finished
            ? "A fine orbit."
            : "Time for a new orbit.";
      for (const r of state.results) {
        const row = el("div", "race-result-row");
        row.dataset.you = String(r.id === ownActor()?.id);
        row.append(
          el("span", "", String(r.position)),
          el("strong", "", r.name + (r.id === ownActor()?.id ? " · YOU" : "")),
          el("span", "", r.time === null ? "Unfinished" : fmt(r.time)),
        );
        resultRows.append(row);
      }
      if (me && typeof opts.onReward === "function") {
        const receipt = onlineActive() ? root.SpaceManCosmetics.roundReceipt("race", opts.net.info().roomId, networkEpoch) : cosmeticSession + ":" + cosmeticRound;
        const found = receipt ? opts.onReward({ type: "race", id: receipt }) || [] : [];
        if (found.length) resultRows.append(el("p", "race-cosmetic-reward", "Found: " + found.map(id => root.SpaceManCosmetics.item(id)?.name || "").join(", ")));
      }
      setPanel(resultPanel);
      announce(
        "Race complete. You placed " +
          (me?.position || "watching") +
          " of " +
          state.actors.length,
      );
      audio?.update(state, followActor());
      syncRoomChoices();
    }
    function resize() {
      if (!active) return;
      const vv = root.visualViewport,
        lw = document.documentElement.clientWidth || root.innerWidth,
        lh = document.documentElement.clientHeight || root.innerHeight;
      const box = {
        left: Math.max(0, vv?.offsetLeft || 0),
        top: Math.max(0, vv?.offsetTop || 0),
        width: Math.max(1, vv?.width || lw),
        height: Math.max(1, vv?.height || lh),
      };
      if (
        viewport &&
        Object.keys(box).some((k) => Math.abs(box[k] - viewport[k]) > 1)
      )
        resetTouch();
      viewport = box;
      for (const k of Object.keys(box)) rootEl.style[k] = box[k] + "px";
      for (const [k, v] of Object.entries({
        left: box.left,
        top: box.top,
        right: Math.max(0, lw - box.left - box.width),
        bottom: Math.max(0, lh - box.top - box.height),
      }))
        rootEl.style.setProperty("--race-vv-" + k, v + "px");
      width = box.width;
      height = box.height;
      dpr = prefs.batterySaver ? 1 : Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      perspective?.resize(width, height, dpr);
      paint();
    }
    function road(g, c) {
      const palette=root.SpaceManArt.circuitPalette(c), starlight=c.id==='starlight'||c.id==='prism';
      for(const shelf of root.SpaceManArt.circuitCanyonShelves(c,R.at,root.SpaceManRaceTrackMesh.distance)) {
        for(let lane=2;lane>=0;lane--){g.beginPath();shelf.forEach((section,i)=>{const p=section[lane];i?g.lineTo(p[0],p[2]):g.moveTo(p[0],p[2]);});
          for(let i=shelf.length-1;i>=0;i--){const p=shelf[i][lane+1];g.lineTo(p[0],p[2]);}
          g.closePath();g.fillStyle=lane===1?palette.strata:palette.stone;g.fill();}
      }
      if(starlight) for(const {a,b,width} of root.SpaceManArt.circuitConnections(c,R.at,root.SpaceManRaceTrackMesh.distance)) {
        g.strokeStyle=palette.curb;g.lineWidth=width;g.beginPath();g.moveTo(a.x,a.z);g.lineTo(b.x,b.z);g.stroke();
      }
      if(starlight) for(const structure of root.SpaceManArt.circuitStructures(c,R.at,root.SpaceManRaceTrackMesh.distance)) {
        const {x,z,width:w,depth:d,heading}=structure;
        g.save();g.translate(x,z);g.rotate(heading);
        const panel=(w,d,color)=>{const cut=Math.min(w,d)*.16;
          g.beginPath();g.moveTo(-w/2+cut,-d/2);g.lineTo(w/2-cut,-d/2);g.lineTo(w/2,-d/2+cut);
          g.lineTo(w/2,d/2-cut);g.lineTo(w/2-cut,d/2);g.lineTo(-w/2+cut,d/2);
          g.lineTo(-w/2,d/2-cut);g.lineTo(-w/2,-d/2+cut);g.closePath();g.fillStyle=color;g.fill();};
        if(structure.kind==='mesa') {
          g.restore();
          for(const [i,ring] of root.SpaceManArt.circuitMesaRings(structure).entries()) {
            g.beginPath();ring.forEach(([x,y,z],j)=>j?g.lineTo(x,z):g.moveTo(x,z));g.closePath();
            g.fillStyle=i===0||i===3?palette.stone:palette.strata;g.fill();
          }
          g.fillStyle=palette.crystal;g.beginPath();g.moveTo(x,z-12);g.lineTo(x+10,z+2);g.lineTo(x,z+12);g.lineTo(x-10,z+2);g.closePath();g.fill();continue;
        }
        panel(w+6,d+6,palette.curb);panel(w,d,palette.housing);panel(w*.62,d*.52,palette.ink);
        g.fillStyle=palette.edge;g.fillRect(-w*.3,d*.36,w*.6,2);g.restore();
      }
      const path = () => {
        g.beginPath();
        c.segments.forEach((s, i) =>
          i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y),
        );
        g.closePath();
      };
      g.lineJoin = "round";
      g.lineCap = "round";
      path();
      // Match the 3D apron: brief excursions have visible ground, not a void
      // beyond the painted asphalt edge. The outer line marks the safety edge.
      g.strokeStyle = starlight ? palette.outerEdge : c.edge + "55";
      g.lineWidth = c.width + 190;
      g.stroke();
      path();
      g.strokeStyle = palette.apron;
      g.lineWidth = c.width + 176;
      g.stroke();
      path();
      g.strokeStyle = "#0005";
      g.lineWidth = c.width + 32;
      g.stroke();
      path();
      g.strokeStyle = starlight ? palette.curb : c.edge;
      g.lineWidth = c.width + (starlight ? 23 : 13);
      g.stroke();
      path();
      g.strokeStyle = starlight ? palette.edge : "#111e32";
      g.lineWidth = c.width + 6;
      g.stroke();
      path();
      g.strokeStyle = palette.road;
      g.lineWidth = c.width;
      g.stroke();
      if (!starlight) { path();
      g.strokeStyle = "#c9eeff21";
      g.lineWidth = 2;
      g.setLineDash([19, 26]);
      g.stroke();
      g.setLineDash([]); }
      for (let d = starlight ? 45 : 0; d < c.length; d += starlight ? 180 : 75) {
        const p = R.at(c, d);
        if(starlight) {
          g.save();g.translate(p.x,p.y);g.rotate(Math.atan2(p.ty,p.tx));
          g.fillStyle=palette.joint;g.fillRect(-.5,-c.width*.4,1,c.width*.8);g.restore();
        }
        g.fillStyle = palette.edge;
        for (const side of [-1, 1]) {
          g.save();
          g.translate(
            p.x - p.ty * (starlight ? c.width/2-5 : c.width*.49) * side,
            p.y + p.tx * (starlight ? c.width/2-5 : c.width*.49) * side,
          );
          g.rotate(Math.atan2(p.ty, p.tx));
          g.fillRect(starlight?-11:-14,starlight?-1.25:-3,starlight?22:28,starlight?2.5:6);
          g.restore();
        }
      }
      for (const fraction of c.pads) {
        const p = R.at(c, fraction * c.length);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(Math.atan2(p.ty, p.tx));
        g.fillStyle = palette.accent + "22";
        round(g, -30, -c.width * 0.34, 60, c.width * 0.68, 7);
        g.fill();
        g.strokeStyle = palette.accent;
        g.lineWidth = 5;
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(i * 16 - 8, -c.width * 0.23);
          g.lineTo(i * 16 + 7, 0);
          g.lineTo(i * 16 - 8, c.width * 0.23);
          g.stroke();
        }
        g.restore();
      }
      if(c.architecture?.gallery) {
        const gallery=c.architecture.gallery,begin=gallery.start*c.length,end=gallery.end*c.length,
          count=Math.ceil((end-begin)/105);
        // Roof is cut away in Canvas/Top-down. Paired piers and edge runners
        // keep the same gallery footprint readable without hiding the racers.
        for(const side of [-1,1]) {
          g.beginPath();for(let i=0;i<=count;i++) {const p=R.at(c,begin+(end-begin)*i/count),
            d=side*(c.width/2+25),x=p.x-p.ty*d,y=p.y+p.tx*d;
            i?g.lineTo(x,y):g.moveTo(x,y);}
          g.strokeStyle=palette.edge;g.lineWidth=3;g.stroke();
          for(let i=0;i<=count;i++) {const p=R.at(c,begin+(end-begin)*i/count),d=side*gallery.span/2;
            g.save();g.translate(p.x-p.ty*d,p.y+p.tx*d);g.rotate(Math.atan2(p.ty,p.tx));
            g.fillStyle=palette.housing;g.fillRect(-9,-9,18,18);g.fillStyle=palette.ink;g.fillRect(-4,-4,8,8);g.restore();}
        }
      }
      const finish = R.at(c, 0);
      g.save();
      g.translate(finish.x, finish.y);
      g.rotate(Math.atan2(finish.ty, finish.tx));
      for (let i = 0; i < 10; i++)
        for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? "#e5f8f8" : "#132b44";
          g.fillRect(
            (j - 0.5) * 13,
            -c.width / 2 + (i * c.width) / 10,
            13,
            c.width / 10,
          );
        }
      g.restore();
    }
    function updateFeatureNotice() {
      if (!state) return;
      const actor = ownActor();
      if (state.tick < noticeTick) { noticeSerial = 0; noticeUntil = 0; noticeText = ""; }
      const messages = { coin: "+6 BOOST", shield: "SHIELD ON", pulse: "PULSE CHARGING", block: "BLOCKED", hit: "PULSE HIT · KEEP STEERING", "land-pulse": "LAND TO PULSE" };
      for (const event of state.events || []) {
        const serial = event.serial || 0;
        const fresh = serial ? serial > noticeSerial : state.tick !== noticeTick;
        noticeSerial = Math.max(noticeSerial, serial);
        if (!fresh || event.id !== actor?.id) continue;
        const message = event.type === "item" && actor.item ? actor.item.toUpperCase() + " READY" : messages[event.type];
        if (message) { noticeText = message; noticeUntil = state.tick + 60; }
      }
      noticeTick = state.tick;
    }
    function actorElevation(actor) {
      if (!state) return 0;
      const c = R.course(state.trackId);
      return clamp(root.SpaceManRaceScene?.actorHeight?.(actor, c, R.features(c), R.nearest) ?? (actor.z || 0), 0, 40);
    }
    function drawTrackFeatures(ctx, c, actor, catalog) {
      const point = (object) => {
        const p = R.at(c, object.s);
        return { x: p.x - p.ty * object.d, y: p.y + p.tx * object.d, heading: Math.atan2(p.ty, p.tx) };
      };
      function symbol(kind, x, y, size = 1) {
        ctx.save(); ctx.translate(x,y); ctx.rotate(-camera.rotation); ctx.scale(size,size);
        ctx.lineWidth = 2; ctx.strokeStyle = "#081a2b";
        const shape=root.SpaceManArt.circuitGlyphs[kind];
        ctx.fillStyle=kind==='coin'?'#ffda72':kind==='shield'?'#8beaf2':'#ffc08e';
        ctx.beginPath();shape.forEach(([side,up],i)=>i?ctx.lineTo(side,-up):ctx.moveTo(side,-up));ctx.closePath();
        ctx.fill();ctx.stroke();
        if(kind==='coin') {ctx.strokeStyle='#fff0b6';ctx.lineWidth=.8;ctx.stroke();}
        if(kind==='shield') {ctx.strokeStyle='#d9faff';ctx.beginPath();ctx.moveTo(-5,-5);ctx.lineTo(0,7);ctx.lineTo(5,-5);ctx.stroke();}
        ctx.restore();
      }
      for(const ramp of catalog.ramps) {
        const p = point(ramp);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.heading);
        const palette=root.SpaceManArt.circuitPalette(c);
        ctx.fillStyle=palette.ink;ctx.fillRect(-60,-ramp.width/2,84,ramp.width);
        ctx.fillStyle=palette.ramp;ctx.fillRect(-60,-ramp.width/2+3,84,ramp.width-6);
        ctx.strokeStyle=palette.housing;ctx.lineWidth=2.5;
        for(const side of[-1,1]) {ctx.beginPath();ctx.moveTo(-60,side*(ramp.width/2-2));ctx.lineTo(24,side*(ramp.width/2-2));ctx.stroke();}
        ctx.beginPath();ctx.moveTo(0,-ramp.width/2+3);ctx.lineTo(0,ramp.width/2-3);ctx.stroke();
        ctx.strokeStyle='#8beaf2';
        for(const forward of[-40,-19]){ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(forward-7,-54);ctx.lineTo(forward+7,0);ctx.lineTo(forward-7,54);ctx.stroke();}
        ctx.restore();
      }
      for(const coin of catalog.coins) {
        if ((actor.coinMask || 0) & (1<<coin.index)) continue;
        const p=point(coin);ctx.fillStyle="#08121a55";ctx.beginPath();ctx.ellipse(p.x,p.y,8,5,p.heading,0,TAU);ctx.fill();
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(-camera.rotation);
        if(coin.airborne){ctx.strokeStyle="#ffe5a84d";ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,8,0,TAU);ctx.stroke();ctx.translate(0,-14);}
        ctx.rotate(camera.rotation);symbol("coin",0,0);ctx.restore();
      }
      for(const row of catalog.rows) {
        if ((actor.rowMask || 0) & (1<<row.index)) continue;
        for(const choice of row.choices) {
          const p=point(choice);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.heading);
          ctx.fillStyle=choice.item==="shield"?"#18455e":"#644630";ctx.strokeStyle=choice.item==="shield"?"#8de7ff":"#ffc18a";ctx.lineWidth=2;
          round(ctx,-22,-22,44,44,9);ctx.fill();ctx.stroke();ctx.restore();symbol(choice.item,p.x,p.y);
          const approach=point({...choice,s:choice.s-120});symbol(choice.item,approach.x,approach.y,.55);
        }
      }
      for(const effect of state.effects || []) {
        if(effect.phase === "charge") {
          ctx.save();ctx.strokeStyle="#ffc38b";ctx.lineWidth=2;ctx.lineCap="butt";ctx.lineJoin="round";
          for(const side of[-1,1]){ctx.beginPath();for(let n=0;n<=12;n++){const p=point({s:effect.s+36+n*29.6667,d:effect.d+side*10});if(n)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}ctx.stroke();}
          for(let distance=56;distance<=392;distance+=48){const p=point({s:effect.s+distance,d:effect.d});ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.heading);ctx.beginPath();ctx.moveTo(-6,-9);ctx.lineTo(5,0);ctx.lineTo(-6,9);ctx.stroke();ctx.restore();}
          ctx.restore();
        } else {
          const p=point(effect);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.heading);ctx.fillStyle="#ffe4be";ctx.strokeStyle="#fb9f5b";ctx.lineWidth=4;
          ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-7,-10);ctx.lineTo(-13,-10);ctx.lineTo(8,0);ctx.lineTo(-13,10);ctx.lineTo(-7,10);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
        }
      }
    }
    function kart(ctx, a, scale = 1, hero = false) {
      const appearance = a.appearance || ((hero || a.id === ownActor()?.id) && typeof opts.appearance === 'function' ? opts.appearance() : null);
      const style = root.SpaceManArt.characterStyle(appearance, a.color);
      const rise = hero ? 0 : actorElevation(a), lift = rise * .8, bodyScale = scale * (1 + rise / 200);
      ctx.save();ctx.translate(a.x,a.y);ctx.rotate(a.heading);ctx.scale(scale,scale);
      for(let i=0;i<4;i++) {ctx.fillStyle='rgba(5,14,23,'+(0.035+i*.015)+')';ctx.beginPath();ctx.ellipse(0,3,30-i*4,23-i*3,0,0,TAU);ctx.fill();}ctx.restore();
      ctx.save(); ctx.translate(a.x - Math.sin(camera.rotation)*lift, a.y - Math.cos(camera.rotation)*lift); ctx.rotate(a.heading); ctx.scale(bodyScale, bodyScale);
      const slip = a.speed > 3 ? Math.atan2(Math.sin(a.heading - Math.atan2(a.vy, a.vx)), Math.cos(a.heading - Math.atan2(a.vy, a.vx))) : 0;
      if (!a.offroad && Math.abs(slip) > .18 && !a.recoveryTicks) {
        ctx.strokeStyle = "#89eaff"; ctx.lineWidth = 2.5;
        for (const side of [-20, 20]) {
          ctx.beginPath(); ctx.moveTo(-13, side); ctx.lineTo(-38, side + slip * 35); ctx.stroke();
        }
      }
      root.SpaceManArt.hoverpod(ctx, style, { tick: state?.tick || 20, id: a.id, calm: calm(), boosting: !!(a.boosting || a.padTicks > 0), hero, shadow: false });
      if(a.shieldTicks > 0){ctx.strokeStyle="#98eaff";ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<6;i++){const a=i*TAU/6;if(i)ctx.lineTo(Math.cos(a)*37,Math.sin(a)*30);else ctx.moveTo(Math.cos(a)*37,Math.sin(a)*30);}ctx.closePath();ctx.stroke();}
      ctx.restore();
    }
    function drawHero() {
      if (!hero) return;
      const h = hero.getContext("2d");
      h.clearRect(0, 0, 780, 340);
      const c = R.course(selected.trackId);
      h.strokeStyle = c.edge + "33";
      h.lineWidth = 3;
      h.beginPath();
      h.ellipse(390, 195, 290, 78, -0.14, 0, TAU);
      h.stroke();
      kart(
        h,
        { x: 413, y: 159, heading: -0.25, color: "#73ecff", boosting: true },
        4.4,
        true,
      );
      kart(h, { x: 150, y: 234, heading: -0.18, color: "#ffbb69" }, 1.7, true);
      h.fillStyle = "#c7f47d";
      h.font = "700 16px system-ui";
      h.fillText("01", 508, 204);
    }
    function updateIdentity(actor) {
      const own = actor.id === ownActor()?.id;
      const role = own ? "YOU" : "WATCHING";
      const name = actor.name || "Pilot";
      identity.dataset.actorId = actor.id;
      identity.dataset.role = own ? "you" : "watching";
      setText(identityRole, role);
      setText(identityName, name);
      identity.setAttribute("aria-label", role + " · " + name);
      const appearance = actor.appearance || (own && typeof opts.appearance === "function" ? opts.appearance() : null);
      const signature = JSON.stringify([actor.id, appearance, actor.color]);
      if (signature === identitySignature) return;
      identitySignature = signature;
      const ctx = identityPortrait.getContext("2d");
      ctx.clearRect(0, 0, 72, 72);
      ctx.save(); ctx.translate(36, 42); ctx.scale(2, 2);
      root.SpaceManArt.characterHelmet(ctx, 0, 0,
        root.SpaceManArt.characterStyle(appearance, actor.color), { calm: true });
      ctx.restore();
    }
    function drawMap(ctx, c, w, h, actors) {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      const scale = Math.min((w - 25) / 1800, (h - 20) / 1400);
      ctx.translate((w - 1800 * scale) / 2, (h - 1400 * scale) / 2);
      ctx.scale(scale, scale);
      ctx.beginPath();
      c.segments.forEach((s, i) =>
        i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y),
      );
      ctx.closePath();
      ctx.lineWidth = 50;
      ctx.strokeStyle = c.edge + "77";
      ctx.lineJoin = "round";
      ctx.stroke();
      if (actors) {
        // Draw the focused pilot last, with a shape/contrast cue independent of suit color.
        const focused = actors.find(actor => actor.id === followActor()?.id);
        for (const a of [...actors.filter(a => a.id !== focused?.id), ...(focused ? [focused] : [])]) {
          const selected = a.id === focused?.id;
          ctx.fillStyle = selected ? "#FFF3CE" : a.color;
          ctx.beginPath();
          ctx.arc(a.x, a.y, selected ? 40 : 26, 0, TAU);
          ctx.fill();
          if (selected) {
            ctx.strokeStyle = "#091727";
            ctx.lineWidth = 16;
            ctx.stroke();
          }
        }
      } else {
        const p = c.segments[0];
        ctx.fillStyle = c.accent;
        ctx.fillRect(p.x - 30, p.y - 30, 60, 60);
      }
      ctx.restore();
    }
    // Resize/viewport paints reframe immediately without spending the last
    // animation frame's elapsed time a second time on camera easing.
    // Slipstream cue: derived locally from the synced poses (no wire field),
    // smoothed for the wind streaks, and one soft audio tick when it engages.
    let draftLevel = 0, draftSounded = false;
    function stepDraft(a, dt) {
      const live = !!(a && state && state.phase === "racing" && !paused && !roomPaused && R.draftTarget);
      const target = live && R.draftTarget(state, a) ? 1 : 0;
      draftLevel += (target - draftLevel) * (1 - Math.exp(-Math.min(0.1, dt || 1 / 60) * (target ? 2.2 : 6)));
      if (draftLevel < 0.01) draftLevel = 0;
      if (draftLevel > 0.55 && !draftSounded) {
        draftSounded = true;
        if (a.id === ownActor()?.id) audio?.draft?.();
      } else if (draftLevel < 0.15) draftSounded = false;
      return draftLevel;
    }
    function paint(frameDt = 0) {
      if (!active || !g) return;
      const c = R.course(state?.trackId || selected.trackId);
      const a = state ? followActor() : null;
      const draftNow = stepDraft(a, frameDt);
      const shown = state && (flatPresentation?.sample(state, {
        actorId: a.id, previous: previousPose, epoch: networkEpoch,
        network: onlineActive(), now: root.performance.now(),
        paused: onlineActive() ? roomPaused : paused,
        alpha: acc * 60,
      }) || state);
      const shownActor = shown?.actors.find(actor => actor.id === a.id) || a;
      const rendered3d =
        a &&
        perspective?.render(R.snapshot(state), {
          actorId: a.id,
          localActorId: ownActor()?.id || null,
          previous: onlineActive() ? null : previousPose,
          epoch: networkEpoch,
          network: onlineActive(),
          paused: onlineActive() ? roomPaused : paused,
          alpha: paused || state.phase === "finished" ? 1 : acc * 60,
          dt: frameDt,
          draft: draftNow,
          reduceMotion: calm(),
        });
      // The hidden fallback canvas does not need a second full-screen sky pass.
      // Its camera stays warm below; redraw it fully only when it is presented.
      if (!rendered3d) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = c.sky;
        g.fillRect(0, 0, width, height);
        for (let i = 0; i < 100; i++) {
          const x =
              (((i * 137.1 - (calm() ? 0 : camera.x * 0.045)) % width) +
                width) %
              width,
            y =
              (((i * i * 39.1 - (calm() ? 0 : camera.y * 0.045)) % height) +
                height) %
              height;
          g.fillStyle = i % 4 ? "#c9e4ff60" : c.edge + "80";
          g.fillRect(x, y, i % 7 ? 1 : 2, i % 7 ? 1 : 2);
        }
        const px = width * 0.78,
          py = height * 0.28,
          r = Math.min(width, height) * 0.25,
          grad = g.createRadialGradient(
            px - r * 0.3,
            py - r * 0.4,
            r * 0.1,
            px,
            py,
            r,
          );
        grad.addColorStop(0, c.planet);
        grad.addColorStop(1, c.sky);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(px, py, r, 0, TAU);
        g.fill();
        g.strokeStyle = c.edge + "20";
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(px, py, r * 1.55, r * 0.25, -0.4, 0, TAU);
        g.stroke();
      }
      if (!state) {
        perspective?.close();
        speed.parentNode.hidden = true;
        banner.hidden = true;
        warning.hidden = true;
        itemSlot.hidden = true;
        return;
      }
      speed.parentNode.hidden = false;
      const catalog = R.features(c);
      rootEl.dataset.features = String(catalog.rows.length > 0);
      itemSlot.hidden = view !== "play" || !catalog.rows.length;
      const heldItem = a.item || null;
      itemSlot.dataset.item = heldItem || "empty";
      itemSlot.dataset.active = String(a.shieldTicks > 0);
      itemSlot.setAttribute("aria-disabled", String(!isRunning() || !canControl() || !ownActor()?.item));
      setDisabled(itemSlot, !isRunning() || !canControl());
      setText(itemIcon, heldItem === "shield" ? "⬡" : heldItem === "pulse" ? "➤" : a.shieldTicks ? "⬡" : "◇");
      setText(itemName, heldItem ? heldItem.toUpperCase() : a.shieldTicks ? "GUARDED" : "ITEM");
      const mappedItemKey = prefs.keys?.fire && prefs.keys.fire !== "f" ? prefs.keys.fire.toUpperCase() : "F / J";
      setText(itemKey, mappedItemKey);
      itemSlot.setAttribute("aria-label", heldItem ? "Use " + heldItem + " item" : a.shieldTicks ? "Shield active" : "Item slot empty");
      updateFeatureNotice();
      const zoom = clamp(Math.min(width / 820, height / 600), 0.65, 1.2);
      // Keep the fallback camera warm while WebGL is active, so switching view
      // or losing the graphics context never flies back from an old position.
      camera = flatCamera?.update(shownActor, {
        trackId: state.trackId, epoch: networkEpoch, dt: frameDt,
        portrait: height > width, reduceMotion: calm(),
        paused: onlineActive() ? roomPaused : paused,
      }) || camera;
      if (!rendered3d) {
        g.save();
        g.translate(width / 2, height * 0.48);
        g.scale(zoom, zoom);
        g.rotate(camera.rotation);
        g.translate(-camera.x, -camera.y);
        road(g, c);
        drawTrackFeatures(g, c, shownActor, catalog);
        if (a.finishTick === null) {
          const gate = c.gates[a.nextGate];
          g.save();
          g.translate(gate.x, gate.y);
          g.rotate(Math.atan2(gate.ty, gate.tx));
          g.strokeStyle = c.accent + "48";
          g.lineWidth = 3;
          g.setLineDash([5, 9]);
          g.beginPath();
          g.moveTo(0, -c.width * 0.43);
          g.lineTo(0, c.width * 0.43);
          g.stroke();
          g.setLineDash([]);
          g.restore();
        }
        for (const actor of shown.actors) {
          if (!calm() && actor.recoveryTicks && state.tick % 12 < 5) continue;
          kart(g, actor);
        }
        g.restore();
        // Reserve the followed pilot's label first and paint it last. Array/seat
        // order must never let a CPU label hide the one that identifies you.
        const topClip = Math.max(
          83,
          hud.getBoundingClientRect().bottom - (viewport?.top || 0) + 8,
        );
        const controlsTop =
          rootEl.dataset.touch === "true" && !touch.hidden
            ? touch.querySelector(".race-touch-group").getBoundingClientRect()
                .top - (viewport?.top || 0)
            : height;
        const bottomClip = Math.min(height - 65, controlsTop - 12);
        const cos = Math.cos(camera.rotation), sin = Math.sin(camera.rotation);
        const project = actor => {
          const dx = actor.x - camera.x, dy = actor.y - camera.y;
          return { x: width / 2 + (dx * cos - dy * sin) * zoom,
            y: height * 0.48 + (dx * sin + dy * cos - actorElevation(actor)*.8) * zoom };
        };
        const focus = project(shownActor), own = a.id === ownActor()?.id;
        const bodies = shown.actors.map(actor => {
          const p = project(actor), r = 36 * zoom * (1+actorElevation(actor)/200);
          return {id:actor.id,x:p.x-r,y:p.y-r,w:r*2,h:r*2};
        });
        const cue = root.SpaceManArt.identityMarkerLayout(a.id, bodies,
          {left:6,right:width-6,top:topClip,bottom:bottomClip});
        const labels = cue ? [{left:cue.x,right:cue.x+cue.w,top:cue.y,bottom:cue.y+cue.h}] : [];
        if(cue?.leader){const l=cue.leader;labels.push({left:l.x,right:l.x+l.w,top:l.y,bottom:l.y+l.h});}
        // Browser QA observes the actual projection, not a parallel mock layout.
        rootEl.dataset.identity = cue ? (own ? 'YOU:' : 'WATCHING:') + a.id : '';
        rootEl.dataset.identityCue = JSON.stringify({cue,bodies});
        g.font = "700 10px system-ui";
        g.textAlign = "center";
        for (const actor of shown.actors) {
          if (actor.id === a.id) continue;
          const p = project(actor), x = p.x, y = p.y - 30;
          const name = actor.name, w = g.measureText(name).width + 10;
          const box = { left: x - w / 2, right: x + w / 2, top: y - 12, bottom: y + 5 };
          if (box.left < 5 || box.right > width - 5 || box.top < topClip || box.bottom > bottomClip ||
            bodies.some(b => box.left < b.x+b.w+2 && box.right > b.x-2 && box.top < b.y+b.h+2 && box.bottom > b.y-2) ||
            labels.some(b => box.left < b.right + 6 && box.right > b.left - 6 && box.top < b.bottom + 5 && box.bottom > b.top - 5)) continue;
          labels.push(box);
          g.fillStyle = "#071626dd";
          round(g, box.left, box.top, w, 18, 6); g.fill();
          g.fillStyle = "#cfdfeb";
          g.fillText(name, x, y + 1);
        }
        if (cue) root.SpaceManArt.identityCue(g, cue.x+cue.w/2, cue.y+cue.h/2, own ? 'you' : 'watching', cue.targetX, cue.targetY, cue.link);
      }
      updateIdentity(a);
      drawMap(mg, c, 340, 240, shown.actors);
      position.replaceChildren(
        document.createTextNode(
          String(
            state.results?.find((r) => r.id === a.id)?.position ??
              R.standings(state).findIndex((x) => x.id === a.id) + 1,
          ),
        ),
        el("small", "", " / " + state.actors.length),
      );
      lap.textContent = Math.min(a.lap, state.laps) + " / " + state.laps;
      time.textContent = fmt(state.raceTick / 60);
      speed.textContent = String(Math.round(a.speed * 23));
      fuel.style.transform = "scaleX(" + a.fuel / 100 + ")";
      const slip = a.speed > 3 ? Math.abs(Math.atan2(Math.sin(a.heading - Math.atan2(a.vy, a.vx)), Math.cos(a.heading - Math.atan2(a.vy, a.vx)))) : 0;
      // Pair local intent with authoritative slip: a collision alone is not a drift.
      // All clients can read these physical cues from existing v1 snapshots.
      // Do not pretend a remote client knows the host-only drift-charge timer.
      const sliding = a.id === ownActor()?.id && lastControl.brake &&
        Math.abs(lastControl.steer) >= .35 && !a.offroad && !a.recoveryTicks && slip > 0.18;
      const notice = state.tick < noticeUntil ? noticeText : "";
      driveFeedback.hidden = state.phase !== "racing" || a.recoveryTicks > 0 ||
        (!a.boosting && !a.padTicks && !sliding && !notice);
      driveFeedback.dataset.kind = a.boosting || a.padTicks ? "boost" : "drift";
      setText(driveFeedback, notice || (a.boosting || a.padTicks ? "BOOST!" : "DRIFT"));
      banner.hidden = state.phase !== "countdown";
      if (!banner.hidden) {
        banner.replaceChildren(
          document.createTextNode(String(Math.ceil(state.countdown / 60))),
          el("small", "", catalog.ramps.length ? "RAMPS LAUNCH · STARS FILL BOOST" : "BRAKE + TURN = DRIFT"),
        );
      }
      const threats = canControl() && ownActor() && isRunning() ? R.warningFor(state, ownActor()) : [];
      const guide = threats.length ? pulseGuide(a, c, threats, R.nearest) : null;
      let sourceArrow = "↑";
      if (threats.length) {
        const source = R.at(c, threats[0].s), dx = source.x-a.x, dy = source.y-a.y;
        const angle = rendered3d ? -a.heading-Math.PI/2 : camera.rotation;
        const sx = dx*Math.cos(angle)-dy*Math.sin(angle), sy = dx*Math.sin(angle)+dy*Math.cos(angle);
        sourceArrow = sourceBearingArrow(sx, sy);
      }
      const pulseText = guide ? guide.label : "";
      warning.hidden =
        !threats.length && !a.offroad &&
        !a.recoveryTicks &&
        !(
          onlineActive() &&
          (roomStatus?.connection ||
            roomStatus?.stale ||
            a.finishTick !== null ||
            a.forfeited)
        );
      const warningText =
        onlineActive() && (roomStatus?.connection || roomStatus?.stale)
          ? "WAITING FOR CONNECTION · CONTROLS RELEASED"
          : a.forfeited
            ? "DISCONNECTED · DID NOT FINISH"
            : onlineActive() && a.finishTick !== null
              ? "FINISHED · WAITING FOR OTHER RACERS"
              : a.recoveryTicks
                ? "RESCUING · BACK TO LAST CHECKPOINT"
                : a.offroad
                  ? "TRACK EDGE · STEER BACK INTO THE LANE"
                  : threats.length
                    ? pulseText
                    : "";
      setText(warningCopy, warningText);
      const pulseVisible = !!threats.length && warningText === pulseText;
      threatMap.hidden = !pulseVisible; warningSource.hidden = !pulseVisible;
      if (pulseVisible) {
        const bearing = ["→","↘","↓","↙","←","↖","↑","↗"].indexOf(sourceArrow);
        const words = ["right","rear right","behind","rear left","left","front left","ahead","front right"];
        warningSource.setAttribute("aria-label", "Pulse source: " + words[bearing]);
        sourceG.clearRect(0,0,28,28); sourceG.save(); sourceG.translate(14,14); sourceG.rotate(bearing*Math.PI/4);
        sourceG.strokeStyle="#ffe5bd";sourceG.lineWidth=3;sourceG.lineJoin="round";sourceG.lineCap="round";
        sourceG.beginPath();sourceG.moveTo(-8,0);sourceG.lineTo(8,0);sourceG.moveTo(1,-7);sourceG.lineTo(8,0);sourceG.lineTo(1,7);sourceG.stroke();sourceG.restore();
      }
      if (pulseVisible) {
        threatMap.setAttribute("aria-label", guide.description);
        threatG.setTransform(2,0,0,2,0,0); threatG.clearRect(0,0,140,30);
        threatG.fillStyle = "#112a3c"; threatG.fillRect(0,0,140,30);
        threatG.strokeStyle = "#9cb8c266"; threatG.lineWidth = 1; threatG.setLineDash([3,3]);
        for(const x of[47,93]){threatG.beginPath();threatG.moveTo(x,0);threatG.lineTo(x,30);threatG.stroke();}
        threatG.setLineDash([]);
        for(const danger of guide.dangerous){
          const x=(danger-38+90)/180*140,w=76/180*140;
          threatG.fillStyle="#f8a15b88";threatG.fillRect(x,0,w,30);
          threatG.strokeStyle="#ffd29b";threatG.lineWidth=2;
          const mid=(danger+90)/180*140;threatG.beginPath();threatG.moveTo(mid-5,10);threatG.lineTo(mid,4);threatG.lineTo(mid+5,10);threatG.stroke();
        }
        if(guide.safe!==null){const x=(guide.safe+90)/180*140;threatG.strokeStyle="#9eeeb9";threatG.lineWidth=2;threatG.strokeRect(x-7,10,14,16);}
        const x=clamp((guide.d+90)/180*140,5,135);
        threatG.fillStyle="#e8fbff";threatG.strokeStyle="#071524";threatG.lineWidth=2;threatG.beginPath();threatG.arc(x,22,4,0,TAU);threatG.fill();threatG.stroke();
      }
      warning.dataset.kind = pulseVisible ? "pulse" : "status";
      const serials = Array(5).fill(0);
      for (const threat of threats) {
        const slot = Number(threat.ownerId.slice(6));
        if (slot >= 0 && slot < 5) serials[slot] = threat.serial;
      }
      const soundKey = pulseVisible ? serials.join(":") : "";
      if (soundKey && soundKey !== warningSoundKey) audio?.threat?.();
      warningSoundKey = soundKey;
      displayedWarnings = warningReceipt.observe(serials, {
        visible: pulseVisible && guide.actionable && !threatMap.hidden && !warning.hidden && !document.hidden && !rootEl.inert && isRunning(),
        frame: renderFrame, actorId: ownActor()?.id, epoch: networkEpoch,
      });
      if (onlineActive()) room.observeWarnings?.(displayedWarnings);
    }
    function tick(now) {
      frameId = 0;
      if (!active || document.hidden) return;
      renderFrame++;
      pollPad();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      renderDt = dt;
      if (onlineActive() && view === "play") {
        acc += dt;
        let count = 0;
        while (acc >= 1 / 60 && count++ < 6) {
          const command = isRunning() && canControl() ? input() : R.command();
          if (rescueRequest && canControl()) command.recover = true;
          rescueRequest = false;
          lastControl = command;
          room.step(command, now);
          acc -= 1 / 60;
        }
      } else if (isRunning()) {
        acc += dt;
        let count = 0;
        while (acc >= 1 / 60 && count++ < 6) {
          const cmds = {};
          for (const a of state.actors)
            cmds[a.id] =
              a.controller === "cpu" ? R.cpuInput(state, a) : input();
          if (rescueRequest) {
            cmds[state.actors[0].id].recover = true;
            rescueRequest = false;
          }
          lastControl = cmds[state.actors[0].id];
          previousPose = root.SpaceManRacePresentation?.capture(state);
          R.step(state, cmds);
          updateFeatureNotice();
          audio?.update(state, followActor());
          acc -= 1 / 60;
          for (const e of state.events) {
            if (
              e.id === state.actors[0].id &&
              e.type === "lap" &&
              state.phase !== "finished"
            ) {
              announce("Lap " + e.lap + " of " + state.laps);
            }
            if (e.id === state.actors[0].id && e.type === "recover")
              announce("Rescued to your last checkpoint");
          }
          if (state.phase === "finished") {
            results();
            break;
          }
        }
      }
      if (state && !paused) audio?.update(state, followActor());
      paint(renderDt);
      ensureFrame();
    }
    function ensureFrame() {
      if (active && !document.hidden && !frameId)
        frameId = root.requestAnimationFrame(tick);
    }
    function visibility() {
      resetInput();
      last = 0;
      acc = 0;
      if (document.hidden) {
        audio?.pause();
        pause();
        if (frameId) root.cancelAnimationFrame(frameId);
        frameId = 0;
      } else {
        resize();
        ensureFrame();
      }
    }
    function blur(e) {
      if (e.target !== root) return;
      resetInput();
      if (
        document.hidden ||
        !root.matchMedia?.("(pointer: coarse) and (hover: none)").matches
      )
        pause();
    }
    function pagehide() {
      audio?.pause();
      resetInput();
      pause();
      if (frameId) root.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    function open() {
      if (active || destroyed) return;
      build();
      active = true;
      savedFocus = document.activeElement;
      oldOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      inert = Array.from(document.body.children)
        .filter(
          (n) =>
            n !== rootEl && !["SCRIPT", "STYLE", "LINK"].includes(n.tagName),
        )
        .map((n) => ({ node: n, inert: n.inert }));
      inert.forEach((x) => (x.node.inert = true));
      rootEl.hidden = false;
      rootEl.dataset.touch = String(
        !!root.matchMedia?.("(pointer: coarse)").matches,
      );
      preferences();
      listen(rootEl, "pointerdown", unlockAudioGesture, true);
      listen(root, "keydown", unlockAudioGesture, true);
      listen(root, "keydown", keydown, true);
      listen(root, "keyup", keyup, true);
      listen(root, "blur", blur);
      listen(document, "visibilitychange", visibility, true);
      listen(root, "pagehide", pagehide);
      listen(root, "pageshow", () => {
        resize();
        ensureFrame();
      });
      listen(root, "resize", resize);
      if (root.visualViewport) {
        listen(root.visualViewport, "resize", resize);
        listen(root.visualViewport, "scroll", resize);
      }
      for (const type of [
        "pointerdown",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
        "click",
      ])
        listen(root, type, guard, { capture: true, passive: false });
      listen(root, "touchend", touchEnd, { capture: true, passive: true });
      listen(root, "touchcancel", touchEnd, { capture: true, passive: true });
      resize();
      showLobby();
      if (room) roomChanged(room.status());
      ensureFrame();
    }
    function close(options = {}) {
      if (!active) return;
      const shared = sharedSession;
      if (shared && !options.transition && shared.adapter.confirmLeave && !shared.adapter.confirmLeave()) return;
      if (shared) {
        const crewButton = pausePanel.querySelector('#raceJourneyCrew'); if (crewButton) crewButton.hidden = true;
        shared.detach?.(); sharedSession = null;
        room.release(); room = shared.previousRoom; selected = shared.previous;
      }
      if (room && (room.active || room.busy) && !leaveRaceRoom()) return;
      resetInput();
      active = false;
      if (frameId) root.cancelAnimationFrame(frameId);
      frameId = 0;
      last = 0;
      acc = 0;
      for (const [t, type, fn, settings] of listeners.splice(0))
        t.removeEventListener(type, fn, settings);
      rootEl.hidden = true;
      perspective?.close();
      flatPresentation?.reset();
      flatCamera?.reset();
      state = null;
      paused = false;
      view = "lobby";
      viewport = null;
      inert.forEach((x) => {
        if (x.node.isConnected) x.node.inert = x.inert;
      });
      inert = [];
      document.body.style.overflow = oldOverflow;
      if (savedFocus?.isConnected) savedFocus.focus({ preventScroll: true });
      audio?.stop();
      if (localSession) { selected = localSession.previous; localSession = null; }
      rootEl.dataset.session = "false";
      pausePanel.querySelector("#raceLobby").hidden = false;
      pausePanel.querySelector("#raceLobby").textContent = "Choose a circuit";
      pausePanel.querySelector("#raceExit").textContent = "All games";
      pausePanel.querySelector("#raceRestart").hidden = false;
      if (shared && !options.transition) shared.adapter.leave();
      if (!options.transition && !shared) opts.onClose?.();
    }
    function openSharedSession(config, adapter) {
      if (active || destroyed || !adapter || typeof adapter.attach !== "function") return false;
      open();
      sharedSession = { previousRoom: room, previous: { ...selected }, adapter, detach: null };
      room = adapter;
      selected = { trackId: R.course(config.trackId).id, difficulty: "easy" };
      rootEl.dataset.session = "true";
      pausePanel.querySelector("#raceExit").textContent = "Leave expedition";
      let crewButton = pausePanel.querySelector('#raceJourneyCrew');
      if (!crewButton) { crewButton = button('Crew · seats & invite', 'race-text-button', () => sharedSession?.adapter.openCrew?.()); crewButton.id = 'raceJourneyCrew'; pausePanel.append(crewButton); }
      crewButton.hidden = false;
      sharedSession.detach = adapter.attach({ onChange: roomChanged, onSnapshot: networkSnapshot });
      syncRoomChoices(); if (!state) { setPanel(null); touch.hidden = true; } return true;
    }
    function closeSharedSession() { if (sharedSession) close({ transition: true }); }
    function openSession(config, onResult) {
      if (active || destroyed || opts.net?.active || typeof onResult !== "function") return false;
      open();
      localSession = { config: { ...config }, seed: config.seed >>> 0, previous: { ...selected }, onResult, reported: false };
      selected = { trackId: R.course(config.trackId).id, difficulty: "easy" };
      rootEl.dataset.session = "true";
      pausePanel.querySelector("#raceLobby").textContent = "Finish expedition";
      pausePanel.querySelector("#raceExit").textContent = "Finish expedition";
      syncChoices(); start(); return true;
    }
    function destroy() {
      close();
      destroyed = true;
      recoveryClickCleanup?.();
      perspective?.destroy();
      rootEl?.remove();
      audio?.destroy();
    }
    return Object.freeze({
      open,
      openSession,
      openSharedSession,
      closeSharedSession,
      close,
      destroy,
      joinInvite(payload, role) {
        if (!active) open();
        if (!room) return Promise.resolve(false);
        roomDetails.open = true;
        return room.join(payload, role, true);
      },
      roomStatus() {
        const s = room?.status();
        return s ? JSON.parse(JSON.stringify(s)) : null;
      },
      get active() {
        return active;
      },
      get screen() {
        return !active ? "closed" : view === "play" && paused ? "pause" : view;
      },
      snapshot() {
        return state ? R.snapshot(state) : null;
      },
    });
  }
  root.SpaceManRaceUI = Object.freeze({ create, createWarningReceipt, createItemRequest, pulseGuide, sourceBearingArrow });
})(typeof window !== "undefined" ? window : globalThis);
