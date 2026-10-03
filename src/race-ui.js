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
  const CSS = `
.race-root{position:fixed;inset:0 auto auto 0;width:100%;height:100dvh;background:#080f24;color:#eef7fb;z-index:1000;isolation:isolate;overflow:hidden;font:14px/1.45 ui-rounded,system-ui,sans-serif;touch-action:none;user-select:none;color-scheme:dark;--race-top:max(0px,calc(var(--game-ui-top,env(safe-area-inset-top,0px)) - var(--race-vv-top,0px)));--race-bottom:max(0px,calc(var(--game-ui-bottom,env(safe-area-inset-bottom,0px)) - var(--race-vv-bottom,0px)));--race-left:max(0px,calc(var(--game-ui-left,env(safe-area-inset-left,0px)) - var(--race-vv-left,0px)));--race-right:max(0px,calc(var(--game-ui-right,env(safe-area-inset-right,0px)) - var(--race-vv-right,0px)))}
.race-root,.race-root *{box-sizing:border-box}.race-root[hidden],.race-root [hidden]{display:none!important}.race-root :focus-visible{outline:3px solid #fff09d;outline-offset:-3px}.race-root button{-webkit-tap-highlight-color:transparent;appearance:none;cursor:pointer;font:inherit}.race-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.race-canvas:focus-visible{outline:2px solid #73ecff50!important;outline-offset:-2px!important}
.race-button{min-height:46px;padding:10px 17px;color:#d9edf8;border:1px solid #38536b;border-radius:13px;background:#192f45;font-weight:700;font-size:12px;line-height:1.4;max-width:100%}.race-button:hover{background:#26445b}.race-button:active,.race-pressed{transform:translateY(2px);background:#38617b!important}.race-primary{background:#c7f47d;color:#152b30;border-color:#deffae;min-height:54px;box-shadow:0 4px 0 #53783d;font-size:14px}.race-primary:hover{background:#e0ffa9}.race-text{border-color:transparent;background:transparent;color:#9eb9cc}.race-small{padding:8px 12px;min-height:44px}.race-kicker{font-size:10px;font-weight:800;letter-spacing:.18em;color:#90acbf}.race-tag{color:#c7f47d;font-size:10px;font-weight:800;letter-spacing:.12em}.race-pill{padding:7px 11px;border:1px solid #628754;border-radius:20px;background:#172d2e;display:inline-block;color:#d3f9a6;font-size:10px;letter-spacing:.12em;font-weight:750}
.race-modal{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:calc(var(--race-top) + 20px) calc(var(--race-right) + 24px) calc(var(--race-bottom) + 20px) calc(var(--race-left) + 24px);background:linear-gradient(110deg,#080f24ed,#080f2466);overflow:hidden}.race-dialog{width:min(1060px,100%);max-height:100%;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#38617b transparent;min-width:0}.race-lobby-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;gap:12px}.race-grid{display:grid;grid-template-columns:1fr 1.12fr;align-items:center;gap:48px}.race-intro{min-width:0}.race-title{font-size:clamp(42px,5vw,68px);font-weight:950;letter-spacing:-.06em;line-height:.95;margin:20px 0}.race-title span{display:block;color:#c7f47d}.race-lede{max-width:310px;color:#a9bed0;font-size:14px;line-height:1.65}.race-hero{width:100%;height:auto;display:block;max-width:390px;margin:-8px 0}.race-facts{display:flex;gap:18px;color:#9eb8ca;font-size:11px;flex-wrap:wrap}.race-facts strong{color:#eef7fb;display:block;font-size:15px}
.race-setup{padding:23px;border:1px solid #344e64;border-radius:22px;background:linear-gradient(130deg,#172b41ef,#0e1e33ef);min-width:0}.race-label{margin:0 0 10px;color:#a9bed0;font-size:10px;letter-spacing:.12em;font-weight:800}.race-track-list{display:grid;gap:8px}.race-track{width:100%;display:flex;align-items:center;gap:13px;text-align:left;min-height:78px;padding:9px 12px;background:#0d1e32;min-width:0}.race-track[aria-pressed=true]{border-color:#c7f47d;background:#203b3d}.race-track canvas{width:95px;height:57px;flex:0 0 95px}.race-track strong{display:block;font-size:12px;color:#eff9ff;letter-spacing:-.01em}.race-track small{font-size:8px;font-weight:800;letter-spacing:.15em;color:#8faaBE}.race-track-description{color:#91aabf;font-size:11px;min-height:30px;margin:10px 0 14px}.race-options{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 20px}.race-segments{display:flex;gap:3px;background:#0b1a2b;border:1px solid #2a4258;padding:3px;border-radius:10px}.race-segment{background:transparent;border-color:transparent;min-height:36px;padding:7px 12px;font-size:11px}.race-segment[aria-pressed=true]{background:#35516a;color:#fff}.race-launch{width:100%}.race-local-note{font-size:10px;color:#92aabf;text-align:center;margin:15px 0 0}.race-help{border-top:1px solid #293f56;padding-top:10px;margin-top:17px;color:#a4bdcf;font-size:11px}.race-help summary{min-height:35px;cursor:pointer;color:#c4d9e7;padding:7px 0}.race-help p{margin:5px 0 12px}
.race-hud{position:absolute;left:calc(var(--race-left) + 20px);right:calc(var(--race-right) + 20px);top:calc(var(--race-top) + 16px);z-index:3;pointer-events:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.race-hud-box{display:flex;align-items:center;gap:18px;background:#091727df;border:1px solid #426174;border-radius:15px;padding:11px 15px;box-shadow:0 4px 24px #0004;min-width:0}.race-position{font-size:39px;font-weight:900;line-height:1;color:#c7f47d;letter-spacing:-.05em}.race-position small{font-size:14px;color:#8facbf}.race-metric{display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums}.race-metric strong{font-size:17px}.race-metric span{font-size:8px;color:#93adbf;font-weight:700;letter-spacing:.14em}.race-hud-left{display:grid;gap:6px;min-width:0;max-width:190px}.race-identity{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 9px;background:#091727f2;border:1.5px solid #FFF3CE;border-radius:11px;color:#FFF3CE;box-shadow:0 2px 8px #0006}.race-identity canvas{width:30px;height:30px;flex:0 0 30px;background:#23354a;border-radius:50%}.race-identity-copy{display:flex;flex-direction:column;min-width:0;line-height:1.25}.race-identity-role{font-size:10px;letter-spacing:.1em;font-weight:900}.race-identity-name{font-size:11px;font-weight:650;color:#eef7fb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.race-hud-right{display:flex;gap:8px;align-items:center}.race-pause{pointer-events:auto;width:48px;height:48px;padding:10px;font-size:19px;background:#112a3ee8}.race-time{color:#e7f3fb;font-size:18px;font-weight:750;font-variant-numeric:tabular-nums;background:#091727df;border:1px solid #344e64;border-radius:12px;padding:10px 13px}.race-speed{position:absolute;left:calc(var(--race-left) + 23px);bottom:calc(var(--race-bottom) + 22px);z-index:3;color:#e5f6ff;pointer-events:none;background:#091727d9;border:1px solid #34505d80;border-radius:10px;padding:8px 10px}.race-speed strong{font-size:29px;line-height:1;font-variant-numeric:tabular-nums}.race-speed span{font-size:9px;letter-spacing:.1em;color:#94b7ca}.race-drive-feedback{font-size:10px;font-weight:900;letter-spacing:.08em;color:#8ceaff;margin-top:6px}.race-drive-feedback[data-kind=boost]{color:#d6ff96}.race-boostbar{width:130px;height:5px;background:#2d4456;border-radius:9px;overflow:hidden;margin-top:7px}.race-boostfill{height:100%;background:#c7f47d;transform-origin:left}.race-hint{position:absolute;bottom:calc(var(--race-bottom) + 23px);left:50%;transform:translateX(-50%);padding:6px 10px;background:#091727d9;color:#a8c7d9;z-index:3;font-size:10px;white-space:nowrap;border-radius:8px;pointer-events:none}.race-minimap{position:absolute;right:calc(var(--race-right) + 20px);bottom:calc(var(--race-bottom) + 20px);width:170px;height:120px;background:#091727a9;border:1px solid #426174;border-radius:14px;z-index:3;pointer-events:none}.race-banner{position:absolute;left:50%;top:35%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:4;color:#eefaff;font-size:72px;font-weight:950;text-shadow:0 5px 0 #122c42}.race-banner small{display:block;font-size:10px;letter-spacing:.18em;color:#c7f47d;background:#091727c9;border-radius:18px;padding:7px 12px;text-shadow:none}.race-warning{position:absolute;top:calc(var(--race-top) + 142px);left:50%;transform:translateX(-50%);background:#543421e0;border:1px solid #c18c5e;border-radius:20px;padding:6px 14px;font-size:10px;color:#ffe0b5;z-index:3;pointer-events:none;white-space:nowrap}
.race-touch{display:none;position:absolute;inset:0;z-index:4;pointer-events:none}.race-root[data-touch=true] .race-touch{display:block}.race-root[data-touch=true] .race-hint,.race-root[data-screen=lobby] .race-hint{display:none}.race-touch-group{display:flex;align-items:end;gap:10px;position:absolute;bottom:calc(var(--race-bottom) + 22px);pointer-events:auto;touch-action:none}.race-steering{left:calc(var(--race-left) + 18px)}.race-actions{right:calc(var(--race-right) + 18px)}.race-touch-button{width:65px;height:65px;border-radius:20px;background:#102e42d9;border:1.5px solid #73a9bd;color:#e7faff;font-size:27px;padding:5px;box-shadow:0 4px 0 #071522;touch-action:none}.race-touch-button small{display:block;font-size:8px;letter-spacing:.08em;color:#b3d1e1}.race-touch-boost{background:#334735db;border-color:#c7f47d;color:#daffae}.race-touch-boost span{font-size:22px}.race-root[data-handed=left] .race-steering{left:auto;right:calc(var(--race-right) + 18px)}.race-root[data-handed=left] .race-actions{right:auto;left:calc(var(--race-left) + 18px)}.race-root[data-touch=true] .race-speed{bottom:calc(var(--race-bottom) + 104px)}.race-root[data-touch=true] .race-minimap{bottom:calc(var(--race-bottom) + 106px);width:132px;height:92px}.race-recover{position:absolute;left:50%;bottom:calc(var(--race-bottom) + 25px);transform:translateX(-50%);pointer-events:auto;background:#0b2235d9;font-size:9px;padding:7px 10px;min-height:44px}
.race-compact{width:min(430px,100%);padding:25px;background:#0d2035f5;border:1px solid #456174;border-radius:23px;box-shadow:0 18px 100px #0006}.race-compact h2{font-size:34px;letter-spacing:-.05em;line-height:1.08;margin:16px 0 12px}.race-compact p{color:#aac3d3;font-size:13px}.race-compact>.race-button{width:100%;margin-top:10px}.race-results{margin:20px 0}.race-result-row{display:flex;align-items:center;gap:14px;padding:10px 4px;border-bottom:1px solid #294054;color:#d2e6f3;font-size:12px}.race-result-row strong{flex:1}.race-result-row span:first-child{font-size:19px;color:#c7f47d;font-weight:800}.race-result-row span:last-child{font-variant-numeric:tabular-nums;color:#93b2c6}.race-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:760px){.race-grid{gap:22px;grid-template-columns:1fr}.race-intro{display:grid;grid-template-columns:1fr .8fr;column-gap:10px;align-items:center}.race-intro>.race-pill{grid-column:1;justify-self:start;font-size:8px;letter-spacing:.1em;padding:6px 9px}.race-title{font-size:34px;line-height:1;margin:13px 0;grid-column:1}.race-lede{font-size:12px;margin:0;grid-column:1/-1;max-width:none}.race-hero{grid-column:2;grid-row:1/4;width:100%;margin:0}.race-facts{display:none}.race-lobby-header{margin-bottom:8px}.race-setup{padding:17px}.race-track{min-height:68px}.race-track canvas{width:85px;height:50px;flex-basis:85px}.race-options{margin-bottom:15px}.race-modal{padding:calc(var(--race-top) + 12px) calc(var(--race-right) + 16px) calc(var(--race-bottom) + 14px) calc(var(--race-left) + 16px)}.race-hud{left:calc(var(--race-left) + 12px);right:calc(var(--race-right) + 12px);top:calc(var(--race-top) + 12px);gap:7px}.race-hud-box{gap:13px;padding:10px 12px}.race-position{font-size:32px}.race-metric strong{font-size:15px}.race-time{font-size:14px;padding:11px 10px}.race-pause{width:44px;height:44px;min-height:44px}.race-touch-group{gap:7px}.race-touch-button{width:59px;height:63px}.race-steering{left:calc(var(--race-left) + 13px)}.race-actions{right:calc(var(--race-right) + 13px)}.race-recover{font-size:8px;padding:7px;bottom:calc(var(--race-bottom) + 31px)}.race-hint{max-width:60%;white-space:normal;text-align:center}.race-warning{top:calc(var(--race-top) + 128px)}}
@media(max-height:520px) and (min-width:600px){.race-hud-left{grid-template-columns:auto minmax(0,170px);align-items:center;max-width:360px}.race-warning{top:calc(var(--race-top) + 103px)}.race-grid{grid-template-columns:.85fr 1.15fr;gap:25px;align-items:start}.race-intro{display:block}.race-title{font-size:42px}.race-hero{max-width:190px}.race-lede{font-size:11px}.race-lobby-header{margin-bottom:9px}.race-track{min-height:61px;padding:5px 10px}.race-track canvas{height:43px;width:75px;flex-basis:75px}.race-setup{padding:15px}.race-track-description{min-height:0}.race-touch-button{width:57px;height:55px}.race-minimap,.race-root[data-touch=true] .race-minimap{width:100px;height:70px;bottom:calc(var(--race-bottom) + 85px)}.race-root[data-touch=true] .race-speed{bottom:calc(var(--race-bottom) + 91px)}.race-banner{top:48%;font-size:55px}.race-compact{padding:19px}.race-compact h2{font-size:28px}.race-compact>.race-button{margin-top:6px}.race-compact p{margin:6px 0}.race-results{margin:9px 0}.race-result-row{padding:5px 4px}}
@media(max-width:350px){.race-touch-button{width:54px;height:60px}.race-root .race-recover{width:44px;font-size:0;padding:5px 2px}.race-recover:after{content:"↺";font-size:23px}.race-boostbar{width:100px}.race-root[data-touch=true] .race-minimap{width:100px;height:70px}.race-hud-box{padding:9px 10px;gap:10px}.race-hud{gap:5px}.race-time{padding:10px 8px}}
.race-online-panel{margin-top:18px;padding:13px 18px;border:1px solid #38536b;border-radius:16px;background:#10263be8}.race-online-panel>summary{cursor:pointer;min-height:44px;padding:10px 0;font-weight:750;color:#d6efbf}.race-online-entry{display:grid;gap:10px}.race-online-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.race-room-input{width:100%;min-height:46px;border:1px solid #547183;border-radius:10px;background:#071c2e;color:#e1f5ff;font:inherit;padding:10px;user-select:text;touch-action:auto}.race-room-members{padding-left:20px;color:#c7e2ef;font-size:12px}.race-room-code{font-size:18px;letter-spacing:.08em}.race-watch-tools{position:absolute;bottom:calc(var(--race-bottom) + 18px);left:50%;transform:translateX(-50%);z-index:4;background:#10263be8;border:1px solid #38536b;border-radius:12px;display:flex;align-items:center;gap:8px;max-width:95%;font-size:10px}.race-watch-tools>.race-button{width:44px;min-width:44px;height:44px;padding:8px;flex:0 0 44px}.race-watch-tools>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.race-root button:disabled{opacity:.5;cursor:default}.race-root[data-online=true] .race-hint{display:none}
.race-audio-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.race-audio-volume{display:flex;gap:8px;align-items:center;font-size:11px;color:#a9bed0}.race-audio-volume input{max-width:140px;min-height:44px;touch-action:pan-x}.race-compact .race-audio-controls{border-top:1px solid #294054;padding-top:12px}
@media(prefers-reduced-motion:reduce){.race-root *{transition:none!important}}
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
      banner,
      warning,
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
      renderDt = 1 / 60;
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
      setText(
        launch,
        online
          ? host
            ? "Start together"
            : "Waiting for host…"
          : "Launch race",
      );
      for (const b of roomButtons) setDisabled(b, busy);
      setDisabled(roomInput, busy);
      for (const id of ["raceRestart", "raceRematch", "raceNext"])
        setDisabled(rootEl.querySelector("#" + id), online && !host);
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
        );
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
                  (r.spectator ? " · WATCHING" : " · RACER"),
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
        if (status.connection || status.stale) {
          keys.clear();
          resetTouch();
          pad = { steer: 0, boost: false, brake: false, recover: false };
          padNeutral = true;
        }
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
      state = next;
      networkEpoch = snapshot.epoch;
      if (newRound) {
        cosmeticRound++;
        previousPose = null;
        perspective?.reset();
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
      roomEntry.append(host, roomInput, joins);
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
      roomBox.append(roomCode, roomMembers, roomInvite, sharing);
      roomHint = el("p", "race-local-note");
      roomHint.id = "raceRoomHint";
      roomHint.setAttribute("role", "status");
      roomLeave = button("Leave race room", "race-text", leaveRaceRoom);
      roomLeave.id = "raceRoomLeave";
      roomLeave.hidden = true;
      roomDetails.append(roomEntry, roomBox, roomHint, roomLeave);
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
    function actionFor(e) {
      const key = (e.key || "").toLowerCase();
      for (const a of ["left", "right"])
        if (prefs.keys && prefs.keys[a] === key) return a;
      return {
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
        if (isRunning()) pause();
        else focusStep(e.shiftKey ? -1 : 1);
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
      if (e.code === "KeyC" && !e.repeat && !actionFor(e)) {
        e.preventDefault();
        perspective?.cycle();
        return;
      }
      const a = actionFor(e);
      if (a) {
        e.preventDefault();
        if (e.repeat && !keys.has(e.code)) return;
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
          (p) => p && p.connected && p.mapping === "standard",
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
      } else
        pad = {
          steer,
          boost: raw.boost,
          brake: raw.brake,
          recover: raw.recover,
        };
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
        "Star Circuit. Auto acceleration. Left and right to steer, Down to brake; brake while turning to drift, release the brake after a corner for boost. Space to boost, R to recover, Escape to pause.",
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
          "← → STEER · ↓ + TURN DRIFT · RELEASE ↓ FOR BOOST",
        ),
      );
      minimap = el("canvas", "race-minimap");
      minimap.width = 340;
      minimap.height = 240;
      mg = minimap.getContext("2d");
      rootEl.append(minimap);
      banner = el("div", "race-banner");
      warning = el("div", "race-warning");
      rootEl.append(banner, warning);
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
          "Auto-drive is on. Steer with A/D or ←/→. Hold S/↓ while turning to drift. Hold a full turn for at least 0.4 seconds, then release Brake for an exit boost. Brake alone slows down. Space/Shift boosts; R rescues you to the last checkpoint with a 1.5-second stop. Escape pauses. Touch: steering on the left; hold Brake + a turn to drift, then release Brake. Boost is on the right. Controller: stick/D-pad, B/L2 brake/drift, A/R2 boost, X rescue, Menu pause. Friend-room handling follows the host build; everyone should refresh for drift rewards.",
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
        button("Race again", "race-primary", start),
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
      g.strokeStyle = c.edge + "55";
      g.lineWidth = c.width + 190;
      g.stroke();
      path();
      g.strokeStyle = "#13202b";
      g.lineWidth = c.width + 176;
      g.stroke();
      path();
      g.strokeStyle = "#0005";
      g.lineWidth = c.width + 32;
      g.stroke();
      path();
      g.strokeStyle = c.edge;
      g.lineWidth = c.width + 13;
      g.stroke();
      path();
      g.strokeStyle = "#111e32";
      g.lineWidth = c.width + 6;
      g.stroke();
      path();
      g.strokeStyle = c.road;
      g.lineWidth = c.width;
      g.stroke();
      path();
      g.strokeStyle = "#c9eeff21";
      g.lineWidth = 2;
      g.setLineDash([19, 26]);
      g.stroke();
      g.setLineDash([]);
      for (let d = 0; d < c.length; d += 75) {
        const p = R.at(c, d);
        g.fillStyle = c.edge;
        for (const side of [-1, 1]) {
          g.save();
          g.translate(
            p.x - p.ty * c.width * 0.49 * side,
            p.y + p.tx * c.width * 0.49 * side,
          );
          g.rotate(Math.atan2(p.ty, p.tx));
          g.fillRect(-14, -3, 28, 6);
          g.restore();
        }
      }
      for (const fraction of c.pads) {
        const p = R.at(c, fraction * c.length);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(Math.atan2(p.ty, p.tx));
        g.fillStyle = c.accent + "22";
        round(g, -30, -c.width * 0.34, 60, c.width * 0.68, 7);
        g.fill();
        g.strokeStyle = c.accent;
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
    function kart(ctx, a, scale = 1, hero = false) {
      const appearance = a.appearance || ((hero || a.id === ownActor()?.id) && typeof opts.appearance === 'function' ? opts.appearance() : null);
      const style = root.SpaceManArt.characterStyle(appearance, a.color);
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.heading); ctx.scale(scale, scale);
      const slip = a.speed > 3 ? Math.atan2(Math.sin(a.heading - Math.atan2(a.vy, a.vx)), Math.cos(a.heading - Math.atan2(a.vy, a.vx))) : 0;
      if (!a.offroad && Math.abs(slip) > .18 && !a.recoveryTicks) {
        ctx.strokeStyle = "#89eaff"; ctx.lineWidth = 2.5;
        for (const side of [-20, 20]) {
          ctx.beginPath(); ctx.moveTo(-13, side); ctx.lineTo(-38, side + slip * 35); ctx.stroke();
        }
      }
      root.SpaceManArt.hoverpod(ctx, style, { tick: state?.tick || 20, id: a.id, calm: calm(), boosting: !!(a.boosting || a.padTicks > 0), hero });
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
        const focused = followActor();
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
    function paint() {
      if (!active || !g) return;
      const c = R.course(state?.trackId || selected.trackId);
      const a = state ? followActor() : null;
      const rendered3d =
        a &&
        perspective?.render(R.snapshot(state), {
          actorId: a.id,
          localActorId: ownActor()?.id || null,
          previous: onlineActive() ? null : previousPose,
          network: onlineActive(),
          paused: onlineActive() ? roomPaused : paused,
          alpha: paused || state.phase === "finished" ? 1 : acc * 60,
          dt: renderDt,
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
        return;
      }
      speed.parentNode.hidden = false;
      const zoom = clamp(Math.min(width / 820, height / 600), 0.65, 1.2);
      // Keep the fallback camera warm while WebGL is active, so switching view
      // or losing the graphics context never flies back from an old position.
      const viewHeading = root.SpaceManRaceCamera?.travelHeading(a) ?? a.heading;
      const desiredX = a.x + Math.cos(viewHeading) * 105,
        desiredY = a.y + Math.sin(viewHeading) * 105;
      camera.x += (desiredX - camera.x) * 0.12;
      camera.y += (desiredY - camera.y) * 0.12;
      // Portrait gets a forward-facing chase view: the useful road extends
      // into the tall screen instead of spending most of its area on empty sky.
      // Reduced-motion players keep the fixed-heading overview.
      const followHeading = height > width && !calm();
      const targetRotation = followHeading ? -viewHeading - Math.PI / 2 : 0;
      camera.rotation +=
        Math.atan2(
          Math.sin(targetRotation - camera.rotation),
          Math.cos(targetRotation - camera.rotation),
        ) * 0.1;
      if (!rendered3d) {
        g.save();
        g.translate(width / 2, height * 0.48);
        g.scale(zoom, zoom);
        g.rotate(camera.rotation);
        g.translate(-camera.x, -camera.y);
        road(g, c);
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
        for (const actor of state.actors) {
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
            y: height * 0.48 + (dx * sin + dy * cos) * zoom };
        };
        const focus = project(a), own = a.id === ownActor()?.id;
        const label = own ? "YOU" : "WATCHING";
        g.font = "900 12px system-ui";
        const labelWidth = g.measureText(label).width + 22;
        const focusX = clamp(focus.x, labelWidth / 2 + 6, width - labelWidth / 2 - 6);
        const focusY = clamp(focus.y - 38 * zoom, topClip + 27, Math.max(topClip + 27, bottomClip - 8));
        const focusBox = { left: focusX - labelWidth / 2, right: focusX + labelWidth / 2,
          top: focusY - 27, bottom: focusY + 8 };
        const labels = [focusBox];
        g.font = "700 10px system-ui";
        g.textAlign = "center";
        for (const actor of state.actors) {
          if (actor.id === a.id) continue;
          const p = project(actor), x = p.x, y = p.y - 30;
          const name = actor.name, w = g.measureText(name).width + 10;
          const box = { left: x - w / 2, right: x + w / 2, top: y - 12, bottom: y + 5 };
          if (box.left < 5 || box.right > width - 5 || box.top < topClip || box.bottom > bottomClip ||
            labels.some(b => box.left < b.right + 6 && box.right > b.left - 6 && box.top < b.bottom + 5 && box.bottom > b.top - 5)) continue;
          labels.push(box);
          g.fillStyle = "#071626dd";
          round(g, box.left, box.top, w, 18, 6); g.fill();
          g.fillStyle = "#cfdfeb";
          g.fillText(name, x, y + 1);
        }
        // The double outline stays legible on bright track markings and dark sky.
        g.beginPath();
        g.ellipse(focus.x, focus.y, 36 * zoom, 29 * zoom, camera.rotation + a.heading, 0, TAU);
        g.strokeStyle = "#091727"; g.lineWidth = 6; g.stroke();
        g.strokeStyle = "#FFF3CE"; g.lineWidth = 2.5; g.stroke();
        g.fillStyle = "#FFF3CE"; g.strokeStyle = "#07111F"; g.lineWidth = 4;
        round(g, focusBox.left, focusBox.top, labelWidth, 26, 9); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(focusX - 5, focusY - 1); g.lineTo(focusX, focusY + 6); g.lineTo(focusX + 5, focusY - 1); g.closePath();
        g.fillStyle = "#FFF3CE"; g.fill();
        g.font = "900 12px system-ui"; g.fillStyle = "#101B29";
        g.fillText(label, focusX, focusY - 9);
      }
      updateIdentity(a);
      drawMap(mg, c, 340, 240, state.actors);
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
      driveFeedback.hidden = state.phase !== "racing" || a.recoveryTicks > 0 ||
        (!a.boosting && !a.padTicks && !sliding);
      driveFeedback.dataset.kind = a.boosting || a.padTicks ? "boost" : "drift";
      setText(driveFeedback, a.boosting || a.padTicks ? "BOOST!" : "DRIFT");
      banner.hidden = state.phase !== "countdown";
      if (!banner.hidden) {
        banner.replaceChildren(
          document.createTextNode(String(Math.ceil(state.countdown / 60))),
          el("small", "", "BRAKE + TURN = DRIFT"),
        );
      }
      warning.hidden =
        !a.offroad &&
        !a.recoveryTicks &&
        !(
          onlineActive() &&
          (roomStatus?.connection ||
            roomStatus?.stale ||
            a.finishTick !== null ||
            a.forfeited)
        );
      warning.textContent =
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
                  : "";
    }
    function tick(now) {
      frameId = 0;
      if (!active || document.hidden) return;
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
      paint();
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
  root.SpaceManRaceUI = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);
