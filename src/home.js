/* Home-only illustration. Uses the same equipped art as every playable mode.
   Painted only when returning home, with no timer, sockets or save writes. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  function ellipse(c,x,y,rx,ry,fill) { c.fillStyle=fill;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill(); }
  function line(c,points,color,width) { c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke(); }
  function star(c,x,y,size,color) { c.fillStyle=color;c.beginPath();c.moveTo(x,y-size);c.quadraticCurveTo(x+size*.22,y-size*.22,x+size,y);c.quadraticCurveTo(x+size*.22,y+size*.22,x,y+size);c.quadraticCurveTo(x-size*.22,y+size*.22,x-size,y);c.quadraticCurveTo(x-size*.22,y-size*.22,x,y-size);c.fill(); }
  function surface(id,w,h) { const canvas=root.document.getElementById(id);if(!canvas)return null;const dpr=Math.min(root.devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');if(!c)return null;c.scale(dpr,dpr);c.clearRect(0,0,w,h);return c; }
  // The hero is two layers: a still backdrop (orbits, planets, platform) and the
  // living actors on top. render() paints both once; animate() repaints only the
  // actors over a cached copy of the backdrop.
  function backdrop(c) {
    // A tiny landing moon, soft atmospheric rings and distant destinations.
    c.save();c.translate(320,218);c.rotate(-.18);c.strokeStyle='#7dcde429';c.lineWidth=1.5;c.beginPath();c.ellipse(0,0,247,104,0,0,TAU);c.stroke();c.strokeStyle='#c2eef118';c.beginPath();c.ellipse(0,0,270,129,0,0,TAU);c.stroke();c.restore();
    // The ring is one orbit: its far half passes behind the planet, its near half in front.
    const ring=(from,to)=>{c.save();c.translate(489,104);c.rotate(-.4);c.strokeStyle='#85c7cb77';c.lineWidth=5;c.lineCap='butt';c.beginPath();c.ellipse(0,0,65,17,0,from,to);c.stroke();c.restore();};
    ring(Math.PI,TAU);
    ellipse(c,489,104,43,43,'#25465e');ellipse(c,479,94,31,30,'#2b536b');ellipse(c,490,95,7,5,'#365f74');ellipse(c,473,117,9,5,'#24465e');
    ring(0,Math.PI);
    ellipse(c,136,204,21,21,'#87644f');ellipse(c,130,196,13,12,'#b58d60');
    [[106,139],[210,60],[553,171],[448,42],[383,292],[118,271],[546,69],[239,159]].forEach(([x,y],i)=>ellipse(c,x,y,i%3===0?2:1.3,i%3===0?2:1.3,'#b6d9e377'));
    ellipse(c,320,323,135,29,'#081727');ellipse(c,320,310,115,28,'#26455c');ellipse(c,320,306,115,20,'#3b6175');ellipse(c,320,300,109,16,'#60909c');ellipse(c,320,301,84,9,'#8fbbbc');
    line(c,[[226,310],[242,315]],'#a8efdf',3);line(c,[[399,314],[412,310]],'#a8efdf',3);
  }
  const SPARKS=[[160,92,9,'#ffda8b'],[450,221,7,'#9cf3ed'],[390,55,5,'#bbeaff'],[217,244,4,'#d6edff'],[516,262,4,'#d6edff']];
  // One playful, unambiguous non-player companion. d: {lx,ly} gaze, hop 0..1, lean -1..1, t seconds.
  function alien(c,d) {
    const t=d.t,sq=1+.035*Math.sin(t*3.1)+d.hop*.1*Math.sin(Math.min(1,d.hopT)*Math.PI),lift=-26*Math.sin(Math.min(1,d.hopT)*Math.PI)*d.hop;
    ellipse(c,414,289,14*(1-.25*Math.abs(lift)/26),4,'#182f3f');
    c.save();c.translate(415,289+lift);c.rotate(d.lean*.1);c.scale(1/sq,sq);c.translate(-415,-289);
    ellipse(c,415,272,14,18,'#7fce92');ellipse(c,417,265,12,10,'#a8e4a1');
    const px=d.lx*1.3,py=d.ly*1.2;
    ellipse(c,411,263,3.4,4.6,'#f0fcdb');ellipse(c,423,263,3.4,4.6,'#f0fcdb');ellipse(c,412+px,264+py,1.7,2.8,'#143845');ellipse(c,423+px,264+py,1.7,2.8,'#143845');
    const sway=Math.sin(t*2.2)*1.6+d.lean*2+d.hop*Math.sin(t*22)*1.2;
    c.strokeStyle='#9ce6ac';c.lineWidth=2;c.lineCap='round';c.beginPath();c.moveTo(410,248);c.quadraticCurveTo(409+sway*.4,245,408+sway,242-d.hop*2);c.stroke();
    ellipse(c,408+sway,241-d.hop*2,3,3,'#c8f5b4');
    c.restore();
  }
  function actors(c,appearance,d) {
    const t=d?d.t:0;
    SPARKS.forEach(([x,y,r,col],i)=>{const k=d?.82+.18*Math.sin(t*2.4+i*1.7):1;star(c,x,y,r*k,col);});
    root.SpaceManArt.drawAvatar(c,320,176,260,appearance,d?{time:t,reduceMotion:false,greeting:d.wave,lookX:d.alx,lookY:d.aly,mood:d.mood}:{reduceMotion:true});
    alien(c,d||{t:0,lx:0,ly:0,hop:0,hopT:0,lean:0});
  }
  function hero(c,appearance) { backdrop(c);actors(c,appearance,null); }
  function tile(c,mode,appearance) {
    star(c,207,27,3,'#ceebe966');star(c,47,22,2,'#ceebe966');
    if(mode==='run') {
      ellipse(c,214,99,44,55,'#b97c4944');ellipse(c,225,105,33,42,'#ffc87444');
      line(c,[[14,115],[82,115]],'#23434f',17);line(c,[[14,109],[82,109]],'#78d5d2',5);
      line(c,[[130,135],[250,135]],'#23434f',20);line(c,[[130,126],[250,126]],'#b2d3a0',5);
      root.SpaceManArt.drawAvatar(c,112,62,92,appearance,{reduceMotion:true});star(c,174,67,7,'#ffd887');
    } else if(mode==='arena') {
      ellipse(c,131,108,105,23,'#193847');ellipse(c,131,101,105,17,'#6ca4a8');ellipse(c,131,99,91,9,'#376979');
      root.SpaceManArt.drawAvatar(c,92,62,84,appearance,{reduceMotion:true});
      root.SpaceManArt.drawAvatar(c,179,66,72,{...appearance,suit:'rose',hat:'none',eyes:'determined'},{reduceMotion:true});star(c,140,65,13,'#ffcc80');
    } else {
      c.strokeStyle='#94cab444';c.lineWidth=31;c.beginPath();c.ellipse(127,102,110,50,-.2,0,TAU);c.stroke();
      c.strokeStyle='#add5b455';c.lineWidth=2;c.beginPath();c.ellipse(127,102,110,50,-.2,0,TAU);c.stroke();
      line(c,[[18,108],[50,108]],'#ffcf7c',4);line(c,[[25,119],[54,119]],'#ffcf7c88',3);
      root.SpaceManArt.drawAvatar(c,132,59,165,appearance,{reduceMotion:true,ship:true});
    }
  }
  // Pure helpers for the launcher's hero CTA and Daily card.
  const MODES={run:'Endless Run',arena:'Orbital Arena',race:'Star Circuit'};
  function heroLabel(mode,best) {
    const m=MODES[mode]?mode:'run',b=Math.max(0,best|0);
    return 'Play \u00b7 '+MODES[m]+(m==='run'&&b>0?' \u00b7 best '+b.toLocaleString('en-US'):'');
  }
  function resetsIn(nowMs) {
    const d=new Date(nowMs),next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1),mins=Math.max(1,Math.ceil((next-nowMs)/60000));
    return mins>=60?'resets in '+Math.floor(mins/60)+'h':'resets in '+mins+'m';
  }
  const api={MODES,heroLabel,resetsIn};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  // --- Living hero -----------------------------------------------------------
  // A slow choreography (idle, a glance at a star, a look down at the alien who
  // looks back up, a wave) that any pointer or tap interrupts. Gaze and body
  // ease toward targets, so nothing ever snaps. Motion stops entirely for
  // reduced motion, battery saver and a hidden home.
  const GAZE_AT_ALIEN={x:.95,y:.9},HEAD={x:320,y:132};
  let live=null;
  function calm() {
    const b=root.document?.body?.classList;
    return !!(b&&(b.contains('reduce-motion')||b.contains('battery-saver')))||!!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
  function choreo(t) {
    // 14 s loop. Returns the astronaut's gaze target, mood and wave, and the alien's gaze, hop and lean.
    const k=t%14;
    if(k<3)return {gx:0,gy:0,mood:0,wave:0,alienUp:0,hopAt:-1};
    if(k<4.6)return {gx:-.8,gy:-.7,mood:0,wave:0,alienUp:0,hopAt:-1};      // a glance at the gold star
    if(k<6.4)return {gx:0,gy:0,mood:0,wave:0,alienUp:0,hopAt:-1};
    if(k<10)return {gx:GAZE_AT_ALIEN.x,gy:GAZE_AT_ALIEN.y,mood:1,wave:0,alienUp:k>7?1:0,hopAt:7.4}; // looks down; the alien looks up and hops
    if(k<11.8)return {gx:.3,gy:0,mood:1,wave:k>10.2?1:0,alienUp:1,hopAt:-1};                         // a little wave
    return {gx:0,gy:0,mood:0,wave:0,alienUp:0,hopAt:-1};
  }
  function startLiving() {
    if(live||!root.requestAnimationFrame)return;
    const doc=root.document,canvas=doc?.getElementById('homeHero');
    if(!canvas||calm()||!root.SpaceManArt?.drawAvatar)return;
    const home=doc.getElementById('ovAttract'),dpr=Math.min(root.devicePixelRatio||1,2);
    const back=doc.createElement('canvas');back.width=640*dpr;back.height=400*dpr;
    const bc=back.getContext('2d');if(!bc)return;bc.scale(dpr,dpr);backdrop(bc);
    const c=canvas.getContext('2d');if(!c)return;
    const st={t:0,last:0,gx:0,gy:0,wave:0,alx:0,aly:0,lx:0,ly:0,mood:0,lean:0,hop:0,hopT:2,lastHop:-99,pointer:null,pointerAt:-99,poke:null,pokeAt:-99,hopSeen:-1};
    const ease=(v,to,dt,rate)=>v+(to-v)*(1-Math.exp(-rate*dt));
    const clampv=v=>Math.max(-1,Math.min(1,v));
    const toCanvas=e=>{const r=canvas.getBoundingClientRect();return r.width?{x:(e.clientX-r.left)/r.width*640,y:(e.clientY-r.top)/r.height*400}:null;};
    const onMove=e=>{if(e.pointerType==='touch')return;const p=toCanvas(e);if(p){st.pointer=p;st.pointerAt=st.t;}};
    const onDown=e=>{
      const p=toCanvas(e);if(!p||p.x<0||p.y<0||p.x>640||p.y>400)return;
      const onAlien=Math.hypot(p.x-415,p.y-270)<44;
      st.pointer=p;st.pointerAt=st.t;st.poke=onAlien?'alien':'wave';st.pokeAt=st.t;
      if(onAlien){st.hopT=0;st.hop=1;}
    };
    let rafId=0,watch=null;
    const stop=()=>{live=null;if(rafId&&root.cancelAnimationFrame)root.cancelAnimationFrame(rafId);rafId=0;if(watch)watch.disconnect();doc.removeEventListener('pointermove',onMove);doc.removeEventListener('pointerdown',onDown);c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,640,400);c.drawImage(back,0,0,640,400);actors(c,appearance(),null);};
    doc.addEventListener('pointermove',onMove,{passive:true});doc.addEventListener('pointerdown',onDown,{passive:true});
    const frame=now=>{
      if(!live)return;
      if(!home?.classList.contains('show')||home.closest('[inert]')||doc.hidden||calm()){stop();return;}
      rafId=root.requestAnimationFrame(frame);
      if(now-st.last<33)return;
      const dt=Math.min(.1,st.last?(now-st.last)/1000:.033);st.last=now;st.t+=dt;
      const ch=choreo(st.t),near=st.t-st.pointerAt<2.6&&st.pointer,poked=st.t-st.pokeAt<1.6;
      let gx=ch.gx,gy=ch.gy,mood=ch.mood,wave=ch.wave,alienUp=ch.alienUp;
      if(near){gx=clampv((st.pointer.x-HEAD.x)/240);gy=clampv((st.pointer.y-HEAD.y)/170);mood=0;alienUp=Math.hypot(st.pointer.x-415,st.pointer.y-270)<120?1:0;}
      if(poked){if(st.poke==='alien'){gx=GAZE_AT_ALIEN.x;gy=GAZE_AT_ALIEN.y;mood=1;alienUp=1;}else{wave=1;mood=1;}}
      // The alien's hop is triggered by the choreography once per loop.
      const loopK=st.t%14;if(ch.hopAt>0&&loopK>=ch.hopAt&&st.hopSeen!==Math.floor(st.t/14)){st.hopSeen=Math.floor(st.t/14);st.hopT=0;st.hop=.7;}
      st.hopT+=dt*2.4;
      st.gx=ease(st.gx,gx,dt,7);st.gy=ease(st.gy,gy,dt,7);st.wave=ease(st.wave,wave,dt,wave?9:5);st.mood=mood;
      st.lean=ease(st.lean,alienUp?-1:0,dt,5);
      // The alien looks up toward the astronaut (up-left) or at the pointer.
      const tx=alienUp?(near?clampv((st.pointer.x-415)/200):-.7):.2*Math.sin(st.t*.9),ty=alienUp?(near?clampv((st.pointer.y-266)/150):-1):0;
      st.lx=ease(st.lx,tx,dt,8);st.ly=ease(st.ly,ty,dt,8);
      c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,640,400);c.drawImage(back,0,0,640,400);
      actors(c,appearance(),{t:st.t,alx:st.gx,aly:st.gy,wave:st.wave,mood:st.mood,lx:st.lx,ly:st.ly,lean:st.lean,hop:st.hop,hopT:st.hopT});
    };
    // Leaving the home screen cancels the pending frame at once instead of one tick later.
    if(home&&root.MutationObserver){watch=new root.MutationObserver(()=>{if(live&&!home.classList.contains('show'))stop();});watch.observe(home,{attributes:true,attributeFilter:['class']});}
    live=st;rafId=root.requestAnimationFrame(frame);
  }
  let lastAppearance=null;
  const appearance=()=>lastAppearance;

  // Fit the whole home into one viewport when its natural height is a little
  // too tall (browser zoom, big text, short windows). Zoom scales layout, not
  // just paint; the floor keeps captions legible and leaves the shell
  // scrollable below it.
  const FIT_FLOOR=.8;let fitQueued=false;
  function fit() {
    fitQueued=false;
    const doc=root.document,shell=doc?.querySelector?.('.home-shell'),stage=doc?.querySelector?.('.home-stage');
    if(!shell||!stage||!root.getComputedStyle)return;
    // Phones keep their hand-tuned compact layouts; this is for desktop and tablet windows.
    if(root.innerWidth<760||root.innerHeight<560){stage.style.zoom='';stage.style.width='';stage.style.maxWidth='';return;}
    stage.style.zoom='';stage.style.width='';stage.style.maxWidth='';
    const cs=root.getComputedStyle(shell),pad=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);
    const need=stage.offsetHeight,room=shell.clientHeight-pad;
    if(!(need>0)||!(room>0)||need<=room)return;
    // Pin the unzoomed width so the grid reflows exactly as before, just smaller.
    stage.style.width=stage.offsetWidth+'px';stage.style.maxWidth='none';
    stage.style.zoom=String(Math.max(FIT_FLOOR,Math.floor(room/need*100)/100));
  }
  function queueFit() { if(fitQueued||!root.requestAnimationFrame)return;
    // A hidden home has nothing to fit; don't leave a frame pending under another mode.
    const home=root.document?.getElementById?.('ovAttract');if(home&&(!home.classList.contains('show')||home.closest('[inert]')))return;
   fitQueued=true;root.requestAnimationFrame(fit); }
  root.addEventListener?.('resize',queueFit);root.addEventListener?.('orientationchange',queueFit);
  root.document?.fonts?.ready?.then?.(queueFit);
  // The shell goes from hidden to laid out when the home is shown, and again when the game cards reflow.
  const watchShell=()=>{const shell=root.document.querySelector('.home-shell');const stage=root.document.querySelector('.home-stage');if(shell&&root.ResizeObserver){const ro=new root.ResizeObserver(queueFit);ro.observe(shell);if(stage)ro.observe(stage);}};
  if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',watchShell);else if(root.document?.querySelector)watchShell();
  root.SpaceManHome=Object.freeze({heroLabel,resetsIn,fit:queueFit,animate() { if(lastAppearance)startLiving(); },notice(text) {
    const el=root.document.getElementById('homeNotice');if(!el)return;
    if(el.textContent!==text)el.textContent=text;
    el.hidden=!text;
  },render(appearance) {
    lastAppearance=appearance;
    const c=surface('homeHero',640,400);if(c&&root.SpaceManArt?.drawAvatar)hero(c,appearance);
    [['homeRunArt','run'],['homeArenaArt','arena'],['homeRaceArt','race']].forEach(([id,mode])=>{const g=surface(id,260,156);if(g&&root.SpaceManArt?.drawAvatar)tile(g,mode,appearance);});
    queueFit();
  }});
})(typeof window!=='undefined'?window:globalThis);
