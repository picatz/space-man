// The production UI/physics with a deterministic crowded starting arrangement.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),engine=process.env.SPACE_MAN_IDENTITY_BROWSER==='webkit'?webkit:chromium;
async function launch(t,viewport){
 const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=path.resolve(ROOT,'.'+decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));if(!p.startsWith(ROOT+path.sep))return res.writeHead(400).end();res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(p)]||'application/octet-stream'}).end(await fs.readFile(p));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});browser=await engine.launch();
 const context=await browser.newContext({viewport,isMobile:viewport.width<600,hasTouch:viewport.width<900,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));await page.goto(process.env.SPACE_MAN_BASE_URL||`http://127.0.0.1:${server.address().port}/`);await page.locator('#btnArena').waitFor();await page.evaluate(()=>{settings.muted=true;settings.reduceMotion=true;Object.assign(G.cosmetics,{suit:'mint',hat:'antenna',eyes:'happy',helmet:'bubble',detail:'stripe'});});return page;
}
async function capture(page,name){const dir=process.env.SPACE_MAN_IDENTITY_SCREENSHOTS;if(dir){await fs.mkdir(dir,{recursive:true});await page.screenshot({path:path.join(dir,name+'.png')});}}
for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]])test(`identity arena matching suits, crowded team and boss ${width}x${height}`,{timeout:35000},async t=>{
 const page=await launch(t,{width,height});
 // Preserve the real simulation: only the opening arrangement/outfits are authored.
 await page.evaluate(()=>{
  const A=SpaceManArena;SpaceManArena={...A,create(o){const s=A.create(o);s.actors.forEach((a,i)=>{a.appearance={...G.cosmetics};if(!s.encounter)Object.assign(a,{x:425+i*13,px:425+i*13,y:390,py:390,invulnerable:0});});window.identityArenaState=s;return s;}};
  const layout=SpaceManArt.identityLayout;
  SpaceManArt.identityLayout=(items,bounds,bodies)=>{
   const labels=layout(items,bounds,bodies),hud=document.querySelector('.arena-hud').getBoundingClientRect(),root=document.querySelector('#arenaRoot').getBoundingClientRect();
   window.identityLayoutFrame={items,bounds,bodies,labels,hudBottom:hud.bottom-root.top};
   if(window.identityCheckNearHud&&items.some(b=>b.primary&&b.y<=bounds.top)) window.identityNearHudFrame=window.identityLayoutFrame;
   return labels;
  };
 });
 await page.locator('#btnArena').click();await page.locator('[data-format="teams"]').click();await page.locator('#arenaStart').click();
 await page.waitForFunction(()=>document.querySelector('#arenaRoot').dataset.identity?.includes('YOU:1'));
 assert.equal(await page.locator('.arena-player-card[data-you="true"]').count(),1);assert.equal(await page.locator('.arena-you-badge').count(),0);assert.ok((await page.locator('.arena-player-card[data-you="true"]').innerText()).includes('YOU ·'));
 assert.ok((await page.locator('.arena-player-card').nth(1).innerText()).includes('ALLY'));
 assert.ok((await page.locator('.arena-player-card').nth(2).innerText()).includes('RIVAL'));
 const layout=await page.locator('.arena-player-card[data-you="true"]').evaluate(e=>({r:e.getBoundingClientRect().toJSON(),bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderTopColor}));assert.ok(layout.r.right<=width&&layout.r.left>=0);assert.equal(layout.border,'rgb(234, 247, 255)');assert.equal(await page.locator('.arena-player-card[data-you="true"] .arena-player-portrait').isVisible(),true);
 await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing'&&document.querySelector('.arena-countdown').hidden,undefined,{timeout:6000});
 await page.evaluate(()=>{identityArenaState.actors.forEach((a,i)=>Object.assign(a,{x:425+i*13,px:425+i*13,y:390,py:390,vx:0,vy:0,invulnerable:0}));});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await capture(page,`identity-crowded-teams-${width}`);
 await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing');await page.keyboard.press('Space');await page.waitForTimeout(100);await capture(page,`identity-airborne-teams-${width}`);await page.keyboard.press('Escape');await page.locator('#arenaExit').click();
 await page.evaluate(()=>{arenaUI.openSession({encounter:'boss',crewCount:4,wingmate:true,arenaId:'dock',format:'teams',seed:12345},()=>{});});
 await page.waitForFunction(()=>arenaUI.snapshot()?.actors.length===5&&document.querySelector('#arenaRoot').dataset.identity?.includes('YOU:1'));
 assert.equal(await page.locator('.arena-player-card[data-you="true"]').count(),1);assert.equal(await page.locator('.arena-player-card[data-boss="true"]').count(),1);
 await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing'&&document.querySelector('.arena-countdown').hidden,undefined,{timeout:6000});
 await page.evaluate(()=>{identityArenaState.actors.forEach((a,i)=>Object.assign(a,{x:425+i*13,px:425+i*13,y:390,py:390,vx:0,vy:0,invulnerable:0}));});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await capture(page,`identity-crowded-boss-${width}`);
 await capture(page,`identity-live-boss-${width}`);
 // Author an airborne position near the top HUD, then let real physics and
 // camera interpolation render it. Record the frame even on a fast display.
 await page.evaluate(async()=>{
  window.identityCheckNearHud=true;window.identityNearHudFrame=null;
  // The portrait camera follows an airborne pilot; converge using each real
  // rendered frame rather than assuming a single teleport leaves it still.
  for(let i=0;i<8&&!window.identityNearHudFrame;i++) {
   const frame=window.identityLayoutFrame,actor=window.identityArenaState.actors.find(a=>a.controller==='human'),body=frame.bodies.find(b=>b.id===actor.id);
   if(!body)throw new Error('near-HUD fixture requires a visible living pilot');
   const scale=(body.h-8)/actor.h,dy=(frame.bounds.top+15-(body.y+8))/scale;
   actor.y+=dy;actor.py=actor.y;actor.vy=0;actor.onGround=false;actor.invulnerable=60;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  }
 });
 await page.waitForFunction(()=>!!window.identityNearHudFrame,undefined,{timeout:3000});
 const airborne=await page.evaluate(()=>window.identityNearHudFrame),pilot=airborne.labels.find(b=>b.primary);
 assert.ok(pilot,'airborne pilot keeps its identity cue');
 const ownBody=airborne.bodies.find(b=>b.id===pilot.id);
 assert.ok(pilot.x+pilot.w<=ownBody.x||pilot.x>=ownBody.x+ownBody.w||pilot.y+pilot.h<=ownBody.y||pilot.y>=ownBody.y+ownBody.h,'HUD-clamped marker must not cover its own pilot');
 assert.ok(pilot.y-2>=airborne.hudBottom+4,'cue including its keyline clears the measured boss HUD');
 assert.ok(pilot.y<=airborne.bounds.top+1,'fixture exercises a badge clamped at the top boundary');
 await capture(page,`identity-airborne-boss-${width}`);
});

