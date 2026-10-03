/* Space Man · Orbital Arena
   Lazy, same-page presentation. The simulation stays in arena.js. No listeners,
   DOM, animation frames, storage or audio are touched before open(). */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const FORMATS = [
    { id: 'duel', name: 'Duel', tag: 'YOU + 1 CPU', detail: 'A little space. A worthy rival.', icon: '◉ : ◉' },
    { id: 'ffa', name: 'Free-for-all', tag: 'YOU + 3 CPU', detail: 'Four suits. One last astronaut.', icon: '◉ ◉ ◉ ◉' },
    { id: 'teams', name: 'Team up', tag: '2 vs 2 · CPU ALLY', detail: 'You and a wingmate take on two.', icon: '◉◉ : ◉◉' },
  ];
  const PLAYER_COLORS = ['#38E1FF', '#FFB454', '#B99AFF', '#8AECAB'];
  function rounded(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function button(text, cls, fn) { const n = el('button', 'arena-button ' + (cls || ''), text); n.type = 'button'; if (fn) n.addEventListener('click', fn); return n; }
  const STYLES = `\n/* All arena rules are scoped. The runner's cascade stays untouched. */
.arena-root{position:fixed;inset:0 auto auto 0;width:100%;height:100%;height:100dvh;min-width:0;min-height:0;z-index:1000;isolation:isolate;overflow:hidden;background:#060818;color:#CFE3FF;font-family:var(--font,ui-rounded,system-ui,sans-serif);font-size:14px;line-height:1.4;touch-action:none;-webkit-user-select:none;user-select:none;color-scheme:dark}
.arena-root [hidden],.arena-root[hidden]{display:none!important}
.arena-root,.arena-root *,.arena-root *:before,.arena-root *:after{box-sizing:border-box}
/* The root uses visual-viewport coordinates. Translate the runner's shared
   layout-viewport insets once, so browser chrome is never reserved twice. */
.arena-root{--arena-safe-top:max(0px,calc(var(--game-ui-top,env(safe-area-inset-top,0px)) - var(--arena-vv-top,0px)));--arena-safe-right:max(0px,calc(var(--game-ui-right,env(safe-area-inset-right,0px)) - var(--arena-vv-right,0px)));--arena-safe-bottom:max(0px,calc(var(--game-ui-bottom,env(safe-area-inset-bottom,0px)) - var(--arena-vv-bottom,0px)));--arena-safe-left:max(0px,calc(var(--game-ui-left,env(safe-area-inset-left,0px)) - var(--arena-vv-left,0px)))}
.arena-root :where(.arena-dialog,.arena-lobby-top,.arena-lobby-grid,.arena-intro,.arena-setup,.arena-choice-group,.arena-formats,.arena-stage-cards,.arena-format-copy,.arena-difficulty,.arena-segmented){min-width:0;min-height:0}
.arena-root button,.arena-root summary{-webkit-tap-highlight-color:transparent}
.arena-root :focus-visible{outline:3px solid #FFE59A!important;outline-offset:-3px!important}
.arena-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none}
.arena-button{position:relative;min-width:0;max-width:100%;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;margin:0;padding:12px 18px;border:1px solid rgba(159,241,255,.23);border-radius:12px;background:#132239;color:#DBEFFF;font-size:13px;font-weight:700;line-height:1.3;text-align:center;text-decoration:none;letter-spacing:.01em;box-shadow:none;cursor:pointer;transition:background .15s,border-color .15s,transform .15s;appearance:none;-webkit-appearance:none}
.arena-button:hover{background:#1C304C;border-color:rgba(159,241,255,.65)}
.arena-button:active{transform:translateY(1px)}
.arena-button:disabled{opacity:.5;cursor:default}
.arena-primary{background:#FFC66B;border-color:#FFD998;color:#1A1724;min-height:54px;box-shadow:0 4px 0 #8A6137,0 10px 28px rgba(255,180,84,.13)}
.arena-primary:hover{background:#FFD793;border-color:#FFF0C1}
.arena-text-button{background:transparent;border-color:transparent;box-shadow:none;color:#AFCCE7;font:600 12px/1.35 system-ui,sans-serif;min-height:44px;padding:10px 12px}
.arena-text-button:hover{background:rgba(56,225,255,.08);border-color:rgba(56,225,255,.16);color:#ECF8FF}
.arena-eyebrow{font-size:10px;letter-spacing:.17em;font-weight:800;color:#8EAAC5;line-height:1.5}
.arena-pill{display:inline-flex;align-items:center;align-self:flex-start;gap:7px;border:1px solid rgba(56,225,255,.28);border-radius:999px;padding:6px 10px;font:700 9px/1.3 system-ui,sans-serif;letter-spacing:.15em;background:rgba(56,225,255,.06);color:#9FF1FF}
.arena-pill:before{content:'';width:5px;height:5px;border-radius:50%;background:#38E1FF}
.arena-modal{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:calc(var(--arena-safe-top) + 22px) calc(var(--arena-safe-right) + 24px) calc(var(--arena-safe-bottom) + 22px) calc(var(--arena-safe-left) + 24px);background:rgba(4,8,20,.55);overflow:hidden}
.arena-root[data-screen=lobby] .arena-modal{background:linear-gradient(100deg,rgba(4,8,20,.85),rgba(4,8,20,.27))}
.arena-dialog{overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#32516C transparent;overscroll-behavior:contain;touch-action:pan-y}
.arena-lobby{width:min(1130px,100%);max-height:100%;overflow-y:auto;padding:0 8px 6px}
.arena-lobby-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px;min-height:44px}
.arena-lobby-grid{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.1fr);grid-auto-rows:max-content;align-content:start;gap:clamp(28px,5vw,72px);align-items:center}
.arena-intro{min-width:0;padding-bottom:10px}
.arena-title{font-size:clamp(34px,3.75vw,52px);line-height:1.12;letter-spacing:-.045em;font-weight:900;color:#F4F7FF;margin:20px 0 18px;padding:0}
.arena-title span{color:#9FF1FF}
.arena-lede{max-width:360px;font:400 15px/1.65 system-ui,sans-serif;color:#A8C1D8;margin:0}
.arena-lobby-art{display:block;width:100%;max-width:430px;height:auto;margin:-1px -16px -7px;pointer-events:none}
.arena-rules{display:flex;flex-wrap:wrap;gap:8px 16px;max-width:400px;font:500 11px/1.55 system-ui,sans-serif;color:#AAC3D8}
.arena-rules span:first-child{color:#9FF1FF}.arena-rules span:nth-child(2){color:#FFE59A}
.arena-setup{min-width:0;background:linear-gradient(145deg,rgba(19,37,60,.66),rgba(9,18,34,.85));padding:24px;border:1px solid rgba(117,179,216,.19);border-radius:22px;box-shadow:0 20px 60px rgba(0,0,0,.24),inset 0 1px 0 rgba(214,244,255,.04)}
.arena-choice-group+.arena-choice-group{margin-top:25px}
.arena-section-label{font-size:10px;letter-spacing:.14em;font-weight:800;line-height:1.4;color:#A7C5DF;margin:0 0 11px;padding:0}
.arena-formats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.arena-format-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;padding:12px 10px;min-height:100px;border-radius:12px;background:rgba(9,20,37,.76);overflow:hidden}
.arena-format-card[aria-pressed=true]{border-color:#38E1FF;background:rgba(56,225,255,.10);box-shadow:inset 0 0 0 1px rgba(56,225,255,.15)}
.arena-format-copy{display:flex;flex-direction:column;gap:5px}
.arena-format-copy strong{font-size:12px;font-weight:800;letter-spacing:-.02em;white-space:normal;overflow-wrap:anywhere}
.arena-format-copy small{font:600 8px/1.3 system-ui,sans-serif;letter-spacing:.04em;color:#8CAAC5}
.arena-format-icon{font:700 13px/1 system-ui,sans-serif;letter-spacing:.02em;color:#7696B4;white-space:nowrap}
.arena-format-card[aria-pressed=true] .arena-format-icon{color:#9FF1FF}
.arena-selected-dot{position:absolute;right:9px;top:10px;width:5px;height:5px;border-radius:50%;background:#38E1FF;opacity:0}
.arena-format-card[aria-pressed=true] .arena-selected-dot{opacity:1}
.arena-stage-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.arena-stage-card{display:block;text-align:left;min-width:0;padding:0 0 10px;overflow:hidden;background:#0B1829;border-color:rgba(135,173,204,.18);min-height:114px;border-radius:10px}
.arena-stage-card[aria-pressed=true]{border-color:#FFC66B;box-shadow:0 0 0 1px rgba(255,198,107,.18)}
.arena-stage-preview{display:block;min-width:0;max-width:100%;width:100%;height:auto;aspect-ratio:288/150;min-height:55px;object-fit:cover;border-bottom:1px solid rgba(159,241,255,.08)}
.arena-stage-name{display:block;font-size:9px;font-weight:800;line-height:1.5;padding:9px 8px 0;letter-spacing:-.01em;color:#BED5E9}
.arena-stage-card[aria-pressed=true] .arena-stage-name{color:#FFE3AF}
.arena-stage-number{position:absolute;top:5px;left:7px;font:700 8px/1.3 system-ui,sans-serif;color:#B8D5EA;opacity:.7}
.arena-stage-description{font:400 11px/1.5 system-ui,sans-serif;color:#8EACC6;min-height:33px;margin:10px 0 0}
.arena-setup-options{margin:13px 0 21px}.arena-difficulty{display:flex;align-items:center;justify-content:space-between;gap:10px}
.arena-options-label{font:700 9px/1.4 system-ui,sans-serif;letter-spacing:.1em;color:#92AEC7}
.arena-segmented{display:flex;gap:3px;background:#091422;border:1px solid rgba(132,170,202,.14);border-radius:9px;padding:3px}
.arena-segment{min-height:34px;border-color:transparent;border-radius:6px;background:transparent;font:600 11px/1.2 system-ui,sans-serif;padding:7px 13px;color:#7F9BB5}
.arena-segment[aria-pressed=true]{background:#20354C;color:#DEF0FF;border-color:#3D5870}
.arena-launch{width:100%;font-size:14px}
.arena-local-note{font:400 10px/1.6 system-ui,sans-serif;color:#7F9BB5;text-align:center;margin:16px auto 0;max-width:300px}
.arena-controls-help{font:400 11px/1.6 system-ui,sans-serif;color:#8DAAC5;margin-top:24px;border-top:1px solid rgba(122,166,205,.13);padding-top:12px}
.arena-controls-help summary{cursor:pointer;min-height:34px;width:fit-content;padding:5px 0;color:#B3CEE4}
.arena-help-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:8px;padding-bottom:8px}
.arena-help-grid p{margin:0}.arena-help-grid .arena-text-button{justify-self:start;min-height:44px;padding:9px 10px;border-color:#244561}
.arena-hud{position:absolute;top:calc(var(--arena-safe-top) + 15px);left:calc(var(--arena-safe-left) + 22px);right:calc(var(--arena-safe-right) + 22px);z-index:3;pointer-events:none}
.arena-hud-top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px}.arena-match-brand{display:flex;flex-direction:column;gap:3px}.arena-match-name{font-size:11px;color:#B5D0E8;font-weight:700;letter-spacing:.015em}
.arena-hud-tools{display:flex;align-items:center;gap:16px;pointer-events:auto}.arena-clock{font:700 20px/1.3 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#DAEDFF;letter-spacing:.04em}.arena-clock-urgent{color:#FFB454}
.arena-icon-button{font:700 18px/1 system-ui,sans-serif;width:48px;height:48px;padding:10px;min-height:48px;border-radius:12px;background:rgba(11,26,45,.82)}
.arena-roster{display:flex;justify-content:center;gap:10px;max-width:930px;margin:0 auto}.arena-player-card{display:flex;align-items:center;gap:9px;position:relative;padding:9px 12px;min-width:150px;max-width:205px;flex:1;background:rgba(8,17,32,.88);border:1px solid rgba(135,174,205,.2);border-top:2px solid var(--fighter);border-radius:11px;box-shadow:0 6px 18px rgba(0,0,0,.12)}
.arena-player-helmet{position:relative;flex:0 0 25px;height:26px;border-radius:50% 50% 42% 42%;background:#E9F3FB;border:2px solid var(--fighter)}
.arena-player-helmet:before{content:'';position:absolute;left:4px;right:2px;top:6px;height:9px;border-radius:4px;background:#132D46;border-top:2px solid var(--fighter)}
.arena-player-helmet:after{content:'';position:absolute;left:8px;right:6px;bottom:-5px;height:5px;background:var(--fighter);border-radius:1px}
.arena-player-info{display:grid;grid-template-columns:auto auto;gap:2px 5px;min-width:0;align-items:baseline;flex:1}.arena-player-name{font:700 11px/1.2 system-ui,sans-serif;color:#E4F0FB;overflow:hidden;text-overflow:ellipsis}.arena-player-tag{font:700 7px/1.2 system-ui,sans-serif;color:var(--fighter);white-space:nowrap}.arena-stocks{grid-column:1/-1;font:700 10px/1.2 system-ui,sans-serif;color:var(--fighter);letter-spacing:4px;margin-top:3px}.arena-damage{font:800 24px/1 system-ui,sans-serif;letter-spacing:-.04em;font-variant-numeric:tabular-nums;color:#EFF7FF;min-width:42px;text-align:right}.arena-player-out{opacity:.46}.arena-player-out .arena-damage{font-size:15px}
.arena-player-card[data-boss=true] .arena-player-helmet{display:none}.arena-player-card[data-boss=true] .arena-player-info{grid-template-columns:minmax(0,1fr);gap:4px}.arena-player-card[data-boss=true] .arena-player-name{white-space:nowrap}.arena-player-card[data-boss=true] .arena-player-tag{overflow:hidden;text-overflow:ellipsis}.arena-player-card[data-boss=true] .arena-stocks{display:none}.arena-root .arena-player-card[data-boss=true] .arena-damage{font-size:18px;min-width:0;white-space:nowrap}
.arena-countdown{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);z-index:4;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;pointer-events:none}.arena-countdown-value{font-size:clamp(70px,14vw,140px);font-weight:900;line-height:1;color:#F4F7FF;text-shadow:0 6px 0 #183650,0 0 55px rgba(56,225,255,.18)}.arena-countdown-label{font:700 10px/1.5 system-ui,sans-serif;letter-spacing:.2em;color:#9FF1FF;white-space:nowrap;padding:6px 10px;background:rgba(6,13,28,.8);border-radius:20px}
.arena-bottom-hud{position:absolute;left:calc(var(--arena-safe-left) + 24px);right:calc(var(--arena-safe-right) + 24px);bottom:calc(var(--arena-safe-bottom) + 18px);display:flex;align-items:center;justify-content:space-between;gap:16px;pointer-events:none;z-index:3}.arena-control-hint{font:500 10px/1.6 system-ui,sans-serif;word-spacing:4px;color:#7F9DB9}.arena-abilities{display:flex;gap:9px}.arena-ability{position:relative;overflow:hidden;display:flex;align-items:center;gap:7px;min-width:100px;padding:9px 11px 11px;border:1px solid rgba(133,184,220,.23);border-radius:9px;background:rgba(8,19,34,.85)}.arena-ability-key{font:700 9px/1.2 system-ui,sans-serif;color:#DCEEFF}.arena-ability-label{font:700 8px/1.2 system-ui,sans-serif;letter-spacing:.1em;color:#A8C7E0}.arena-ability-meter{position:absolute;left:0;right:0;bottom:0;height:3px;background:#38E1FF;transform-origin:left}.arena-ability:last-child .arena-ability-meter{background:#FFC66B}
.arena-touch{position:absolute;inset:0;z-index:5;pointer-events:none;display:none}.arena-root[data-touch=true] .arena-touch{display:block}.arena-stick-zone{position:absolute;bottom:0;left:var(--arena-safe-left);width:calc(48% - var(--arena-safe-left));height:42%;min-height:140px;pointer-events:auto;touch-action:none}.arena-stick-base{position:absolute;left:76px;top:calc(100% - 88px - var(--arena-safe-bottom));width:94px;height:94px;border-radius:50%;border:1.5px solid rgba(159,241,255,.4);background:rgba(20,51,73,.18);transform:translate(-50%,-50%);opacity:.6;pointer-events:none}.arena-stick-base:before,.arena-stick-base:after{content:'';position:absolute;left:50%;top:50%;background:rgba(159,241,255,.12);transform:translate(-50%,-50%)}.arena-stick-base:before{width:76%;height:1px}.arena-stick-base:after{height:76%;width:1px}.arena-stick-knob{position:absolute;left:50%;top:50%;width:40px;height:40px;border:1px solid rgba(159,241,255,.58);border-radius:50%;background:rgba(56,225,255,.2);transform:translate(-50%,-50%)}.arena-stick-active{opacity:1;border-color:rgba(159,241,255,.8)}.arena-stick-label{position:absolute;left:76px;bottom:calc(var(--arena-safe-bottom) + 24px);transform:translateX(-50%);font:700 8px/1.2 system-ui,sans-serif;letter-spacing:.15em;color:#7796AD;pointer-events:none}
.arena-touch-actions{position:absolute;right:calc(var(--arena-safe-right) + 17px);bottom:calc(var(--arena-safe-bottom) + 23px);width:192px;height:150px;pointer-events:none}.arena-touch-button{position:absolute;min-height:60px;min-width:60px;padding:8px;display:flex;flex-direction:column;gap:2px;border-radius:50%;pointer-events:auto;touch-action:none;box-shadow:0 4px 0 rgba(0,0,0,.3);background:rgba(20,44,67,.91);border:1.5px solid #6593B1;color:#CBEBFF}.arena-touch-symbol{font:700 23px/1 system-ui,sans-serif}.arena-touch-word{font:700 8px/1.3 system-ui,sans-serif;letter-spacing:.07em}.arena-touch-jump{width:76px;height:76px;right:0;bottom:0;color:#A9F1FF;border-color:#70DCEE;background:rgba(16,56,75,.92)}.arena-touch-attack{width:70px;height:70px;left:17px;bottom:27px;color:#FFE4B3;border-color:#E3AF62;background:rgba(70,49,38,.92)}.arena-touch-dash{width:58px;height:58px;right:20px;top:0}.arena-touch-button.arena-pressed{transform:translateY(3px) scale(.96);filter:brightness(1.2);box-shadow:none}.arena-touch-button.arena-cooling{opacity:.56}.arena-root[data-lefty=true] .arena-stick-zone{left:auto;right:var(--arena-safe-right);width:calc(48% - var(--arena-safe-right))}.arena-root[data-lefty=true] .arena-stick-base{left:calc(100% - 76px)}.arena-root[data-lefty=true] .arena-stick-label{left:calc(100% - 76px)}.arena-root[data-lefty=true] .arena-touch-actions{right:auto;left:calc(var(--arena-safe-left) + 17px);transform:scaleX(-1)}.arena-root[data-lefty=true] .arena-touch-button{transform:scaleX(-1)}.arena-root[data-lefty=true] .arena-touch-button.arena-pressed{transform:scaleX(-1) translateY(3px) scale(.96)}
.arena-root[data-touch=true] .arena-bottom-hud{justify-content:center;bottom:calc(var(--arena-safe-bottom) + 8px)}.arena-root[data-touch=true] .arena-control-hint{display:none}.arena-root[data-touch=true] .arena-abilities{gap:6px}.arena-root[data-touch=true] .arena-ability{padding:4px 7px 6px;min-width:65px}.arena-root[data-touch=true] .arena-ability-key{display:none}.arena-root[data-touch=true] .arena-ability-label{font-size:7px}
.arena-root[data-screen=lobby] .arena-hud,.arena-root[data-screen=lobby] .arena-bottom-hud,.arena-root[data-screen=lobby] .arena-touch,.arena-root[data-screen=lobby] .arena-countdown,.arena-root[data-screen=pause] .arena-touch,.arena-root[data-screen=results] .arena-touch{display:none}
.arena-small-panel{width:min(440px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:11px;text-align:center;padding:30px;border:1px solid rgba(115,197,230,.27);border-radius:22px;background:linear-gradient(160deg,#14293D,#0A1224 80%);box-shadow:0 22px 70px rgba(0,0,0,.55)}.arena-small-panel .arena-pill{align-self:center;margin-bottom:8px}.arena-panel-title{font-size:27px;font-weight:900;letter-spacing:-.025em;line-height:1.25;color:#F4F7FF;margin:0}.arena-panel-copy{font:400 14px/1.6 system-ui,sans-serif;color:#9FBBD2;margin:2px 0 14px}.arena-small-panel .arena-primary{margin-bottom:7px}.arena-small-panel>.arena-text-button{min-height:40px;padding:7px}.arena-result-roster{display:flex;flex-direction:column;gap:8px;margin:0 0 12px}.arena-result-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:16px;align-items:center;text-align:left;padding:10px 12px;border-radius:8px;background:rgba(2,9,22,.45);border-left:2px solid var(--fighter);font:500 11px/1.4 system-ui,sans-serif;color:#8FAEC7}.arena-result-row strong{color:var(--fighter);font-weight:700}
.arena-root[data-calm=true] *, .arena-root[data-saver=true] *{transition:none!important;animation:none!important}.arena-root[data-saver=true] .arena-primary{box-shadow:none}
.arena-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
@media(min-width:1400px) and (min-height:800px){.arena-setup{padding:30px}.arena-lobby-top{margin-bottom:32px}.arena-lobby-grid{gap:90px}.arena-formats{gap:10px}.arena-format-card{min-height:111px}.arena-stage-card{min-height:132px}.arena-title{font-size:55px}.arena-lobby-art{max-width:455px}.arena-stage-name{font-size:10px}}
@media(max-width:850px){.arena-modal{padding:calc(var(--arena-safe-top) + 16px) calc(var(--arena-safe-right) + 16px) calc(var(--arena-safe-bottom) + 16px) calc(var(--arena-safe-left) + 16px)}.arena-lobby-grid{gap:25px;grid-template-columns:.8fr 1.2fr}.arena-title{font-size:35px}.arena-lede{font-size:13px}.arena-setup{padding:18px}.arena-format-card{padding:11px 8px}.arena-format-copy strong{font-size:10px}.arena-format-copy small{font-size:7px}.arena-stage-name{font-size:8px}.arena-roster{gap:6px}.arena-player-card{min-width:0;padding:8px;gap:7px}.arena-player-helmet{flex-basis:22px;height:23px}.arena-damage{font-size:22px}.arena-player-info{grid-template-columns:1fr}.arena-player-tag{display:none}.arena-stocks{font-size:9px;letter-spacing:3px}}
/* A phone lobby is a content-sized vertical flow, not an auto-row grid.
   Decorative desktop copy yields to the three choices and launch action. */
@media(max-width:650px){
.arena-root[data-screen=lobby] .arena-modal{align-items:flex-start;padding-top:calc(var(--arena-safe-top) + 8px);padding-bottom:calc(var(--arena-safe-bottom) + 8px)}
.arena-modal{padding-left:calc(var(--arena-safe-left) + 12px);padding-right:calc(var(--arena-safe-right) + 12px)}
.arena-lobby{padding:0 2px 4px}
.arena-lobby-top{margin-bottom:8px;gap:8px;min-height:44px}
.arena-lobby-top>.arena-eyebrow{font:700 10px/1.4 system-ui,sans-serif;letter-spacing:.08em;max-width:47%}
.arena-lobby-top .arena-text-button{font:600 12px/1.3 system-ui,sans-serif;padding:10px 6px;min-height:44px;flex-shrink:0}
.arena-lobby-grid{display:block}
.arena-intro{position:relative;padding:0 0 0 1px;min-height:0}
.arena-title{font-size:25px;line-height:1.12;margin:8px 0 0;position:relative;z-index:1;max-width:280px}
.arena-intro>.arena-pill{font-size:9px;padding:4px 8px}
.arena-lede,.arena-rules{display:none}
.arena-lobby-art{position:absolute;width:138px;max-width:45%;right:0;top:0;margin:0;opacity:.35;pointer-events:none}
.arena-setup{padding:12px;margin-top:14px;border-radius:17px}
.arena-formats,.arena-stage-cards{gap:6px}
.arena-format-card{min-height:74px;padding:9px 7px;gap:7px;justify-content:flex-start}
.arena-format-copy{gap:4px;width:100%}
.arena-format-copy strong{font:750 12px/1.2 system-ui,sans-serif;letter-spacing:0;overflow-wrap:normal}
.arena-format-copy small{font-size:9px;line-height:1.25;letter-spacing:0}
.arena-format-icon{font-size:12px}
.arena-selected-dot{right:6px;top:7px;width:4px;height:4px}
.arena-choice-group+.arena-choice-group{margin-top:14px}
.arena-stage-card{min-height:80px;padding-bottom:8px}
.arena-stage-preview{height:43px;min-height:0;object-fit:cover}
.arena-stage-name{font:650 11px/1.25 system-ui,sans-serif;padding:7px 5px 0;overflow-wrap:normal}
.arena-stage-number{font-size:9px}
.arena-stage-description{font-size:11px;line-height:1.35;min-height:0;margin-top:7px}
.arena-section-label{font-size:10px;letter-spacing:.1em;margin-bottom:8px}
.arena-setup-options{margin:10px 0 12px}
.arena-segmented{gap:2px;padding:2px}
.arena-segment{font:650 12px/1.2 system-ui,sans-serif;padding:8px 11px;min-height:44px}
.arena-options-label{font-size:10px;letter-spacing:.06em}
.arena-local-note{display:none}
.arena-launch{min-height:50px;font-size:13px}
.arena-controls-help{margin-top:10px;font-size:12px;padding-top:0}
.arena-controls-help summary{min-height:44px;padding:12px 0;font-size:11px}
.arena-help-grid{grid-template-columns:minmax(0,1fr);gap:10px}
.arena-hud{top:calc(var(--arena-safe-top) + 10px);left:calc(var(--arena-safe-left) + 13px);right:calc(var(--arena-safe-right) + 13px)}.arena-hud-top{margin-bottom:9px}.arena-match-brand .arena-eyebrow{font-size:8px}.arena-match-name{font-size:9px;max-width:255px}.arena-hud-tools{gap:10px}.arena-clock{font-size:17px}.arena-icon-button{width:44px;height:44px;min-height:44px;border-radius:10px}.arena-roster{gap:7px}.arena-player-card{padding:9px 8px;gap:7px;border-radius:9px;max-width:210px}.arena-player-name{font-size:10px}.arena-player-tag{display:block;font-size:6px}.arena-player-info{grid-template-columns:auto auto;gap:2px 4px}.arena-damage{font-size:22px;min-width:36px}.arena-player-helmet{flex-basis:22px;height:23px}.arena-stocks{font-size:9px;letter-spacing:3px}.arena-root[data-format=ffa] .arena-roster,.arena-root[data-format=teams] .arena-roster{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));max-width:430px}.arena-root[data-format=ffa] .arena-player-card,.arena-root[data-format=teams] .arena-player-card{max-width:none;padding:7px 9px}.arena-root[data-format=ffa] .arena-damage,.arena-root[data-format=teams] .arena-damage{font-size:20px}.arena-root[data-format=ffa] .arena-player-helmet,.arena-root[data-format=teams] .arena-player-helmet{flex-basis:21px;height:22px}.arena-bottom-hud{left:calc(var(--arena-safe-left) + 14px);right:calc(var(--arena-safe-right) + 14px)}.arena-control-hint{font-size:8px;max-width:140px}.arena-ability{min-width:70px;padding:8px 8px 10px;gap:5px}.arena-ability-key{font-size:7px}.arena-ability-label{font-size:7px}.arena-small-panel{padding:25px 22px;border-radius:19px}.arena-panel-title{font-size:24px}.arena-panel-copy{font-size:13px}.arena-countdown-value{font-size:104px}}
@media(max-height:600px) and (min-width:651px){.arena-modal{padding-top:calc(var(--arena-safe-top) + 10px);padding-bottom:calc(var(--arena-safe-bottom) + 10px)}.arena-lobby-top{margin-bottom:12px}.arena-lobby-grid{align-items:start}.arena-title{font-size:34px;margin:14px 0}.arena-lobby-art{max-width:280px}.arena-setup{padding:17px}.arena-format-card{min-height:78px;gap:6px;padding:9px}.arena-choice-group+.arena-choice-group{margin-top:16px}.arena-stage-card{min-height:94px}.arena-stage-preview{max-height:66px}.arena-setup-options{margin:5px 0 13px}.arena-local-note{margin-top:12px}.arena-controls-help{margin-top:14px}.arena-hud{top:calc(var(--arena-safe-top) + 8px);left:calc(var(--arena-safe-left) + 20px);right:calc(var(--arena-safe-right) + 20px)}.arena-hud-top{margin-bottom:0}.arena-match-brand{position:absolute;top:6px;left:0}.arena-hud-tools{position:absolute;top:0;right:0}.arena-match-brand .arena-eyebrow{font-size:7px}.arena-match-name{font-size:8px;max-width:160px}.arena-roster{max-width:500px;padding:0 5px}.arena-player-card{padding:7px;max-width:124px;gap:5px}.arena-player-helmet{display:none}.arena-player-tag{display:none}.arena-player-name{font-size:9px}.arena-damage{font-size:20px;min-width:30px}.arena-clock{font-size:15px}.arena-hud-tools{gap:8px}.arena-icon-button{width:44px;height:44px;min-height:44px}.arena-touch-actions{height:120px;width:179px;bottom:calc(var(--arena-safe-bottom) + 12px)}.arena-touch-jump{width:66px;height:66px}.arena-touch-attack{width:62px;height:62px;left:13px;bottom:19px}.arena-touch-dash{width:52px;height:52px;min-width:52px;min-height:52px;right:40px;top:0}.arena-stick-base{left:68px;top:calc(100% - 68px - var(--arena-safe-bottom));width:80px;height:80px}.arena-stick-label{left:68px;bottom:calc(var(--arena-safe-bottom) + 12px)}.arena-root[data-lefty=true] .arena-stick-base,.arena-root[data-lefty=true] .arena-stick-label{left:calc(100% - 68px)}.arena-countdown{top:48%}.arena-countdown-value{font-size:78px}.arena-countdown-label{font-size:8px}.arena-small-panel{max-width:420px;padding:20px;gap:8px}.arena-small-panel .arena-pill{margin-bottom:2px}.arena-panel-title{font-size:23px}.arena-panel-copy{font-size:12px;margin:0 0 6px}.arena-small-panel .arena-button{min-height:42px;padding:10px}.arena-small-panel>.arena-text-button{min-height:36px;padding:5px}.arena-result-row{padding:6px 10px;font-size:10px}}
@media(max-width:360px){.arena-modal{padding-left:calc(var(--arena-safe-left) + 8px);padding-right:calc(var(--arena-safe-right) + 8px)}.arena-setup{padding:10px}.arena-format-card{padding:9px 6px}.arena-segment{padding:8px 9px}.arena-player-helmet{display:none}.arena-player-card{gap:6px}.arena-touch-actions{right:calc(var(--arena-safe-right) + 9px);width:181px}.arena-stick-base,.arena-stick-label{left:65px}.arena-root[data-lefty=true] .arena-stick-base,.arena-root[data-lefty=true] .arena-stick-label{left:calc(100% - 65px)}}
`;
  const IDENTITY_STYLES = `
.arena-player-card[data-you=true]{border:2px solid #FFF3CE;border-top-color:#FFF3CE;background:#152333;box-shadow:0 0 0 2px #07111f,0 4px 14px #0004}
.arena-player-card[data-watching=true]{border:2px dashed #FFF3CE}
.arena-player-portrait{flex:0 0 30px;width:30px;height:38px;object-fit:contain;align-self:center}
.arena-player-info{grid-template-columns:minmax(0,1fr);gap:3px}
.arena-player-name{display:flex;align-items:center;gap:4px;white-space:nowrap;min-width:0}
.arena-player-name-text{overflow:hidden;text-overflow:ellipsis}
.arena-you-badge{flex-shrink:0;background:#FFF3CE;color:#101B29;font:900 9px/1.3 system-ui,sans-serif;letter-spacing:.02em;border-radius:4px;padding:2px 4px}
.arena-player-tag{display:block!important;font-size:8px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arena-stocks{margin-top:0}
@media(max-width:650px){.arena-player-card{gap:5px}.arena-player-portrait{flex-basis:27px;width:27px;height:34px}.arena-player-name{font-size:10px}.arena-player-tag{font-size:8px}.arena-root[data-format=teams] .arena-player-card,.arena-root[data-format=ffa] .arena-player-card{padding:6px}.arena-you-badge{font-size:8px;padding:2px 3px}.arena-player-card[data-boss=true]{grid-column:1/-1;max-width:none!important;padding:6px 10px!important}.arena-player-card[data-boss=true] .arena-player-info{display:flex;gap:8px;align-items:center}.arena-player-card[data-boss=true] .arena-player-tag{font-size:8px}}
@media(max-height:600px) and (min-width:651px){.arena-player-portrait{display:none}.arena-player-card{min-width:0}.arena-player-tag{font-size:7px}.arena-player-name{font-size:9px}.arena-you-badge{font-size:7px}.arena-player-card[data-you=true]{padding:6px}}
@media(max-width:360px){.arena-player-portrait{display:none}.arena-player-tag{font-size:8px}}
`;
  const ONLINE_STYLES = `
.arena-online-panel{margin:18px 0 0;padding:18px;border:1px solid #36526d;border-radius:18px;background:#071527cc;color:#dcefff}
.arena-online-panel .arena-local-note{display:block;max-width:none;text-align:left}
.arena-online-panel>summary{cursor:pointer;font-size:15px;font-weight:750;min-height:36px;line-height:36px}
.arena-online-entry,.arena-room-box{display:grid;gap:12px;margin-top:12px}.arena-online-entry[hidden],.arena-room-box[hidden],.arena-touch[hidden],.arena-watch-tools[hidden]{display:none!important}
.arena-online-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.arena-online-actions>button{min-height:48px}
.arena-room-input{box-sizing:border-box;min-width:0;width:100%;padding:14px;border:1px solid #36526d;border-radius:10px;background:#050b1a;color:#e8f5ff;font:16px system-ui}
.arena-room-code{font:700 18px system-ui;letter-spacing:.08em;color:#9ff1ff}.arena-room-members{margin:0;padding-left:22px;font:12px/1.8 system-ui;color:#bfd4e8}
.arena-room-qr{width:200px;height:200px;margin-top:12px;border-radius:10px}.arena-room-qr-details summary{cursor:pointer;font:13px system-ui;min-height:36px;line-height:36px}
.arena-watch-tools{position:absolute;z-index:6;bottom:calc(var(--arena-safe-bottom) + 22px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px;background:#071527ed;border:1px solid #36526d;border-radius:14px;max-width:calc(100% - 24px)}
.arena-watch-tools span{font:700 10px system-ui;text-align:center;min-width:110px}.arena-root button:disabled{opacity:.48;cursor:default}
`;
  function create(options) {
    const opts = options || {};
    let active = false, built = false, destroyed = false, rootEl, canvas, ctx, modal, lobby, pausePanel, resultPanel;
    let live, timerEl, rosterEl, statusEl, statusSub, matchTitle, touchEl, stickZone, stickBase, stickKnob, pulseButton, dashButton;
    let pulseMeter, dashMeter, countdownEl, pauseButton, launchButton, resultTitle, resultText, resultRoster;
    let formatButtons = [], stageButtons = [], difficultyButtons = [], mirrorButton, stageDescription;
    let savedFocus = null, inertSiblings = [], savedBodyOverflow = '';
    const cosmeticSession = Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 9);
    let cosmeticRound = 0;
    let arena, state = null, view = 'lobby', paused = false, activeModal = null, selections = { arenaId: '', format: 'duel', difficulty: 'normal' };
    let frameId = 0, lastTime = 0, accumulator = 0, lastDraw = 0, lastHudTick = -1, lastCountdown = '', resultAt = 0, matchSerial = 0;
    let identitySafeTop = 0, identityHudBottom = 0, identityBoundsDirty = true;
    let width = 1, height = 1, dpr = 1, viewportBox = null, background = null, bgKey = '', resizeObserver = null;
    let camera = { x: 0, y: 0, scale: 1, initialized: false }, effects = [], spectatorId = null;
    let held = new Map(), touches = new Map(), stick = null, moveX = 0, moveY = 0, jumpEdge = false, attackEdge = false, dashEdge = false;
    let touchEdges = { jump: false, attack: false, dash: false }, recoveryTap = null, clearRecoveryClick = null;
    let pad = { moveX: 0, moveY: 0, jump: false }, padPrevious = {}, padNeedsNeutral = true, lastPadId = null, usingTouch = false;
    let audio = null, audioGain = null, lastSfx = -999, leftyOverride = null, currentPrefs = {}, prefersReduced = false;
    let room = null, roomBox, roomEntry, roomMembers, roomHint, roomInput, roomInvite, roomCode, roomQR, roomRole, roomLeave, roomCopy, roomShare, roomQRDetails, roomHost, roomJoin, roomWatch, roomDetails;
    let roomStatus = null, roomSignature = '', rosterSignature = '', roomPaused = false, localRoomMenu = false, roomClosing = false, networkReceived = 0, priorNetworkTick = -1, networkEventHigh = 0;
    let watchTools, watchName;
    const onlineActive = () => !!(room && room.active);
    const localActor = () => state && state.actors.find(a => a.controller === 'human');
    const canControl = () => !onlineActive() || !!(localActor() && localActor().stocks > 0 && !(roomStatus && (roomStatus.stale || roomStatus.connection)));
    let localSession = null, sharedSession = null, inputSuspended = false;
    const listeners = [];
    const getSettings = () => { try { return (typeof opts.settings === 'function' ? opts.settings() : opts.settings) || {}; } catch (_) { return {}; } };
    const calm = () => typeof currentPrefs.reduceMotion === 'boolean' ? currentPrefs.reduceMotion : typeof currentPrefs.reducedMotion === 'boolean' ? currentPrefs.reducedMotion : prefersReduced;
    const saver = () => !!currentPrefs.batterySaver;
    const isMatch = () => view === 'match' && !!state;
    const localRescue = () => !!localSession && !!state && state.actors.some(a => a.controller === 'human' && a.stocks <= 0);
    const isRunning = () => isMatch() && !paused && !roomPaused && state.phase !== 'over';
    const selectedArena = () => arena.getArena ? arena.getArena(selections.arenaId) : (arena.arenas.find(a => a.id === selections.arenaId) || arena.arenas[0]);
    const themeFor = (a) => {
      const t = a.theme || {}, index = arena.arenas.indexOf(a);
      return { hue: t.hue === undefined ? [228, 158, 345][index % 3] : t.hue,
        accent: t.accent || t.rim || ['#38E1FF', '#C0A0FF', '#80E6BA'][index % 3],
        sky: t.sky || t.background || '#070B20', platform: t.platform || t.slab || '#26354F',
        name: t.name || a.name };
    };
    function listen(target, type, handler, settings) { target.addEventListener(type, handler, settings); listeners.push([target, type, handler, settings]); }
    function announce(text) { if (live) live.textContent = text; }
    function saveSelection() {
      if (localSession || sharedSession) return; // Itinerary choices never replace standalone preferences.
      try { root.localStorage.setItem(opts.storageKey || 'spaceman.arena.v1', JSON.stringify({ version: 1, arenaId: selections.arenaId, format: selections.format, difficulty: selections.difficulty })); } catch (_) { /* Private mode is playable. */ }
    }
    function loadSelection() {
      selections.arenaId = arena.arenas[0].id;
      try {
        const saved = JSON.parse(root.localStorage.getItem(opts.storageKey || 'spaceman.arena.v1') || 'null');
        if (saved && saved.version === 1) {
          if (arena.arenas.some(a => a.id === saved.arenaId)) selections.arenaId = saved.arenaId;
          if (FORMATS.some(f => f.id === saved.format)) selections.format = saved.format;
          if (['easy', 'normal', 'hard'].includes(saved.difficulty)) selections.difficulty = saved.difficulty;
        }
      } catch (_) { /* A corrupt preference never prevents a launch. */ }
    }
    function setModal(panel, focusTarget) {
      activeModal = panel;
      modal.hidden = !panel;
      [lobby, pausePanel, resultPanel].forEach(p => { p.hidden = p !== panel; });
      rootEl.dataset.screen = panel === lobby ? 'lobby' : panel === pausePanel ? 'pause' : panel === resultPanel ? 'results' : 'match';
      if (panel) {
        panel.setAttribute('aria-modal', 'true');
        const target = focusTarget || panel.querySelector('button:not([disabled])');
        if (target) target.focus({ preventScroll: true });
      } else { canvas.focus({ preventScroll: true }); }
    }
    function setFormat(id) { selections.format = id; syncChoices(); saveSelection(); if (onlineActive()) room.configure(selections); }
    function setArena(id) { selections.arenaId = id; camera.initialized = false; background = null; syncChoices(); saveSelection(); paintLobby(); if (onlineActive()) room.configure(selections); }
    function syncChoices() {
      formatButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.format === selections.format)));
      stageButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arena === selections.arenaId)));
      difficultyButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.difficulty === selections.difficulty)));
      const a = selectedArena();
      if (stageDescription) stageDescription.textContent = a.description;
      if (launchButton) launchButton.textContent = 'Launch ' + (selections.format === 'teams' ? 'team match' : selections.format === 'ffa' ? 'free-for-all' : 'duel') + '  ↗';
      syncRoomChoices();
    }
    function updatePrefs() {
      currentPrefs = getSettings();
      if (!rootEl) return;
      rootEl.dataset.lefty = String(leftyOverride === null ? !!currentPrefs.lefty : leftyOverride);
      rootEl.dataset.calm = String(calm()); rootEl.dataset.saver = String(saver());
      if (mirrorButton) mirrorButton.setAttribute('aria-pressed', rootEl.dataset.lefty);
      const allowed = currentPrefs.sfx !== false && !currentPrefs.muted;
      if (audioGain && audio) audioGain.gain.setValueAtTime(allowed ? clamp(currentPrefs.sfxVol === undefined ? 0.7 : currentPrefs.sfxVol, 0, 1) * 0.13 : 0, audio.currentTime);
    }
    function unlockAudio() {
      updatePrefs();
      if (currentPrefs.sfx === false || currentPrefs.muted) return;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!audio && AC) { audio = new AC(); audioGain = audio.createGain(); audioGain.connect(audio.destination); updatePrefs(); }
        if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
      } catch (_) { /* Audio is optional; no playback permission is required. */ }
    }
    function sfx(kind) {
      if (!audio || !audioGain || audio.state !== 'running' || currentPrefs.sfx === false || currentPrefs.muted) return;
      const now = audio.currentTime;
      if (now - lastSfx < 0.055 && kind !== 'win') return;
      lastSfx = now;
      const values = { attack: [540, 220, .11], hit: [190, 90, .09], dash: [280, 740, .13], jump: [340, 560, .09], ko: [170, 65, .25], start: [520, 900, .18], win: [520, 1040, .4], countdown: [660, 650, .055] };
      const v = values[kind]; if (!v) return;
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = kind === 'hit' ? 'triangle' : 'sine'; o.frequency.setValueAtTime(v[0], now); o.frequency.exponentialRampToValueAtTime(v[1], now + v[2]);
      g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(kind === 'hit' ? .8 : .55, now + .012); g.gain.exponentialRampToValueAtTime(.001, now + v[2]);
      o.connect(g); g.connect(audioGain); o.start(now); o.stop(now + v[2] + .015); o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    function resetTouchInput(clearEdges = true) {
      // Touch cancellation must never release a keyboard or controller hold.
      const previousTouches = Array.from(touches);
      touches.clear(); stick = null; moveX = moveY = 0;
      recoveryTap = null;
      if (clearEdges) touchEdges = { jump: false, attack: false, dash: false };
      for (const [id, data] of previousTouches) { data.el.classList.remove('arena-pressed'); try { if (data.el.hasPointerCapture(id)) data.el.releasePointerCapture(id); } catch (_) {} }
      if (stickBase) { stickBase.classList.remove('arena-stick-active'); stickBase.style.removeProperty('left'); stickBase.style.removeProperty('top'); stickKnob.style.transform = 'translate(-50%,-50%)'; }
    }
    function resetInput() {
      if (onlineActive()) room.release();
      held.clear(); jumpEdge = attackEdge = dashEdge = false; pad = { moveX: 0, moveY: 0, jump: false }; padNeedsNeutral = true;
      resetTouchInput();
    }
    function ownsInput() {
      if (!active) return false;
      const suspended = !!rootEl.inert;
      if (suspended !== inputSuspended) { inputSuspended = suspended; resetInput(); }
      return !suspended;
    }
    function focusables() { return activeModal ? Array.from(activeModal.querySelectorAll('button:not([disabled]),summary,[href],input:not([disabled]),[tabindex="0"]')).filter(n => !n.hidden && n.getClientRects().length) : [pauseButton]; }
    function focusStep(direction) {
      const nodes = focusables(); if (!nodes.length) return;
      const i = nodes.indexOf(document.activeElement), next = i < 0 ? (direction < 0 ? nodes.length - 1 : 0) : (i + direction + nodes.length) % nodes.length; nodes[next].focus({ preventScroll: false });
    }
    function actionForKey(e) {
      const key = (e.key || '').toLowerCase(), bindings = currentPrefs.keys || {};
      for (const action of ['left', 'right', 'jump', 'fire']) if (bindings[action] === key) return action;
      return ({ ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'down', KeyS: 'down', KeyF: 'fire', KeyJ: 'fire', ShiftLeft: 'dash', ShiftRight: 'dash', KeyK: 'dash' })[e.code] || null;
    }
    function actionHeld(action) { for (const value of held.values()) if (value === action) return true; return false; }
    function onKeyDown(e) {
      if (!ownsInput()) return;
      e.stopImmediatePropagation();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Escape') { e.preventDefault(); if (e.repeat) return; escapeAction(); return; }
      if (e.code === 'Tab') { e.preventDefault(); if (sharedSession && !state) { sharedSession.adapter.openCrew?.(); return; } if (!activeModal && isMatch()) pauseMatch('Match paused'); else focusStep(e.shiftKey ? -1 : 1); return; }
      if (activeModal) {
        if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { if (e.key === 'Enter' && e.target === roomInput) { e.preventDefault(); roomJoin.click(); } return; }
        if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); if (!e.repeat && document.activeElement && activeModal.contains(document.activeElement)) document.activeElement.click(); }
        else if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.code)) { e.preventDefault(); focusStep(e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1); }
        return;
      }
      if (onlineActive() && !canControl() && ['ArrowLeft','ArrowRight'].includes(e.code)) { e.preventDefault(); if (!e.repeat) cycleWatch(e.code === 'ArrowLeft' ? -1 : 1); return; }
      const action = actionForKey(e);
      if (action) {
        e.preventDefault();
        if (e.repeat && !held.has(e.code)) return;
        if (!held.has(e.code) && !e.repeat) {
          if (action === 'jump') jumpEdge = true;
          if (action === 'fire') attackEdge = true;
          if (action === 'dash') dashEdge = true;
        }
        held.set(e.code, action);
      }
    }
    function onKeyUp(e) { if (!ownsInput()) return; e.stopImmediatePropagation(); if (actionForKey(e)) e.preventDefault(); held.delete(e.code); }
    function escapeAction() {
      if (sharedSession && !state) { sharedSession.adapter.openCrew?.(); return; }
      resetInput();
      if (view === 'lobby') close();
      else if (activeModal === resultPanel) showLobby();
      else if (paused) resumeMatch();
      else pauseMatch('Match paused');
    }
    function guardPointer(e) {
      if (!ownsInput()) return;
      // Capture can fail or be lost when WebKit moves browser chrome. Recover
      // releases before the runner-isolation guard discards outside events.
      if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(e.type)) releaseTouch(e);
      if (e.type === 'pointerdown' && e.pointerType !== 'mouse' && e.isPrimary && touches.size && !touches.has(e.pointerId)) resetTouchInput();
      if (!(e.target instanceof root.Node) || !rootEl.contains(e.target)) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); }
    }
    function onTouchEnd(e) {
      if (!ownsInput()) return;
      // A completed tap still gets its one action if it ended between frames.
      if (active && (e.type === 'touchcancel' || (e.touches && e.touches.length === 0))) resetTouchInput(e.type === 'touchcancel');
    }
    function buttonTouchDown(e, action) {
      if (!isRunning() || !canControl() || e.pointerType === 'mouse') return;
      e.preventDefault(); e.stopPropagation(); usingTouch = true; rootEl.dataset.touch = 'true';
      const n = e.currentTarget; try { n.setPointerCapture(e.pointerId); } catch (_) {}
      touches.set(e.pointerId, { action, el: n }); n.classList.add('arena-pressed');
      touchEdges[action] = true;
    }
    function releaseTouch(e) {
      const data = touches.get(e.pointerId);
      if (data) {
        touches.delete(e.pointerId);
        const remaining = Array.from(touches.values());
        if (!remaining.some(t => t.el === data.el)) data.el.classList.remove('arena-pressed');
        if (e.type !== 'pointerup' && !remaining.some(t => t.action === data.action)) touchEdges[data.action] = false;
        try { if (data.el.hasPointerCapture(e.pointerId)) data.el.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      if (stick && e.pointerId === stick.id) { stick = null; moveX = moveY = 0; stickBase.classList.remove('arena-stick-active'); stickBase.style.removeProperty('left'); stickBase.style.removeProperty('top'); stickKnob.style.transform = 'translate(-50%,-50%)'; }
    }
    function stickDown(e) {
      if (!isRunning() || !canControl() || e.pointerType === 'mouse' || stick) return;
      e.preventDefault(); usingTouch = true; rootEl.dataset.touch = 'true';
      const r = stickZone.getBoundingClientRect(), x = clamp(e.clientX - r.left, 44, r.width - 44), y = clamp(e.clientY - r.top, 46, r.height - 46);
      stick = { id: e.pointerId, x: x + r.left, y: y + r.top };
      touches.set(e.pointerId, { action: 'move', el: stickZone });
      try { stickZone.setPointerCapture(e.pointerId); } catch (_) {}
      stickBase.style.left = x + 'px'; stickBase.style.top = y + 'px'; stickBase.classList.add('arena-stick-active'); stickMove(e);
    }
    function stickMove(e) {
      if (!stick || stick.id !== e.pointerId) return;
      e.preventDefault();
      let x = (e.clientX - stick.x) / 43, y = (e.clientY - stick.y) / 43;
      const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
      moveX = Math.abs(x) > .14 ? x : 0; moveY = Math.abs(y) > .2 ? y : 0;
      stickKnob.style.transform = 'translate(calc(-50% + ' + (x * 32).toFixed(1) + 'px),calc(-50% + ' + (y * 32).toFixed(1) + 'px))';
    }
    function pollGamepad() {
      if (!ownsInput()) return;
      let pads;
      try { pads = root.navigator.getGamepads && root.navigator.getGamepads(); } catch (_) { return; }
      const p = pads && Array.from(pads).find(p => p && p.connected && p.mapping === 'standard');
      if (!p) { if (lastPadId !== null) { pad = { moveX: 0, moveY: 0, jump: false }; padPrevious = {}; padNeedsNeutral = true; lastPadId = null; } return; }
      if (p.index !== lastPadId) { padNeedsNeutral = true; padPrevious = {}; lastPadId = p.index; }
      const b = i => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > .55));
      const raw = { jump: b(0), attack: b(2), dash: b(1) || b(6) || b(7), pause: b(9), up: b(12) || p.axes[1] < -.65, down: b(13) || p.axes[1] > .65, left: b(14) || p.axes[0] < -.65, right: b(15) || p.axes[0] > .65 };
      const x = b(14) ? -1 : b(15) ? 1 : (Math.abs(p.axes[0] || 0) > .19 ? p.axes[0] : 0);
      const y = b(12) ? -1 : b(13) ? 1 : (Math.abs(p.axes[1] || 0) > .19 ? p.axes[1] : 0);
      if (padNeedsNeutral) { padPrevious = raw; if (!Object.values(raw).some(Boolean) && !x && !y) padNeedsNeutral = false; return; }
      const edge = key => raw[key] && !padPrevious[key];
      if (edge('pause')) { escapeAction(); padPrevious = raw; return; }
      if (activeModal) {
        if (edge('down') || edge('right')) focusStep(1); else if (edge('up') || edge('left')) focusStep(-1);
        if (edge('jump') && document.activeElement && activeModal.contains(document.activeElement)) document.activeElement.click();
        else if (edge('dash')) escapeAction();
      } else { pad.moveX = x; pad.moveY = y; pad.jump = raw.jump; if (edge('jump')) jumpEdge = true; if (edge('attack')) attackEdge = true; if (edge('dash')) dashEdge = true; }
      padPrevious = raw;
    }
    function command() {
      if (!ownsInput()) return arena.normalizeCommand();
      const keyboardX = (actionHeld('right') ? 1 : 0) - (actionHeld('left') ? 1 : 0);
      const keyboardY = (actionHeld('down') ? 1 : 0) - (actionHeld('jump') && (held.has('KeyW') || held.has('ArrowUp')) ? 1 : 0);
      const c = { moveX: clamp(keyboardX + moveX + pad.moveX, -1, 1), moveY: clamp(keyboardY + moveY + pad.moveY, -1, 1),
        jumpPressed: jumpEdge || touchEdges.jump, jumpHeld: actionHeld('jump') || pad.jump || Array.from(touches.values()).some(t => t.action === 'jump'), attackPressed: attackEdge || touchEdges.attack, dashPressed: dashEdge || touchEdges.dash };
      jumpEdge = attackEdge = dashEdge = false; touchEdges = { jump: false, attack: false, dash: false }; return c;
    }
    // Only guarded, idempotent menu actions use this fallback. Native browsers
    // can omit a compatibility click after a captured drag is interrupted.
    function guardRecoveryClick() {
      if (clearRecoveryClick) clearRecoveryClick();
      let timer;
      const clear = () => {
        root.removeEventListener('click', swallow, true); root.removeEventListener('pointerdown', clear, true);
        root.clearTimeout(timer); if (clearRecoveryClick === clear) clearRecoveryClick = null;
      };
      const swallow = e => {
        if (rootEl && rootEl.inert) { clear(); return; }
        if (!e.isTrusted || e.detail === 0) return;
        e.preventDefault(); e.stopImmediatePropagation(); clear();
      };
      // This bounded guard intentionally outlives close: WebKit can retarget
      // the old finger's delayed click onto the runner below the removed dialog.
      // A new physical press immediately releases it, so the next tap still works.
      root.addEventListener('click', swallow, true); root.addEventListener('pointerdown', clear, true);
      timer = root.setTimeout(clear, 700); clearRecoveryClick = clear;
    }
    function recoveryButton(text, cls, action) {
      const n = button(text, cls, action);
      n.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.isPrimary && activeModal) recoveryTap = { el: n, id: e.pointerId, x: e.clientX, y: e.clientY }; });
      n.addEventListener('pointermove', e => { if (recoveryTap && recoveryTap.el === n && recoveryTap.id === e.pointerId && Math.hypot(e.clientX - recoveryTap.x, e.clientY - recoveryTap.y) > 10) recoveryTap = null; });
      for (const type of ['pointercancel', 'lostpointercapture']) n.addEventListener(type, e => { if (recoveryTap && recoveryTap.el === n && recoveryTap.id === e.pointerId) recoveryTap = null; });
      n.addEventListener('pointerup', e => {
        const tap = recoveryTap;
        if (!tap || tap.el !== n || tap.id !== e.pointerId) return;
        recoveryTap = null;
        if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) return;
        const r = n.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { guardRecoveryClick(); action(); }
      });
      return n;
    }
    function syncRoomChoices() {
      if (!room) return;
      const online = onlineActive(), busy = room.busy, host = room.isHost;
      for (const b of [...formatButtons, ...stageButtons, ...difficultyButtons]) b.disabled = busy || (online && !host);
      formatButtons.forEach((b,i) => { const tag = b.querySelector('small'); if (tag) tag.textContent = online ? (i === 0 ? 'UP TO 2 FRIENDS' : i === 1 ? 'UP TO 4 FRIENDS' : '2 vs 2 · PICK TEAMS') : FORMATS[i].tag; });
      if (online) { const players = roomStatus ? roomStatus.info.players : 1; launchButton.disabled = !host || !!(roomStatus && roomStatus.connection) || (selections.format === 'duel' && players > 2); launchButton.textContent = !host ? 'Waiting for host…' : roomStatus && roomStatus.connection ? 'Reconnecting…' : launchButton.disabled ? 'Choose a four-player match' : 'Start together  ↗'; }
      else launchButton.disabled = busy;
      for (const b of [roomHost,roomJoin,roomWatch]) if (b) b.disabled = busy;
      if (roomInput) roomInput.disabled = busy;
      const note = rootEl.querySelector('.arena-setup > .arena-local-note');
      if (note) note.textContent = online ? 'Friends share the same hits, lives and result. Empty slots get CPUs.' : 'Just you and the CPUs. Your sound, motion & power settings carry over.';
      const rematch = rootEl.querySelector('#arenaRematch'), next = rootEl.querySelector('#arenaNext');
      if (rematch) { rematch.disabled = online && !host; rematch.textContent = online ? (host ? 'Rematch together' : 'Waiting for host…') : 'Rematch'; }
      if (next) next.disabled = online && !host;
      const restart = pausePanel && pausePanel.querySelectorAll('button')[1]; if (restart) { restart.disabled = !!sharedSession || (online && !host); restart.hidden = !!sharedSession; }
      const back = rootEl.querySelector('#arenaLobby'); if (back) { back.hidden = !!(localSession || sharedSession); back.textContent = (localSession || sharedSession) ? 'Finish expedition' : online ? (host ? 'Back to room lobby' : 'Leave arena room') : 'Choose a match'; }
      const resume = rootEl.querySelector('#arenaResume'); if (resume) { resume.disabled = (roomPaused && !host) || !!(roomStatus && roomStatus.connection); resume.textContent = roomStatus && roomStatus.connection ? 'Reconnecting…' : roomPaused && !host ? 'Waiting for host…' : 'Resume match'; }
    }
    function cycleWatch(direction) {
      if (!state) return; const candidates = state.actors.filter(a => a.stocks > 0); if (!candidates.length) return;
      const index = candidates.findIndex(a => a.id === spectatorId); spectatorId = candidates[(index + direction + candidates.length) % candidates.length].id; camera.initialized = false;
      if (watchName) watchName.textContent = 'WATCHING ' + candidates.find(a => a.id === spectatorId).name;
    }
    function resetRoomPresentation() {
      roomPaused = localRoomMenu = false; priorNetworkTick = -1; networkEventHigh = 0;
      rosterSignature = roomSignature = ''; delete rootEl.dataset.epoch;
      if (watchTools) watchTools.hidden = true; touchEl.hidden = false;
    }
    function roomChanged(status) {
      if (!active || roomClosing) return;
      const previous = roomStatus; roomStatus = status;
      if (!status.active && ((previous && previous.active) || status.busy && !(previous && previous.busy))) resetRoomPresentation();
      roomEntry.hidden = status.active; roomBox.hidden = !status.active; roomLeave.hidden = !status.active && !status.busy;
      roomLeave.textContent = status.busy ? 'Cancel connecting' : status.host ? 'Close arena room' : 'Leave arena room';
      roomHint.textContent = status.error || status.closedReason || (status.busy ? 'Connecting to your arena… You can cancel below.' : status.connection || (status.stale ? 'Waiting for host · controls released' : status.active ? (status.host ? 'You host the match. Keep this tab open; stepping away pauses everyone.' : 'The host sets the match. Join during a round to watch until the next lobby.') : 'Up to 4 friends + 4 spectators. Empty fighter slots get CPUs.'));
      if (status.active) {
        const signature = JSON.stringify([status.roster.map(r => [r.p,r.role,r.callsign]),status.info.role,selections.format,status.current && status.current.status,status.current && status.current.seats.map(s => [s.p,s.actorId])]);
        if (signature !== roomSignature) {
          roomSignature = signature; roomMembers.replaceChildren(); const players = status.roster.filter(r => !r.spectator), numbers = players.map(r => r.p);
          for (const r of status.roster) {
            const seat = status.current && status.current.seats.find(s => s.p === r.p), actor = seat && status.current.state.actors.find(a => a.id === seat.actorId), team = actor ? actor.team : numbers.indexOf(r.p) % 2;
            const row = el('li','',(r.callsign || 'PLAYER ' + r.p) + (r.you ? ' · YOU' : '') + (r.host ? ' · HOST' : '') + (r.spectator ? ' · WATCHING' : selections.format === 'teams' ? (team === 1 ? ' · GOLD △' : ' · BLUE ◇') : ' · PLAYER'));
            if (status.host && !r.spectator && selections.format === 'teams' && status.current && status.current.status === 'lobby') { const b = button('Switch team','arena-text-button',() => room.setTeam(r.p,team === 0 ? 1 : 0)); b.dataset.teamPeer = r.p; row.append(b); }
            roomMembers.append(row);
          }
        }
        const link = status.host && typeof status.info.link === 'string' ? status.info.link : '';
        if (roomInvite.value !== link) { roomInvite.value = link; if (link && root.SpaceManQR) root.SpaceManQR.draw(roomQR.getContext('2d'),0,0,roomQR.width,link); }
        roomCopy.disabled = !link; roomCopy.hidden = !link; roomShare.hidden = !link; roomQRDetails.hidden = !link; roomQR.hidden = !link; roomInvite.hidden = !link;
        roomCode.textContent = status.info.joinCode || (link ? 'Invite link · same build' : 'Friend arena');
        roomRole.textContent = status.info.role === 1 ? 'Join next match' : 'Watch instead'; roomRole.disabled = !status.current || status.current.status !== 'lobby';
        if (status.connection || status.stale) resetInput();
        if (view === 'match') { const q = opts.net.quality(); matchTitle.textContent = selectedArena().name + ' · ' + (status.connection || (status.stale ? 'WAITING FOR HOST' : q.rttMs ? q.rttMs + ' ms · FRIEND ARENA' : 'FRIEND ARENA')); }
      } else if (status.closedReason && view === 'match') { state = null; view = 'lobby'; paused = roomPaused = localRoomMenu = false; setModal(lobby); paintLobby(); announce(status.closedReason); }
      if (!status.active) syncChoices(); else syncRoomChoices();
    }
    function networkSnapshot(snapshot) {
      if (!active || roomClosing) return;
      const old = state, newRound = !old || priorNetworkTick < 0 || snapshot.epoch !== (rootEl.dataset.epoch | 0); rootEl.dataset.epoch = snapshot.epoch;
      selections.arenaId = snapshot.state.arenaId; selections.format = snapshot.state.format; selections.difficulty = snapshot.state.difficulty;
      if (snapshot.status === 'lobby') {
        if (view !== 'lobby') { resetInput(); state = null; view = 'lobby'; paused = roomPaused = localRoomMenu = false; resultAt = 0; effects = []; setModal(lobby); paintLobby(); }
        priorNetworkTick = -1; syncChoices(); return;
      }
      state = snapshot.state; state.events = state.events.filter(e => { if (!e.serial || e.serial <= networkEventHigh) return false; networkEventHigh = e.serial; return true; });
      if (!snapshot.isHost && old && !newRound) for (const a of state.actors) { const p = old.actors.find(p => p.id === a.id); if (p && p.stocks === a.stocks && p.respawnTicks === a.respawnTicks && Math.hypot(p.x-a.x,p.y-a.y)<220) { a.px=p.x;a.py=p.y; } }
      networkReceived = performance.now(); priorNetworkTick = state.tick;
      if (view !== 'match' || newRound) {
        cosmeticRound++;
        resetInput(); view = 'match'; paused = false; localRoomMenu = false; accumulator = 0; lastTime = 0; lastHudTick = -1; lastCountdown = ''; resultAt = 0; effects = []; spectatorId = null; camera.initialized = false;
        rootEl.dataset.format = state.format; matchTitle.textContent = (localSession ? 'EXPEDITION · ' : '') + selectedArena().name + ' · FRIEND ARENA'; setModal(null); unlockAudio();
      }
      const wasPaused = roomPaused; roomPaused = snapshot.status === 'paused';
      if (roomPaused) { resetInput(); paused = true; pausePanel.querySelector('#arena-pause-reason').textContent = snapshot.isHost ? 'The whole arena is paused. Resume when you’re ready.' : 'The host paused the arena. Everyone’s match is safely frozen.'; if (activeModal !== pausePanel) setModal(pausePanel); }
      else if (wasPaused && !localRoomMenu) { paused = false; setModal(null); }
      const signature = state.actors.map(a => [a.id,a.name,a.controller,a.team,a.connected,JSON.stringify(a.appearance)].join(':')).join('|'); if (signature !== rosterSignature) { rosterSignature=signature;buildRoster(); }
      effects.forEach(e => e.life--); effects=effects.filter(e=>e.life>0); consumeEvents(); updateHud(true); syncRoomChoices();
      if (state.phase === 'over' && !resultAt) { resultAt=performance.now()+450;resetInput(); } ensureFrame();
    }
    function buildRoomControls() {
      if (!opts.net || !root.SpaceManArenaRoom) return;
      roomDetails = el('details','arena-online-panel'); roomDetails.append(el('summary','','Play with friends · Create, join or watch'));
      roomEntry=el('div','arena-online-entry'); roomHost=button('Create arena room','arena-primary',async()=>{await room.hosting(selections);roomDetails.open=true;});roomHost.id='arenaHost';
      roomInput=el('input','arena-room-input');roomInput.id='arenaRoomInput';roomInput.type='text';roomInput.placeholder=opts.build&&opts.build.preview?'Full invite link from this preview':'Room code or invite link';roomInput.setAttribute('aria-label','Arena room code or invite link');roomInput.autocomplete='off';
      const joinRow=el('div','arena-online-actions');roomJoin=button('Join arena','',()=>room.join(roomInput.value,0));roomJoin.id='arenaJoin';roomWatch=button('Watch arena','arena-text-button',()=>room.join(roomInput.value,1));roomWatch.id='arenaWatch';joinRow.append(roomJoin,roomWatch);roomEntry.append(roomHost,roomInput,joinRow);
      roomBox=el('div','arena-room-box');roomBox.hidden=true;roomCode=el('strong','arena-room-code');roomMembers=el('ul','arena-room-members');roomMembers.id='arenaRoomMembers';
      roomInvite=el('input','arena-room-input');roomInvite.id='arenaInvite';roomInvite.readOnly=true;roomInvite.setAttribute('aria-label','Arena invite link');
      roomCopy=button('Copy invite link','',async()=>{try{await root.navigator.clipboard.writeText(roomInvite.value);roomHint.textContent='Invite copied. Send it to your friends.';}catch(_){roomInvite.focus();roomInvite.select();roomHint.textContent='Select and copy this invite link.';}});
      roomShare=button('Share','arena-text-button',async()=>{if(root.navigator.share){try{await root.navigator.share({title:'Space Man · Friend Arena',url:roomInvite.value});}catch(_){}}else roomCopy.click();});
      roomQR=el('canvas','arena-room-qr');roomQR.width=roomQR.height=240;roomQR.setAttribute('aria-label','Arena invitation QR code');roomQRDetails=el('details','arena-room-qr-details');roomQRDetails.append(el('summary','','Show invite QR'),roomQR);
      roomRole=button('Watch instead','arena-text-button',async()=>{roomRole.disabled=true;const ok=await room.role(roomStatus.info.role===1?0:1);if(!ok)roomHint.textContent='No seat available yet. Try again from the next lobby.';});roomRole.id='arenaRoomRole';
      const shareRow=el('div','arena-online-actions');shareRow.append(roomCopy,roomShare,roomRole);roomBox.append(roomCode,roomMembers,roomInvite,shareRow,roomQRDetails);
      roomHint=el('p','arena-local-note');roomHint.id='arenaRoomHint';roomHint.setAttribute('role','status');roomLeave=button('Leave arena room','arena-text-button',leaveArenaRoom);roomLeave.id='arenaRoomLeave';roomLeave.hidden=true;roomDetails.append(roomEntry,roomBox,roomHint,roomLeave);lobby.append(roomDetails);
      watchTools=el('div','arena-watch-tools');watchTools.hidden=true;const prev=button('←','arena-icon-button',()=>cycleWatch(-1));prev.id='arenaWatchPrevious';prev.setAttribute('aria-label','Watch previous fighter');const next=button('→','arena-icon-button',()=>cycleWatch(1));next.id='arenaWatchNext';next.setAttribute('aria-label','Watch next fighter');watchName=el('span','','WATCHING');watchTools.append(prev,watchName,next);rootEl.append(watchTools);
      room=root.SpaceManArenaRoom.create({net:opts.net,build:opts.build,identity:opts.identity,hostOptions:opts.hostOptions,baseUrl:opts.baseUrl,onChange:roomChanged,onSnapshot:networkSnapshot});
    }
    function leaveArenaRoom() {
      if (!room) return true;
      if (room.active && room.isHost && room.status().info.players+room.status().info.spectators>1 && !root.confirm('Close the arena room? This ends the match for everyone.')) return false;
      roomClosing=true;room.close();roomClosing=false;resetRoomPresentation();showLobby();roomChanged(room.status());return true;
    }
    function build() {
      if (built) return;
      arena = root.SpaceManArena;
      if (!arena || !Array.isArray(arena.arenas) || !arena.arenas.length) throw new Error('Arena simulation is not available.');
      loadSelection();
      rootEl = el('section', 'arena-root'); rootEl.id = 'arenaRoot'; const scopedStyle = el('style'); scopedStyle.textContent = STYLES + ONLINE_STYLES + IDENTITY_STYLES; rootEl.append(scopedStyle); rootEl.hidden = true; rootEl.setAttribute('aria-label', 'Space Man Orbital Arena'); rootEl.dataset.touch = 'false';
      canvas = el('canvas', 'arena-canvas'); canvas.tabIndex = -1; canvas.setAttribute('aria-label', 'Orbital Arena match. Move with A and D or arrows. Space jumps twice. F pulses. Shift dashes. Escape pauses.');
      ctx = canvas.getContext('2d', { alpha: false }); rootEl.append(canvas);
      const header = el('header', 'arena-hud');
      const headTop = el('div', 'arena-hud-top');
      const brand = el('div', 'arena-match-brand'); brand.append(el('span', 'arena-eyebrow', 'SPACE MAN / ARENA')); matchTitle = el('span', 'arena-match-name'); brand.append(matchTitle);
      const tools = el('div', 'arena-hud-tools'); timerEl = el('span', 'arena-clock', '3:00'); timerEl.setAttribute('aria-label', 'Match time remaining');
      pauseButton = button('Ⅱ', 'arena-icon-button', () => pauseMatch('Match paused')); pauseButton.id = 'arenaPause'; pauseButton.setAttribute('aria-label', 'Pause match'); pauseButton.title = 'Pause · Esc'; tools.append(timerEl, pauseButton); headTop.append(brand, tools);
      rosterEl = el('div', 'arena-roster'); header.append(headTop, rosterEl); rootEl.append(header);
      countdownEl = el('div', 'arena-countdown'); countdownEl.setAttribute('aria-hidden', 'true'); statusEl = el('strong', 'arena-countdown-value'); statusSub = el('span', 'arena-countdown-label'); countdownEl.append(statusEl, statusSub); rootEl.append(countdownEl);
      const bottom = el('div', 'arena-bottom-hud');
      const abilities = el('div', 'arena-abilities');
      function ability(name, key) { const n = el('div', 'arena-ability'); n.append(el('span', 'arena-ability-key', key), el('span', 'arena-ability-label', name)); const meter = el('span', 'arena-ability-meter'); n.append(meter); abilities.append(n); return meter; }
      pulseMeter = ability('PULSE', 'F / J'); dashMeter = ability('DASH', '⇧ / K');
      const legend = el('p', 'arena-control-hint', 'A / D  move    SPACE  double jump'); bottom.append(legend, abilities); rootEl.append(bottom);
      touchEl = el('div', 'arena-touch');
      stickZone = el('div', 'arena-stick-zone'); stickZone.dataset.action = 'stick'; stickZone.setAttribute('aria-label', 'Move joystick'); stickBase = el('div', 'arena-stick-base'); stickKnob = el('div', 'arena-stick-knob'); stickBase.append(stickKnob); stickZone.append(stickBase, el('span', 'arena-stick-label', 'MOVE'));
      stickZone.addEventListener('pointerdown', stickDown); stickZone.addEventListener('pointermove', stickMove); stickZone.addEventListener('pointerup', releaseTouch); stickZone.addEventListener('pointercancel', releaseTouch); stickZone.addEventListener('lostpointercapture', releaseTouch);
      const touchActions = el('div', 'arena-touch-actions');
      for (const spec of [['dash', 'DASH', '↗'], ['attack', 'PULSE', '✦'], ['jump', 'JUMP', '↑']]) {
        const b = button('', 'arena-touch-button arena-touch-' + spec[0]); b.setAttribute('aria-label', spec[1] === 'PULSE' ? 'Pulse attack' : spec[1].toLowerCase()); b.tabIndex = -1; b.dataset.action = spec[0];
        b.append(el('span', 'arena-touch-symbol', spec[2]), el('span', 'arena-touch-word', spec[1]));
        b.addEventListener('pointerdown', e => buttonTouchDown(e, spec[0])); b.addEventListener('pointerup', releaseTouch); b.addEventListener('pointercancel', releaseTouch); b.addEventListener('lostpointercapture', releaseTouch);
        touchActions.append(b); if (spec[0] === 'attack') pulseButton = b; if (spec[0] === 'dash') dashButton = b;
      }
      touchEl.append(stickZone, touchActions); rootEl.append(touchEl);
      modal = el('div', 'arena-modal');
      lobby = el('div', 'arena-lobby arena-dialog'); lobby.setAttribute('role', 'dialog'); lobby.setAttribute('aria-labelledby', 'arena-lobby-title');
      const lobbyTop = el('div', 'arena-lobby-top'); lobbyTop.append(el('span', 'arena-eyebrow', 'SPACE MAN / ORBITAL ARENA'), recoveryButton('← All games', 'arena-text-button', close));
      const lobbyGrid = el('div', 'arena-lobby-grid');
      const intro = el('div', 'arena-intro'); intro.append(el('span', 'arena-pill', 'CPU + FRIEND BATTLES'));
      const h1 = el('h1', 'arena-title'); h1.id = 'arena-lobby-title'; h1.append(document.createTextNode('Small suits.'), el('br'), el('span', '', 'Big knockouts.'));
      intro.append(h1, el('p', 'arena-lede', 'Bounce between orbiting islands. Land a pulse, build up damage, and send your rivals starward.'));
      const lobbyArt = el('canvas', 'arena-lobby-art'); lobbyArt.width = 660; lobbyArt.height = 370; lobbyArt.setAttribute('aria-hidden', 'true'); intro.append(lobbyArt);
      const rules = el('div', 'arena-rules'); rules.append(el('span', '', '●  3 lives'), el('span', '', '↑↑  Double jump'), el('span', '', '✦  Bigger damage, bigger launch')); intro.append(rules);
      const setup = el('div', 'arena-setup');
      const formatGroup = el('section', 'arena-choice-group'); formatGroup.setAttribute('aria-labelledby', 'arena-format-label'); const modeLabel = el('h2', 'arena-section-label', '01 / PICK YOUR MATCH'); modeLabel.id = 'arena-format-label'; formatGroup.append(modeLabel);
      const formats = el('div', 'arena-formats');
      for (const f of FORMATS) {
        const b = button('', 'arena-format-card', () => setFormat(f.id)); b.dataset.format = f.id;
        const label = el('span', 'arena-format-copy'); label.append(el('strong', '', f.name), el('small', '', f.tag));
        b.append(el('span', 'arena-format-icon', f.icon), label, el('span', 'arena-selected-dot')); b.title = f.detail; formats.append(b); formatButtons.push(b);
      }
      formatGroup.append(formats); setup.append(formatGroup);
      const stageGroup = el('section', 'arena-choice-group'); stageGroup.setAttribute('aria-labelledby', 'arena-stage-label'); const stageLabel = el('h2', 'arena-section-label', '02 / CHOOSE YOUR ORBIT'); stageLabel.id = 'arena-stage-label'; stageGroup.append(stageLabel);
      const stages = el('div', 'arena-stage-cards');
      for (let i = 0; i < arena.arenas.length; i++) {
        const a = arena.arenas[i], b = button('', 'arena-stage-card', () => setArena(a.id)); b.dataset.arena = a.id;
        const preview = el('canvas', 'arena-stage-preview'); preview.width = 288; preview.height = 150; preview.setAttribute('aria-hidden', 'true');
        b.append(preview, el('span', 'arena-stage-name', a.name), el('span', 'arena-stage-number', '0' + (i + 1))); stages.append(b); stageButtons.push(b); paintPreview(preview, a);
      }
      stageDescription = el('p', 'arena-stage-description'); stageGroup.append(stages, stageDescription); setup.append(stageGroup);
      const settingsRow = el('div', 'arena-setup-options');
      const difficulty = el('div', 'arena-difficulty'); difficulty.setAttribute('role', 'group'); difficulty.setAttribute('aria-label', 'CPU difficulty'); difficulty.append(el('span', 'arena-options-label', 'CPU SKILL'));
      const difficultyChoices = el('div', 'arena-segmented');
      for (const [id, text] of [['easy', 'Cadet'], ['normal', 'Pilot'], ['hard', 'Ace']]) { const b = button(text, 'arena-segment', () => { selections.difficulty = id; syncChoices(); saveSelection(); if (onlineActive()) room.configure(selections); }); b.dataset.difficulty = id; difficultyButtons.push(b); difficultyChoices.append(b); }
      difficulty.append(difficultyChoices); settingsRow.append(difficulty); setup.append(settingsRow);
      launchButton = button('Launch duel  ↗', 'arena-primary arena-launch', startMatch); launchButton.id = 'arenaStart'; setup.append(launchButton);
      setup.append(el('p', 'arena-local-note', 'Just you and the CPUs. Your sound, motion & power settings carry over.'));
      lobbyGrid.append(intro, setup);
      const controls = el('details', 'arena-controls-help'); const summary = el('summary', '', 'How to play · keyboard, controller & touch'); const help = el('div', 'arena-help-grid');
      help.append(el('p', '', 'KEYBOARD · A/D or ←/→ move. Space/W/↑ jumps twice. F/J pulses. Shift/K dashes. Esc pauses.'), el('p', '', 'CONTROLLER · Stick or D-pad moves. A jumps. X pulses. B or either trigger dashes. Menu pauses.'), el('p', '', 'TOUCH · Drag the floating stick to move. Use JUMP, PULSE and DASH. Aim a pulse with the stick. Land to restore your jumps.'));
      mirrorButton = button('Mirror touch controls', 'arena-text-button', () => { leftyOverride = !(rootEl.dataset.lefty === 'true'); updatePrefs(); }); mirrorButton.setAttribute('aria-pressed', 'false'); help.append(mirrorButton); controls.append(summary, help);
      lobby.append(lobbyTop, lobbyGrid, controls); modal.append(lobby);
      pausePanel = el('div', 'arena-small-panel arena-dialog'); pausePanel.setAttribute('role', 'dialog'); pausePanel.setAttribute('aria-labelledby', 'arena-pause-title');
      const ph = el('h2', 'arena-panel-title', 'Taking a breather'); ph.id = 'arena-pause-title';
      const pauseReason = el('p', 'arena-panel-copy', 'Your match is paused.'); pauseReason.id = 'arena-pause-reason';
      const resumeButton = recoveryButton('Resume match', 'arena-primary', resumeMatch);
      pausePanel.append(el('span', 'arena-pill', 'MISSION ON HOLD'), ph, pauseReason, resumeButton, button('Restart match', '', startMatch), button('Choose a match', 'arena-text-button', showLobby), recoveryButton('All games', 'arena-text-button', close)); modal.append(pausePanel);
      resultPanel = el('div', 'arena-small-panel arena-result-panel arena-dialog'); resultPanel.setAttribute('role', 'dialog'); resultPanel.setAttribute('aria-labelledby', 'arena-result-title');
      resultTitle = el('h2', 'arena-panel-title'); resultTitle.id = 'arena-result-title'; resultText = el('p', 'arena-panel-copy'); resultRoster = el('div', 'arena-result-roster');
      resultPanel.append(el('span', 'arena-pill', 'MISSION COMPLETE'), resultTitle, resultText, resultRoster, button('Rematch', 'arena-primary', startMatch), button('Next arena  ↗', '', nextArena), button('Choose a match', 'arena-text-button', showLobby), recoveryButton('All games', 'arena-text-button', close)); modal.append(resultPanel); rootEl.append(modal);
      live = el('div', 'arena-sr-only'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true'); rootEl.append(live);
      // Events stop at this overlay, before the runner's window-level handlers.
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel']) rootEl.addEventListener(type, e => e.stopPropagation(), { passive: type.startsWith('touch') || type === 'wheel' });
      rootEl.addEventListener('contextmenu', e => e.preventDefault());
      lobby.querySelector('.arena-lobby-top button').id = 'arenaBack'; pausePanel.querySelector('.arena-primary').id = 'arenaResume'; resultPanel.querySelector('.arena-primary').id = 'arenaRematch'; resultPanel.querySelectorAll('button')[1].id = 'arenaNext'; pausePanel.querySelectorAll('button')[2].id = 'arenaLobby'; pausePanel.querySelectorAll('button')[3].id = 'arenaExit'; resultPanel.querySelectorAll('button')[3].id = 'arenaResultExit'; buildRoomControls(); document.body.append(rootEl); built = true; syncChoices(); paintHero(lobbyArt);
    }
    function makeBackground(a) {
      const bg = document.createElement('canvas'); bg.width = Math.ceil(width); bg.height = Math.ceil(height); const g = bg.getContext('2d'), t = themeFor(a), art = root.SpaceManArt;
      const gradient = g.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, a.theme.skyTop || t.sky); gradient.addColorStop(1, a.theme.skyBottom || '#18264A'); g.fillStyle = gradient; g.fillRect(0, 0, width, height);
      if (art) { const radius = Math.max(width, height) * .52; g.globalAlpha = .18; g.drawImage(art.glow(160, t.accent, .05), width * .63 - radius, height * .38 - radius, radius * 2, radius * 2); g.globalAlpha = 1; }
      for (let i = 0; i < 115; i++) { const x = hash(i + 8) * width, y = hash(i + 159) * height, size = i % 9 ? .7 : 1.6; g.globalAlpha = .2 + hash(i + 800) * .55; g.fillStyle = i % 8 ? '#D9EAFF' : t.accent; g.fillRect(x, y, size, size); }
      g.globalAlpha = 1;
      const px = width * .77, py = height * .29, radius = Math.min(width, height) * .20;
      g.save(); g.translate(px, py); g.rotate(-.3); g.strokeStyle = t.accent; g.lineWidth = 1; g.globalAlpha = .14; g.beginPath(); g.ellipse(0, 0, radius * 1.7, radius * .36, 0, 0, TAU); g.stroke();
      const planet = g.createLinearGradient(-radius, -radius, radius, radius); planet.addColorStop(0, a.theme.detail || '#334C75'); planet.addColorStop(1, t.sky); g.globalAlpha = .85; g.fillStyle = planet; g.beginPath(); g.arc(0, 0, radius, 0, TAU); g.fill();
      g.globalAlpha = .12; g.strokeStyle = '#D9EAFF'; for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(0, (i - 1.5) * radius * .32, radius * Math.sqrt(1 - Math.pow((i - 1.5) * .23, 2)), radius * .12, 0, 0, Math.PI); g.stroke(); } g.restore();
      const biome = art && art.biome(t.hue);
      for (let layer = 0; layer < 2; layer++) {
        g.fillStyle = biome ? (layer ? biome.ridgeNear : biome.ridgeFar) : '#07131D'; g.globalAlpha = layer ? .65 : .36; g.beginPath(); g.moveTo(0, height);
        for (let x = 0; x <= width + 20; x += 20) { const y = height * (.87 + layer * .04) + Math.sin(x / (width * .21) + layer * 2) * height * .03 + Math.sin(x / 39 + layer) * 8; g.lineTo(x, y); } g.lineTo(width, height); g.closePath(); g.fill();
      }
      g.globalAlpha = 1; return bg;
    }
    function platform(g, p, a, preview) {
      const theme = a.theme || {}, accent = theme.platformTop || theme.accent || '#38E1FF';
      g.fillStyle = 'rgba(0,0,0,.25)'; rounded(g, p.x + 3, p.y + 8, p.w, p.h + 4, 6); g.fill();
      g.fillStyle = theme.platform || '#192B48'; rounded(g, p.x, p.y, p.w, p.h, Math.min(p.h / 3, 7)); g.fill();
      g.fillStyle = theme.detail || '#385274'; rounded(g, p.x + 2, p.y + 1, p.w - 4, Math.max(4, p.h * .3), 3); g.fill();
      g.fillStyle = accent; rounded(g, p.x + 3, p.y, p.w - 6, 3, 1.5); g.fill();
      g.globalAlpha = .48; g.fillStyle = accent; for (let x = p.x + 14; x < p.x + p.w - 8; x += 35) g.fillRect(x, p.y + p.h - 6, 7, 2); g.globalAlpha = 1;
      if (preview) return;
      // Distinct material silhouettes, while every collision edge stays crisp.
      if (theme.id === 'bloom') {
        g.strokeStyle = theme.detail || accent; g.lineWidth = 2;
        for (let x = p.x + 22; x < p.x + p.w - 16; x += 46) { g.beginPath(); g.moveTo(x, p.y + p.h); g.quadraticCurveTo(x + 8, p.y + p.h + 18, x - 3, p.y + p.h + 27); g.stroke(); g.fillStyle = '#346A56'; g.beginPath(); g.ellipse(x + 5, p.y + p.h + 12, 7, 3, -.6, 0, TAU); g.fill(); }
      } else if (theme.id === 'ember') {
        g.fillStyle = '#684254'; for (let x = p.x + 18; x < p.x + p.w - 12; x += 32) { g.beginPath(); g.moveTo(x, p.y + p.h); g.lineTo(x + 12, p.y + p.h); g.lineTo(x + 8, p.y + p.h + 12); g.lineTo(x + 4, p.y + p.h + 12); g.fill(); }
      } else {
        g.strokeStyle = '#254A67'; g.lineWidth = 3; for (let x = p.x + 18; x < p.x + p.w - 35; x += 64) { g.beginPath(); g.moveTo(x, p.y + p.h); g.lineTo(x + 19, p.y + p.h + 16); g.lineTo(x + 38, p.y + p.h); g.stroke(); }
      }
    }
    function actorColor(actor) { return state && state.format === 'teams' ? (actor.team === 0 ? '#38E1FF' : '#FFB454') : (actor.color || PLAYER_COLORS[(actor.id - 1) % 4]); }
    function astronaut(g, actor, x, y, tick, hero) {
      const art = root.SpaceManArt, color = hero ? (actor.color || '#38E1FF') : actorColor(actor);
      const appearance = actor.appearance || ((hero || actor.id === localActor()?.id) && typeof opts.appearance === 'function' ? opts.appearance() : null);
      const style = art.characterStyle(appearance, color), P = style.palette;
      const aw = actor.w || 24, ah = actor.h || 34, boss = actor.boss;
      const w = 24, h = 34, scale = boss ? Math.min(aw / w, ah / h) : 1;
      const speed = Math.min(Math.abs(actor.vx || 0) / 6.4, 1), phase = tick * .25 + actor.id;
      const bob = calm() ? 0 : Math.sin(phase * 2) * speed * .9;
      const facing = actor.facing || 1, attack = actor.attackTicks || 0;
      g.save(); g.translate(x + aw / 2, y + ah - h * scale / 2);
      if (!calm()) g.rotate(clamp((actor.vx || 0) * .012, -.10, .10)); g.scale(facing * scale, scale);
      if (!saver()) { g.globalAlpha = actor.invulnerable ? .42 : .18; g.drawImage(art.glow(32, color, .03), -30, -31, 60, 60); g.globalAlpha = 1; }
      if (actor.invulnerable > 0) { g.strokeStyle = color; g.lineWidth = 1; g.globalAlpha = .6; g.beginPath(); g.ellipse(0, -1, w * .82, h * .7, 0, 0, TAU); g.stroke(); g.globalAlpha = 1; }
      if (actor.dashTicks > 0) {
        g.fillStyle = color; g.globalAlpha = .45; rounded(g, -w * 1.7, -5, w * 1.1, 5, 2); g.fill(); g.globalAlpha = .22; rounded(g, -w * 2.1, 3, w * 1.4, 4, 2); g.fill(); g.globalAlpha = 1;
      }
      const stride = actor.onGround ? Math.sin(phase) * speed * 4 : actor.vy < 0 ? -3 : 2;
      g.strokeStyle = P.legB; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(3, 7); g.lineTo(5 + stride, h / 2 - 2); g.stroke();
      g.strokeStyle = P.legF; g.beginPath(); g.moveTo(-3, 7); g.lineTo(-5 - stride, h / 2 - 2); g.stroke();
      g.fillStyle = '#415D78'; rounded(g, -w / 2 - 3, -6 + bob, 8, 15, 3); g.fill(); g.fillStyle = color; g.fillRect(-w / 2 - 2, -3 + bob, 3, 6);
      g.strokeStyle = P.legB; g.lineWidth = 4.5; g.beginPath(); g.moveTo(-5, bob); g.lineTo(-10, 6 + bob); g.stroke();
      g.fillStyle = P.suit; rounded(g, -8, -5 + bob, 16, 17, 6); g.fill();
      art.suitDetails(g, 0, bob, style);
      if (boss) {
        // Broader armored shoulders and three charge cells distinguish the
        // guardian at a glance; authored encounter telegraphs live outside it.
        g.fillStyle = P.legB; rounded(g, -12, -4 + bob, 6, 7, 2); g.fill(); rounded(g, 6, -4 + bob, 6, 7, 2); g.fill();
        g.fillStyle = color; for (let i = 0; i < 3; i++) g.fillRect(-3 + i * 2.5, 7 + bob, 1.5, 2);
      }
      const reaction = art.arenaMood(actor);
      const face = { tick: hero ? 20 : tick, id: actor.id, calm: calm() || hero,
        mood: reaction, lookX: Math.min(speed, .8), lookY: actor.onGround ? 0 : (actor.vy < 0 ? -.5 : .5) };
      const helmetStyle = boss?.phase === 'charging' ? { ...style, appearance: { ...style.appearance, eyes: 'determined' } } : style;
      art.characterHelmet(g, 0, -9 + bob, helmetStyle, face);
      g.strokeStyle = P.arm; g.lineWidth = 4.5; g.beginPath(); g.moveTo(6, -1 + bob); g.lineTo(attack ? 14 : 10, attack ? -3 + bob : 5 + bob); g.stroke();
      g.fillStyle = color; rounded(g, attack ? 12 : 7, attack ? -7 + bob : 2 + bob, 7, 7, 2.5); g.fill(); g.fillStyle = '#E7FEFF'; g.beginPath(); g.arc(attack ? 16 : 11, attack ? -3.5 + bob : 5.5 + bob, 1.7, 0, TAU); g.fill();
      g.restore();
    }
    function paintPreview(preview, a) {
      const g = preview.getContext('2d'), t = themeFor(a); g.fillStyle = a.theme.skyBottom || t.sky; g.fillRect(0, 0, preview.width, preview.height);
      for (let i = 0; i < 16; i++) { g.fillStyle = i % 3 ? '#8FAFCA' : t.accent; g.globalAlpha = .4; g.fillRect(hash(i + 3) * preview.width, hash(i + 42) * preview.height, 1, 1); } g.globalAlpha = 1;
      g.save(); g.scale(preview.width / a.width, preview.height / a.height); a.platforms.forEach(p => platform(g, p, a, true)); g.fillStyle = t.accent; for (const sp of a.spawns.slice(0, 2)) { g.beginPath(); g.arc(sp.x + 12, sp.y + 8, 13, 0, TAU); g.fill(); } g.restore();
    }
    function paintHero(target) {
      const g = target.getContext('2d'), art = root.SpaceManArt; g.clearRect(0, 0, target.width, target.height);
      if (art) { g.globalAlpha = .4; g.drawImage(art.glow(120, '#38E1FF', .04), 42, 50, 290, 290); g.globalAlpha = .16; g.drawImage(art.glow(120, '#FFB454', .04), 320, 0, 290, 290); g.globalAlpha = 1; }
      g.strokeStyle = 'rgba(56,225,255,.17)'; g.lineWidth = 1.5; g.save(); g.translate(300, 210); g.rotate(-.2); g.beginPath(); g.ellipse(0, 0, 264, 80, 0, 0, TAU); g.stroke(); g.restore();
      g.save(); g.translate(130, 130); g.rotate(-.12); g.scale(4.2, 4.2); astronaut(g, { id: 1, color: '#38E1FF', w: 24, h: 34, facing: 1, onGround: false, vy: -1, vx: 0, attackTicks: 5 }, 0, 0, 30, true); g.restore();
      g.save(); g.translate(420, 55); g.rotate(.18); g.scale(3.2, 3.2); astronaut(g, { id: 2, color: '#FFB454', suit: '#FFF0D6', w: 24, h: 34, facing: -1, onGround: false, vy: 1, vx: 0 }, 0, 0, 10, true); g.restore();
      g.strokeStyle = '#38E1FF'; g.lineWidth = 3; g.globalAlpha = .5; g.beginPath(); g.arc(332, 196, 38, -.7, .8); g.stroke(); g.globalAlpha = .2; g.beginPath(); g.arc(332, 196, 51, -.7, .8); g.stroke(); g.globalAlpha = 1;
      for (let i = 0; i < 6; i++) { const x = 280 + hash(i) * 110, y = 150 + hash(i + 17) * 110; g.fillStyle = i % 2 ? '#9FF1FF' : '#FFE59A'; g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-2, -2, 4, 4); g.restore(); }
    }
    function resize() {
      if (!active || !rootEl) return;
      const vv = root.visualViewport;
      const layoutWidth = document.documentElement.clientWidth || root.innerWidth || 1;
      const layoutHeight = document.documentElement.clientHeight || root.innerHeight || 1;
      const box = { left: Math.max(0, vv ? vv.offsetLeft : 0), top: Math.max(0, vv ? vv.offsetTop : 0),
        width: Math.max(1, vv ? vv.width : root.innerWidth || layoutWidth), height: Math.max(1, vv ? vv.height : root.innerHeight || layoutHeight) };
      const moved = viewportBox && Object.keys(box).some(key => Math.abs(box[key] - viewportBox[key]) > 1);
      if (moved) resetTouchInput();
      viewportBox = box;
      identitySafeTop = Math.max(0, (parseFloat(getComputedStyle(rootEl).getPropertyValue('--game-ui-top')) || 0) - box.top);
      identityBoundsDirty = true;
      for (const key of ['left', 'top', 'width', 'height']) {
        const value = box[key] + 'px'; if (rootEl.style[key] !== value) rootEl.style[key] = value;
      }
      const occlusion = { top: box.top, left: box.left, right: Math.max(0, layoutWidth - box.left - box.width), bottom: Math.max(0, layoutHeight - box.top - box.height) };
      for (const side of Object.keys(occlusion)) rootEl.style.setProperty('--arena-vv-' + side, occlusion[side] + 'px');
      // The CSS overlay and bitmap always measure the same rectangle. A
      // ResizeObserver echo/viewport scroll must not clear an unchanged canvas.
      const r = rootEl.getBoundingClientRect(), nextWidth = Math.max(1, r.width), nextHeight = Math.max(1, r.height), nextDpr = saver() ? 1 : Math.min(root.devicePixelRatio || 1, 2);
      if (width === nextWidth && height === nextHeight && dpr === nextDpr && canvas.width === Math.round(width * dpr) && canvas.height === Math.round(height * dpr)) return;
      width = nextWidth; height = nextHeight; dpr = nextDpr;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); background = null; camera.initialized = false;
      if (view === 'lobby') paintLobby(); else paint(1);
    }
    function paintLobby() {
      if (!active || !ctx) return;
      const a = selectedArena(); background = makeBackground(a); bgKey = a.id + width + height; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.drawImage(background, 0, 0, width, height);
    }
    function watchedActor() {
      const human = state.actors.find(a => a.controller === 'human') || state.actors[0];
      if ((!onlineActive() || localActor()) && human.stocks > 0) { spectatorId = null; return human; }
      const living = state.actors.filter(a => a.stocks > 0 && a.respawnTicks <= 0);
      const allies = state.format === 'teams' && (!onlineActive() || localActor()) ? living.filter(a => a.team === human.team) : [];
      const candidates = allies.length ? allies : living;
      const target = candidates.find(a => a.id === spectatorId) || candidates[0] || state.actors.find(a => a.stocks > 0) || human;
      spectatorId = target.id;
      return target;
    }
    function updateCamera(a, alpha) {
      // Measure only after roster/viewport changes, once the populated HUD is
      // visible. Boss and accessibility-sized rows must not hide pilot badges.
      if (identityBoundsDirty && rosterEl) {
        const hud = rosterEl.parentElement.getBoundingClientRect();
        identityHudBottom = hud.height ? hud.bottom - (viewportBox?.top || 0) + 8 : 0;
        identityBoundsDirty = false;
      }
      const portrait = width < height * 1.15, human = watchedActor();
      const top = Math.max(identityHudBottom, (portrait ? (state.actors.length > 2 && width < 600 ? (state.actors.some(a => a.boss) ? 198 : 178) : 125) : 95) + identitySafeTop);
      const bottom = usingTouch || rootEl.dataset.touch === 'true' ? (portrait ? 150 : 80) : 66;
      const playHeight = Math.max(170, height - top - bottom), cy = top + playHeight / 2;
      let scale, x, y;
      if (portrait) {
        scale = clamp(width / 390, .86, 1.32); const span = width / scale;
        x = clamp(lerp(human.px, human.x, alpha) + human.w / 2 + human.facing * 28, span * .38, a.width - span * .38);
        y = clamp(lerp(human.py, human.y, alpha) + human.h / 2, 245, 460);
      } else {
        scale = Math.min((width - 65) / 880, playHeight / 430, 1.7); scale = Math.max(.63, scale); x = a.width / 2; y = 330;
      }
      if (!camera.initialized) { camera = { x, y, scale, initialized: true }; }
      else { const follow = calm() ? .24 : .16; camera.x = lerp(camera.x, x, follow); camera.y = lerp(camera.y, y, follow); camera.scale = scale; }
      return { x: camera.x, y: camera.y, scale: camera.scale, centerY: cy, top, bottom, portrait };
    }
    function paint(alpha) {
      if (!active || !state || !ctx) return;
      const a = arena.getArena ? arena.getArena(state.arenaId) : selectedArena(), t = themeFor(a), key = a.id + width + height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (!background || bgKey !== key) { background = makeBackground(a); bgKey = key; } ctx.drawImage(background, 0, 0, width, height);
      const c = updateCamera(a, alpha), art = root.SpaceManArt;
      ctx.save(); ctx.translate(width / 2, c.centerY); ctx.scale(c.scale, c.scale); ctx.translate(-c.x, -c.y);
      // Quiet orbital guide rings help the camera feel located in a larger world.
      ctx.strokeStyle = t.accent; ctx.globalAlpha = .055; ctx.lineWidth = 1 / c.scale; ctx.beginPath(); ctx.ellipse(a.width / 2, 420, 445, 130, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      a.platforms.forEach(p => platform(ctx, p, a, false));
      for (const actor of state.actors) {
        const warning = actor.boss && arena.bossAttackBox && arena.bossAttackBox(actor);
        if (warning) {
          ctx.fillStyle = warning.active ? '#FF745788' : '#FFCA4630';
          ctx.strokeStyle = warning.active ? '#FF9C8B' : '#FFE39A';
          ctx.lineWidth = warning.active ? 3 : 2; ctx.setLineDash(warning.active ? [] : [9, 7]);
          ctx.fillRect(warning.x, warning.y, warning.w, warning.h); ctx.strokeRect(warning.x, warning.y, warning.w, warning.h);
          ctx.setLineDash([]);
          ctx.font = '800 12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#FFF3CE';
          ctx.fillText(warning.move === 'shockwave' ? 'JUMP THE WAVE' : 'DASH CLEAR', warning.x + warning.w / 2, warning.y - 9);
        }
      }
      for (const actor of state.actors) {
        if (actor.stocks <= 0 || actor.respawnTicks > 0) continue;
        const x = lerp(actor.px, actor.x, alpha), y = lerp(actor.py, actor.y, alpha);
        const under = a.platforms.filter(p => x + actor.w / 2 >= p.x && x + actor.w / 2 <= p.x + p.w && p.y >= y + actor.h - 3).sort((a, b) => a.y - b.y)[0];
        if (under && art) art.contactShadow(ctx, x + actor.w / 2, under.y, 33, clamp(1 - (under.y - y - actor.h) / 120, 0, 1) * .65);
        if (actor.attackTicks > 0 && arena.attackBox) {
          const box = arena.attackBox(actor);
          if (box) {
            const cx = x + actor.w / 2, cy = y + actor.h / 2, angle = Math.atan2(Number.isFinite(actor.attackDirY) ? actor.attackDirY : 0, Number.isFinite(actor.attackDirX) ? actor.attackDirX : actor.facing);
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.strokeStyle = actorColor(actor); ctx.lineCap = 'round';
            ctx.globalAlpha = box.active ? .86 : .26; ctx.lineWidth = box.active ? 4 : 1.5; ctx.beginPath(); ctx.arc(7, 0, box.active ? 34 : 23, -.82, .82); ctx.stroke();
            if (box.active && !calm()) { ctx.globalAlpha = .27; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(8, 0, 45, -.67, .67); ctx.stroke(); }
            ctx.restore();
          }
        }
        astronaut(ctx, actor, x, y, state.tick, false);

      }
      for (const e of effects) {
        const k = 1 - e.life / e.max, radius = e.type === 'ringout' ? 18 + k * 56 : 7 + k * 20;
        ctx.globalAlpha = (1 - k) * .85; ctx.strokeStyle = e.color; ctx.lineWidth = 2;
        if (calm()) { ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, TAU); ctx.fill(); }
        else {
          ctx.beginPath(); ctx.arc(e.x, e.y, radius, 0, TAU); ctx.stroke();
          if (!saver() && (e.type === 'hit' || e.type === 'ringout')) for (let i = 0; i < 6; i++) { const angle = i * TAU / 6 + e.x; const r = radius * 1.4; ctx.fillStyle = e.color; ctx.fillRect(e.x + Math.cos(angle) * r - 1.5, e.y + Math.sin(angle) * r - 1.5, 3, 3); }
        }
      }
      ctx.globalAlpha = 1; ctx.restore();
      drawIdentity(c, alpha);
      drawIndicators(c, alpha);
      if (isMatch() && localActor() && localActor().stocks <= 0 && state.phase !== 'over') { ctx.textAlign = 'center'; ctx.font = '600 13px system-ui, sans-serif'; ctx.fillStyle = '#D9EAFF'; ctx.fillText(localSession ? 'Rescue shuttle incoming' : 'You’re out · watching ' + watchedActor().name, width / 2, height - (rootEl.dataset.touch === 'true' ? 170 : 85)); }
    }
    function actorIdentity(actor) {
      const you = localActor(), watching = !you || you.stocks <= 0;
      if (actor.id === you?.id) return { role: 'you', text: 'YOU', tag: state.format === 'teams' ? (actor.team === 0 ? '◇ BLUE TEAM' : '△ GOLD TEAM') : 'YOUR PILOT' };
      const relation = actor.boss ? 'BOSS' : state.format === 'teams' ? (you ? (actor.team === you.team ? 'ALLY' : 'RIVAL') : (actor.team === 0 ? 'BLUE' : 'GOLD')) : 'RIVAL';
      const control = actor.controller === 'remote' ? (actor.connected ? 'FRIEND' : 'RECONNECTING') : 'CPU';
      const followed = watching && watchedActor().id === actor.id;
      return { role: followed ? 'watching' : 'other', text: followed ? 'WATCHING' : (state.format === 'teams' ? (actor.team === 0 ? '◇ ' : '△ ') : '') + relation + ' · ' + actor.name.toUpperCase(), tag: control + ' · ' + relation };
    }
    function drawIdentity(c, alpha) {
      const art = root.SpaceManArt, labels = [], bodies = [];
      const bounds = { left: 8, right: width - 8, top: c.top + 3, bottom: height - c.bottom - 8 };
      for (const actor of state.actors) {
        if (actor.stocks <= 0 || actor.respawnTicks > 0) continue;
        const x = (lerp(actor.px, actor.x, alpha) + actor.w / 2 - c.x) * c.scale + width / 2;
        const y = (lerp(actor.py, actor.y, alpha) - c.y) * c.scale + c.centerY;
        if (x < 12 || x > width - 12 || y + actor.h * c.scale < bounds.top || y > bounds.bottom) continue;
        const identity = actorIdentity(actor), primary = identity.role !== 'other';
        // Brackets remain visible in a pile-up without repainting anyone's suit.
        if (primary) art.identityBrackets(ctx, x, y + actor.h * c.scale / 2, Math.max(37, actor.w * c.scale + 13), Math.max(46, actor.h * c.scale + 10));
        const body = { id: actor.id, x: x - actor.w * c.scale / 2 - 5, y: y - 8, w: actor.w * c.scale + 10, h: actor.h * c.scale + 8 };
        bodies.push(body);
        ctx.font = primary ? '900 11px system-ui,sans-serif' : '700 9px system-ui,sans-serif';
        labels.push({ id: actor.id, text: identity.text, x, y: y - 43, w: ctx.measureText(identity.text).width + 18, h: primary ? 22 : 18, priority: primary ? 2 : actor.boss ? 1 : 0, primary, color: actorColor(actor), targetX: x, targetY: y - 12 });
      }
      const layout = art.identityLayout(labels, bounds, bodies);
      // A small diagnostic describes the actual painted labels for browser QA.
      rootEl.dataset.identity = layout.filter(b => b.primary).map(b => b.text + ':' + b.id).join(',');
      for (const b of layout.slice().reverse()) art.identityBadge(ctx, b.text, b.x, b.y, b.w, { primary: b.primary, color: b.color, h: b.h, pointerX: b.targetX, pointerY: b.targetY });
    }
    function drawIndicators(c, alpha) {
      for (const actor of state.actors) {
        if (actor.stocks <= 0 || actor.respawnTicks > 0) continue;
        const x = (lerp(actor.px, actor.x, alpha) + actor.w / 2 - c.x) * c.scale + width / 2;
        const y = (lerp(actor.py, actor.y, alpha) + actor.h / 2 - c.y) * c.scale + c.centerY;
        if (x > 16 && x < width - 16 && y > c.top && y < height - c.bottom) continue;
        const ix = clamp(x, 32, width - 32), iy = clamp(y, c.top + 20, height - c.bottom - 20), color = actorIdentity(actor).role !== 'other' ? '#FFF3CE' : actorColor(actor);
        ctx.save(); ctx.translate(ix, iy); ctx.fillStyle = '#091329'; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = color; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(actorIdentity(actor).role === 'you' ? 'YOU' : actorIdentity(actor).role === 'watching' ? 'EYE' : actor.name.slice(0, 1), 0, 0);
        ctx.rotate(Math.atan2(y - iy, x - ix)); ctx.beginPath(); ctx.moveTo(19, -4); ctx.lineTo(25, 0); ctx.lineTo(19, 4); ctx.fill(); ctx.restore();
      }
    }
    function buildRoster() {
      identityBoundsDirty = true;
      rosterEl.replaceChildren();
      for (const actor of state.actors) {
        const identity = actorIdentity(actor), card = el('div', 'arena-player-card'); card.dataset.actor = actor.id; card.dataset.boss = String(!!actor.boss); card.dataset.you = String(identity.role === 'you'); card.dataset.watching = String(identity.role === 'watching'); card.style.setProperty('--fighter', actorColor(actor));
        const icon = el('canvas', 'arena-player-portrait'); icon.width = 72; icon.height = 88; icon.setAttribute('aria-hidden', 'true');
        if (!actor.boss) root.SpaceManArt.drawAvatar(icon.getContext('2d'), 36, 40, 78, actor.appearance, { reduceMotion: true });
        else icon.hidden = true;
        const info = el('div', 'arena-player-info'), name = el('strong', 'arena-player-name');
        if (identity.role === 'you') name.append(el('span', 'arena-you-badge', 'YOU'));
        name.append(el('span', 'arena-player-name-text', (state.format === 'teams' && !actor.boss ? (actor.team === 0 ? '◇ ' : '△ ') : '') + actor.name));
        const tag = el('span', 'arena-player-tag', identity.tag), lives = el('span', 'arena-stocks'); info.append(name, tag, lives);
        const damage = el('strong', 'arena-damage', '0%'); card.append(icon, info, damage); rosterEl.append(card);
      }
    }
    function updateHud(force) {
      if (!state || (!force && state.tick - lastHudTick < 5)) return;
      lastHudTick = state.tick;
      const seconds = Math.max(0, Math.ceil(state.timeLeftTicks / 60)); timerEl.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); timerEl.classList.toggle('arena-clock-urgent', seconds <= 30);
      for (const actor of state.actors) {
        const card = rosterEl.querySelector('[data-actor="' + actor.id + '"]'); if (!card) continue;
        const identity = actorIdentity(actor); card.dataset.watching = String(identity.role === 'watching');
        if (!actor.boss) card.querySelector('.arena-player-tag').textContent = identity.role === 'watching' ? 'WATCHING · ' + identity.tag : identity.tag;
        if (actor.boss) {
          card.querySelector('.arena-player-tag').textContent = actor.boss.phase === 'recover' ? 'EXPOSED · PULSE' : actor.boss.phase === 'charging' ? (actor.boss.move === 'shockwave' ? 'JUMP WAVE' : 'DASH CLEAR') : 'GUARDIAN';
          card.querySelector('.arena-damage').textContent = Math.max(0, Math.ceil(actor.boss.health)) + ' HP';
          card.querySelector('.arena-stocks').textContent = 'CORE ' + Math.round(100 * actor.boss.health / actor.boss.maxHealth) + '%';
          card.setAttribute('aria-label', actor.name + ', boss core ' + Math.round(actor.boss.health) + ' health, ' + actor.boss.phase);
          continue;
        }
        card.classList.toggle('arena-player-out', actor.stocks <= 0); card.querySelector('.arena-damage').textContent = actor.stocks <= 0 ? 'OUT' : Math.round(actor.damage) + '%';
        card.querySelector('.arena-damage').style.color = actor.damage >= 100 ? '#FF8E9A' : actor.damage >= 60 ? '#FFD180' : '';
        card.querySelector('.arena-stocks').textContent = '●'.repeat(Math.max(0, actor.stocks)) + '○'.repeat(Math.max(0, (state.encounter ? state.encounter.stocks : arena.constants.STOCKS || 3) - actor.stocks));
        card.setAttribute('aria-label', actor.name + (actor.controller === 'human' ? ', you' : '') + (state.format === 'teams' ? (actor.team === 0 ? ', blue team' : ', gold team') : '') + ', ' + actor.stocks + ' lives, ' + Math.round(actor.damage) + ' percent damage');
      }
      const human = state.actors.find(a => a.controller === 'human') || state.actors[0];
      if (watchTools) { watchTools.hidden = !onlineActive() || canControl(); if (!watchTools.hidden) watchName.textContent = 'WATCHING ' + watchedActor().name; }
      touchEl.hidden = onlineActive() && !canControl();
      const attackReady = 1 - clamp(human.attackTicks / arena.constants.ATTACK_TICKS, 0, 1), dashReady = 1 - clamp(human.dashCooldown / arena.constants.DASH_COOLDOWN, 0, 1);
      pulseMeter.style.transform = 'scaleX(' + attackReady + ')'; dashMeter.style.transform = 'scaleX(' + dashReady + ')';
      pulseButton.classList.toggle('arena-cooling', human.attackTicks > 0); dashButton.classList.toggle('arena-cooling', human.dashCooldown > 0 || (!human.onGround && !human.airDashAvailable));
      pulseButton.style.setProperty('--ready', attackReady); dashButton.style.setProperty('--ready', dashReady);
      let label = '', sub = '';
      if (state.phase === 'countdown') { label = String(Math.ceil(state.countdownTicks / 60)); sub = FORMATS.find(f => f.id === state.format).name.toUpperCase() + ' · GET READY'; }
      else if (state.phase === 'playing' && state.tick < arena.constants.COUNTDOWN_TICKS + 35) { label = 'GO!'; sub = 'MAKE SOME SPACE'; }
      countdownEl.hidden = !label; statusEl.textContent = label; statusSub.textContent = sub;
      if (label && label !== lastCountdown) { announce(label === 'GO!' ? 'Go! Match started.' : 'Match starts in ' + label); sfx(label === 'GO!' ? 'start' : 'countdown'); lastCountdown = label; }
    }
    function consumeEvents() {
      for (const event of state.events || []) {
        const who = state.actors.find(a => a.id === event.actorId), type = event.type;
        if (['hit', 'ringout', 'respawn', 'jump'].includes(type)) effects.push({ type, x: event.x, y: event.y, color: who ? actorColor(who) : '#FFE59A', life: type === 'ringout' ? 44 : type === 'hit' ? 19 : 14, max: type === 'ringout' ? 44 : type === 'hit' ? 19 : 14 });
        if (type === 'boss-warning') { announce(event.move === 'shockwave' ? 'Guardian charging a ground wave. Jump!' : 'Guardian aiming. Dash out of the warning!'); sfx('countdown'); }
        else if (type === 'boss-exposed') announce('Guardian core exposed. Pulse now!');
        else if (type === 'boss-defeated') { announce('Guardian defeated!'); sfx('win'); }
        if (type === 'ringout' && who) { announce(who.name + (who.stocks > 0 ? ' has ' + who.stocks + ' lives left.' : ' is out.')); sfx('ko'); }
        else if (type === 'hit') sfx('hit');
        else if (who && who.controller === 'human' && ['jump', 'attack', 'dash'].includes(type)) sfx(type);
      }
      if (effects.length > 50) effects.splice(0, effects.length - 50);
    }
    function step() {
      if (onlineActive()) { room.step(canControl() ? command() : {}, performance.now()); return; }
      const commands = {}, input = command();
      for (const actor of state.actors) commands[actor.id] = actor.controller === 'human' ? input : arena.cpuInput(state, actor.id);
      const human = state.actors.find(a => a.controller === 'human'), oldDash = human.dashTicks;
      arena.step(state, commands);
      if (!oldDash && human.dashTicks > 0) sfx('dash');
      effects.forEach(e => e.life--); effects = effects.filter(e => e.life > 0); consumeEvents(); updateHud(false);
      if ((state.phase === 'over' || localRescue()) && !resultAt) { resultAt = performance.now() + 450; resetInput(); }
    }
    function frame(now) {
      frameId = 0;
      if (!active || document.hidden) return;
      // WebKit can dispatch resize before visualViewport exposes the settled
      // rotation size. Reconcile changed viewport metrics on the next frame;
      // unchanged frames avoid layout reads and canvas reallocation.
      const vv = root.visualViewport;
      if (vv && viewportBox && (Math.abs(vv.width - viewportBox.width) > 1 || Math.abs(vv.height - viewportBox.height) > 1 || Math.abs(vv.offsetLeft - viewportBox.left) > 1 || Math.abs(vv.offsetTop - viewportBox.top) > 1)) resize();
      updatePrefs(); pollGamepad();
      if (!active || document.hidden) return;
      const elapsed = lastTime ? Math.min(.1, Math.max(0, (now - lastTime) / 1000)) : 0; lastTime = now;
      if (isRunning()) {
        accumulator = Math.min(accumulator + elapsed, .1); let steps = 0;
        while (accumulator >= 1 / 60 && steps < 6 && isRunning()) { step(); accumulator -= 1 / 60; steps++; }
        if (steps === 6) accumulator = Math.min(accumulator, 1 / 60);
      } else accumulator = 0;
      if (isMatch() && (state.phase === 'over' || localRescue()) && !activeModal && resultAt && now >= resultAt) showResults();
      const renderGap = saver() ? 1000 / 30 : 1000 / 60;
      if (isMatch() && !paused && activeModal !== resultPanel && now - lastDraw >= renderGap - 1) { paint(paused || state.phase === 'over' ? 1 : onlineActive() && !room.isHost ? clamp((now - networkReceived) / 50, 0, 1) : clamp(accumulator * 60, 0, 1)); lastDraw = now; }
      if (!frameId && active && !document.hidden) frameId = root.requestAnimationFrame(frame);
    }
    function ensureFrame() { if (active && !document.hidden && !frameId) { lastTime = 0; frameId = root.requestAnimationFrame(frame); } }
    function startMatch() {
      if (!active || sharedSession) return;
      if (onlineActive()) { if (room.isHost) { if (room.current && room.current.status !== 'lobby') room.lobby(); room.configure(selections); room.start(((Date.now() >>> 0) ^ (++matchSerial * 2654435761)) >>> 0); } return; }
      unlockAudio(); resetInput(); saveSelection();
      // Seed ownership belongs to the pure simulation. No gameplay randomness
      // comes from frame time or presentation effects.
      matchSerial++; const seed = localSession ? localSession.seed : ((Date.now() >>> 0) ^ Math.imul(matchSerial, 2654435761)) >>> 0;
      state = arena.create({ ...(localSession ? localSession.config : {}), arenaId: selections.arenaId, format: selections.format, seed, difficulty: selections.difficulty });
      cosmeticRound++;
      if (root.SpaceManCosmetics && typeof opts.appearance === 'function') { const human = state.actors.find(a => a.controller === 'human'); if (human) human.appearance = root.SpaceManCosmetics.normalizeAppearance(opts.appearance()); }
      view = 'match'; paused = false; resultAt = 0; accumulator = 0; lastTime = 0; lastHudTick = -1; lastCountdown = ''; effects = []; spectatorId = null; camera.initialized = false;
      rootEl.dataset.format = state.format; matchTitle.textContent = (localSession ? 'EXPEDITION · ' : '') + selectedArena().name + ' · ' + FORMATS.find(f => f.id === state.format).name;
      buildRoster(); setModal(null); updateHud(true); paint(1); ensureFrame();
      if (typeof opts.onStart === 'function') opts.onStart({ arenaId: selections.arenaId, format: selections.format });
    }
    function pauseMatch(reason) {
      if (!active || !isMatch() || state.phase === 'over' || paused) return;
      paused = true; resetInput(); accumulator = 0; lastTime = 0;
      if (onlineActive()) { localRoomMenu = true; room.pause(true); }
      pausePanel.querySelector('#arena-pause-reason').textContent = reason === 'You stepped away' ? 'You stepped away, so we paused the match. Resume when you’re ready.' : 'Catch your breath. Everyone will wait for you.';
      if (onlineActive()) pausePanel.querySelector('#arena-pause-reason').textContent = room.isHost ? 'The whole arena is paused. Resume when you’re ready.' : roomPaused ? 'The host paused the arena. Everyone’s match is safely frozen.' : 'The arena keeps playing. Your controls are released while this menu is open.';
      syncRoomChoices(); setModal(pausePanel); announce(reason || 'Match paused');
      if (audio && audio.state === 'running') audio.suspend().catch(() => {});
      paint(1);
    }
    function resumeMatch() {
      if (!active || !isMatch() || !paused || document.hidden) return;
      if (onlineActive() && ((roomPaused && !room.isHost) || (roomStatus && roomStatus.connection))) return;
      resetInput(); localRoomMenu = false; if (onlineActive()) room.pause(false); paused = false; accumulator = 0; lastTime = 0; unlockAudio(); setModal(null); announce('Match resumed'); ensureFrame();
    }
    function showLobby() {
      if (!active) return;
      if (localSession || sharedSession) { close(); return; }
      if (onlineActive()) { if (!room.isHost) { leaveArenaRoom(); return; } room.lobby(); }
      resetInput(); state = null; view = 'lobby'; paused = false; resultAt = 0; accumulator = 0; effects = []; camera.initialized = false;
      syncChoices(); setModal(lobby, formatButtons.find(b => b.dataset.format === selections.format)); paintLobby(); announce('Choose your arena match');
      if (audio && audio.state === 'running') audio.suspend().catch(() => {});
    }
    function nextArena() { const i = arena.arenas.findIndex(a => a.id === selections.arenaId); selections.arenaId = arena.arenas[(i + 1) % arena.arenas.length].id; syncChoices(); startMatch(); }
    function showResults() {
      if (!state || (!state.result && !localRescue())) return;
      if (sharedSession) { resetInput(); return; }
      updateHud(true); // The final stock loss must bypass the five-tick HUD throttle.
      resetInput(); const result = state.result || { tie: false, winnerIds: [], winnerTeam: null }, human = state.actors.find(a => a.controller === 'human');
      const won = !!human && (result.winnerIds.includes(human.id) || (state.format === 'teams' && result.winnerTeam === human.team));
      if (localSession) {
        if (!localSession.reported) {
          localSession.reported = true;
          localSession.onResult({ won, tie: result.tie, kos: human ? human.kos : 0, stocks: human ? human.stocks : 0 });
        }
        return;
      }
      resultTitle.textContent = result.tie ? 'A cosmic stalemate' : won ? (state.format === 'teams' ? 'Your crew wins!' : 'You held your orbit!') : 'One more orbit?';
      const winners = state.actors.filter(a => result.winnerIds.includes(a.id)).map(a => a.name).join(' & ');
      resultText.textContent = result.tie ? 'An even match among the stars. Ready for a tiebreaker?' : won ? 'Nice flying. The last launch belongs to you.' : (winners || 'The other crew') + ' took this round. A fresh launch is one tap away.';
      resultRoster.replaceChildren();
      for (const actor of state.actors) { const row = el('div', 'arena-result-row'); row.style.setProperty('--fighter', actorColor(actor)); row.append(el('strong', '', actor.name + (actor.controller === 'human' ? ' · YOU' : '')), el('span', '', (actor.kos || 0) + ' KO' + ((actor.kos || 0) === 1 ? '' : 's')), el('span', '', actor.stocks + ' lives')); resultRoster.append(row); }
      if (onlineActive() && !human && !result.tie) { resultTitle.textContent = winners + ' win!'; resultText.textContent = 'Shared match complete. The host can launch another round.'; }
      if (human && typeof opts.onReward === 'function') {
        const receipt = onlineActive() ? root.SpaceManCosmetics.roundReceipt('arena', opts.net.info().roomId, Number(rootEl.dataset.epoch)) : cosmeticSession + ':' + cosmeticRound;
        const found = receipt ? opts.onReward({ type: 'arena', id: receipt }) || [] : [];
        if (found.length) resultText.textContent += ' Found: ' + found.map(id => root.SpaceManCosmetics.item(id)?.name || '').join(', ') + '.';
      }
      syncRoomChoices(); setModal(resultPanel); sfx('win'); announce(resultTitle.textContent + ' ' + resultText.textContent);
    }
    function onVisibility() {
      if (!active) return;
      resetInput(); lastTime = 0; accumulator = 0;
      if (document.hidden) { pauseMatch('You stepped away'); if (frameId) root.cancelAnimationFrame(frameId); frameId = 0; if (audio && audio.state === 'running') audio.suspend().catch(() => {}); }
      else { resize(); ensureFrame(); }
    }
    function onBlur(e) {
      if (!active || e.target !== root) return;
      resetInput();
      // iOS in-app chrome may blur a still-visible game. Visibility/pagehide
      // own mobile backgrounding; desktop window changes still pause at once.
      const mobileChrome = !!(root.matchMedia && root.matchMedia('(pointer: coarse) and (hover: none)').matches);
      if (document.hidden || !mobileChrome) pauseMatch('You stepped away');
    }
    function onPageHide() {
      if (!active) return;
      resetInput(); pauseMatch('You stepped away');
      if (frameId) root.cancelAnimationFrame(frameId); frameId = 0;
    }
    function onPageShow() { if (active && !document.hidden) { resize(); ensureFrame(); } }
    function open() {
      if (active || destroyed) return;
      build(); active = true; savedFocus = document.activeElement; savedBodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
      inertSiblings = Array.from(document.body.children).filter(n => n !== rootEl && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName)).map(n => ({ node: n, inert: n.inert }));
      inertSiblings.forEach(s => { s.node.inert = true; });
      rootEl.hidden = false; prefersReduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      usingTouch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches); rootEl.dataset.touch = String(usingTouch); updatePrefs();
      listen(root, 'keydown', onKeyDown, true); listen(root, 'keyup', onKeyUp, true); listen(root, 'blur', onBlur); listen(document, 'visibilitychange', onVisibility, true); listen(root, 'pagehide', onPageHide); listen(root, 'pageshow', onPageShow); listen(root, 'resize', resize);
      if (root.visualViewport) { listen(root.visualViewport, 'resize', resize); listen(root.visualViewport, 'scroll', resize); }
      listen(root, 'touchend', onTouchEnd, { capture: true, passive: true }); listen(root, 'touchcancel', onTouchEnd, { capture: true, passive: true });
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'click']) listen(root, type, guardPointer, { capture: true, passive: false });
      if (root.ResizeObserver) { resizeObserver = new root.ResizeObserver(resize); resizeObserver.observe(rootEl); resizeObserver.observe(rosterEl.parentElement); }
      resize(); showLobby(); if (room) roomChanged(room.status()); ensureFrame();
    }
    function close(options = {}) {
      if (!active) return;
      const shared = sharedSession;
      if (shared && !options.transition && shared.adapter.confirmLeave && !shared.adapter.confirmLeave()) return;
      if (shared) {
        const crewButton = pausePanel.querySelector('#arenaJourneyCrew'); if (crewButton) crewButton.hidden = true;
        shared.detach?.(); sharedSession = null;
        room.release(); room = shared.previousRoom; selections = shared.previous;
      }
      if (room && (room.active || room.busy) && !leaveArenaRoom()) return;
      resetInput(); active = false; if (frameId) root.cancelAnimationFrame(frameId); frameId = 0; lastTime = 0; accumulator = 0;
      for (const [target, type, fn, settings] of listeners.splice(0)) target.removeEventListener(type, fn, settings);
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
      rootEl.hidden = true; viewportBox = null; activeModal = null; state = null; view = 'lobby'; paused = false; effects = [];
      inertSiblings.forEach(s => { if (s.node.isConnected) s.node.inert = s.inert; }); inertSiblings = []; document.body.style.overflow = savedBodyOverflow;
      if (audio && audio.state === 'running') audio.suspend().catch(() => {});
      if (savedFocus && savedFocus.isConnected && typeof savedFocus.focus === 'function') savedFocus.focus({ preventScroll: true });
      if (localSession) { selections = localSession.previous; localSession = null; }
      rootEl.dataset.session = 'false';
      pausePanel.querySelector('#arenaLobby').hidden = false;
      pausePanel.querySelector('#arenaLobby').textContent = 'Choose a match';
      pausePanel.querySelector('#arenaExit').textContent = 'All games';
      const restart = pausePanel.querySelectorAll('button')[1]; if (restart) restart.hidden = false;
      if (shared && !options.transition) shared.adapter.leave();
      if (!options.transition && !shared && typeof opts.onClose === 'function') opts.onClose();
    }
    function openSharedSession(config, adapter) {
      if (active || destroyed || !adapter || typeof adapter.attach !== 'function') return false;
      open();
      sharedSession = { previousRoom: room, previous: { ...selections }, adapter, detach: null };
      room = adapter;
      selections = { arenaId: arena.getArena(config.arenaId).id, format: config.format || 'teams', difficulty: 'easy' };
      rootEl.dataset.session = 'true';
      pausePanel.querySelector('#arenaExit').textContent = 'Leave expedition';
      let crewButton = pausePanel.querySelector('#arenaJourneyCrew');
      if (!crewButton) { crewButton = button('Crew · seats & invite', 'arena-text-button', () => sharedSession?.adapter.openCrew?.()); crewButton.id = 'arenaJourneyCrew'; pausePanel.append(crewButton); }
      crewButton.hidden = false;
      sharedSession.detach = adapter.attach({ onChange: roomChanged, onSnapshot: networkSnapshot });
      syncRoomChoices(); if (!state) { setModal(null); touchEl.hidden = true; } return true;
    }
    function closeSharedSession() { if (sharedSession) close({ transition: true }); }
    function openSession(config, onResult) {
      if (active || destroyed || (opts.net && opts.net.active) || typeof onResult !== 'function') return false;
      open();
      localSession = { config: { ...config }, seed: config.seed >>> 0, previous: { ...selections }, onResult, reported: false };
      selections = { arenaId: arena.getArena(config.arenaId).id, format: config.format === 'teams' ? 'teams' : 'duel', difficulty: 'easy' };
      rootEl.dataset.session = 'true';
      pausePanel.querySelector('#arenaLobby').textContent = 'Finish expedition';
      pausePanel.querySelector('#arenaExit').textContent = 'Finish expedition';
      syncChoices(); startMatch(); return true;
    }
    function destroy() { close(); destroyed = true; if (clearRecoveryClick) clearRecoveryClick(); if (rootEl) rootEl.remove(); if (audio) { audio.close().catch(() => {}); audio = null; } }
    return Object.freeze({ open, openSession, openSharedSession, closeSharedSession, close, destroy, joinInvite(payload, role) { if (!active) open(); if (!room) return Promise.resolve(false); roomDetails.open = true; return room.join(payload, role, true); }, get active() { return active; }, get screen() { return !active ? 'closed' : view === 'lobby' ? 'lobby' : activeModal === resultPanel ? 'results' : paused ? 'pause' : 'play'; }, snapshot() { return state ? (arena.snapshot ? arena.snapshot(state) : JSON.parse(JSON.stringify(state))) : null; } });
  }
  root.SpaceManArenaUI = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