// Ordinary phone play must improve too, not only the authored pile-up fixture.
test('identity phone duel: real inputs and quiet avatar-led ownership', {timeout:25000}, async t=>{
 const page=await launch(t,{width:390,height:844});
 await page.evaluate(()=>{Object.assign(G.cosmetics,{suit:'classic',hat:'none',eyes:'classic',helmet:'round'});});
 await page.locator('#btnArena').click();await page.locator('[data-arena="bloom-reactor"]').click();await page.locator('#arenaStart').click();
 await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing'&&document.querySelector('.arena-countdown').hidden);
 const own=await page.evaluate(()=>arenaUI.snapshot().actors.find(a=>a.controller==='human').id);
 await page.waitForFunction(id=>document.querySelector('#arenaRoot').dataset.identity?.includes('YOU:'+id),own);
 await capture(page,'identity-phone-duel-bloom');
 await page.locator('.arena-touch-jump').tap();
 await page.waitForFunction(id=>arenaUI.snapshot().actors.find(a=>a.id===id).vy<0,own);
 await page.locator('.arena-touch-attack').tap();
 await page.locator('.arena-touch-dash').tap();
 await page.locator('.arena-pause-button').click();await page.locator('#arenaResume').click();
 await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing');
 assert.equal(await page.locator('.arena-you-badge').count(),0);
 assert.ok((await page.locator('.arena-player-card[data-you="true"]').innerText()).includes('YOUR PILOT'));
});
