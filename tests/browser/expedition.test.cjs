// Continuous gameplay with real engines and ordinary controller commands.
// No state teleport, forced result, shortened clock, relay or score seeding.
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises');
const {chromium,webkit}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const engine=process.env.SPACE_MAN_EXPEDITION_BROWSER==='webkit'?webkit:chromium;
async function launch(t,device={}) {
  let server,browser;
  t.after(async()=>{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}});
  let base=process.env.SPACE_MAN_BASE_URL;
  if(!base){
    server=http.createServer(async(req,res)=>{try{
      const url=new URL(req.url,'http://localhost'),file=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
      if(!file.startsWith(ROOT+path.sep))return res.writeHead(400).end();
      const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream'}).end(bytes);
    }catch(_){res.writeHead(404).end();}});
    await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});base='http://127.0.0.1:'+server.address().port+'/';
  }
  browser=await engine.launch(engine===chromium&&process.env.SPACE_MAN_CHROMIUM_PATH?{executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',...device});
  await context.addInitScript(()=>{
    window.testPad={connected:true,mapping:'standard',index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad],configurable:true});
  });
  const page=await context.newPage(),errors=[],sockets=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>sockets.push(ws.url()));
  t.after(()=>{assert.deepEqual(errors,[]);assert.deepEqual(sockets,[],'solo never opens a room');});
  await page.goto(base);
  if(process.env.SPACE_MAN_EXPECTED_SHA)assert.equal(JSON.parse(await page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha,process.env.SPACE_MAN_EXPECTED_SHA);
  await page.evaluate(()=>{settings.muted=true;settings.reduceMotion=true;});
  return {page,context};
}
async function capture(page,name){
  if(!process.env.SPACE_MAN_EXPEDITION_SCREENSHOTS)return;
  await fs.mkdir(process.env.SPACE_MAN_EXPEDITION_SCREENSHOTS,{recursive:true});
  await page.screenshot({animations:'disabled',path:path.join(process.env.SPACE_MAN_EXPEDITION_SCREENSHOTS,name+'.png')});
}
async function stop(page) {
  await page.evaluate(()=>{clearInterval(window.driver);testPad.axes=[0,0];testPad.buttons.forEach(b=>b.pressed=false);});
  await page.waitForFunction(()=>{
    const id=expedition.snapshot().current.id;
    return id==='runner'?!G.player.dead:id==='arena'?arenaUI.snapshot().phase!=='over':raceUI.snapshot().phase!=='finished';
  });
  await page.keyboard.press('Escape');
  const id=await page.evaluate(()=>expedition.snapshot().current.id);
  await page.locator(id==='runner'?'#btnQuit':id==='arena'?'#arenaExit':'#raceExit').click();
  assert.equal(await page.evaluate(()=>expedition),null);
}
async function drive(page){
  await page.evaluate(()=>{
    let token=-1,neutralUntil=0;
    window.visited=[];
    window.driver=setInterval(()=>{
      const route=expedition?.snapshot();if(!route)return;
      if(route.token!==token){token=route.token;neutralUntil=performance.now()+500;visited.push({...route.current});}
      testPad.axes=[0,0];testPad.buttons.forEach(b=>b.pressed=false);
      if(performance.now()<neutralUntil)return;
      if(route.current.id==='runner'){testPad.axes[0]=1;return;} // Real fall/rescue or rendezvous.
      if(route.current.id==='arena'){
        const s=arenaUI.snapshot();if(!s||s.phase!=='playing')return;
        const actor=s.actors.find(a=>a.controller==='human'),target=s.actors.find(a=>a.id!==actor.id&&a.stocks>0&&(s.format!=='teams'||a.team!==actor.team));
        if(!target)return;
        const dx=target.x-actor.x;testPad.axes[0]=Math.abs(dx)>32?Math.sign(dx)*.65:0;
        testPad.buttons[0].pressed=s.tick%70<9&&(target.y<actor.y-35||!actor.onGround||target.boss?.phase==='charging');
        testPad.buttons[2].pressed=s.tick%24<6;testPad.buttons[1].pressed=target.boss?.phase==='charging'&&s.tick%45<4;
      }else{
        const s=raceUI.snapshot();if(!s||s.phase!=='racing')return;
        const c=SpaceManRace.cpuInput(s,s.actors[0]);testPad.axes[0]=c.steer;testPad.buttons[0].pressed=c.boost;testPad.buttons[1].pressed=c.brake;
      }
    },16);
  });
}
test('two complete sectors flow through genuine plays, boss encounters and onward without a continue prompt',{timeout:540000},async t=>{
  const {page}=await launch(t);
  await page.locator('#btnExpedition').click();
  await page.waitForFunction(()=>expedition?.snapshot().phase==='playing');
  await capture(page,'continuous-launch');
  assert.equal(await page.locator('#btnExpeditionContinue').count(),0);
  await drive(page);
  for(let n=1;n<=10;n++){
    await page.waitForFunction(n=>expedition?.snapshot().completed>=n,n,{timeout:110000});
    const s=await page.evaluate(()=>expedition.snapshot());
    assert.equal(s.phase,'playing');
    assert.equal(await page.locator('.arena-result-panel:visible,.race-results:visible').count(),0);
    if(n===4||n===5||n===9||n===10)await capture(page,'continuous-route-'+n);
  }
  const visited=await page.evaluate(()=>visited),result=await page.evaluate(()=>expedition.snapshot());
  assert.ok(result.completed>=10);assert.ok(visited.filter(x=>x.kind==='boss').length>=2);
  assert.deepEqual([...new Set(visited.map(x=>x.id))].sort(),['arena','race','runner']);
  assert.ok(result.records.some(x=>x.id==='race'&&x.finished),'a real finish line was crossed');
  for(let i=1;i<visited.length;i++)assert.notEqual(visited[i].id,visited[i-1].id);
  await stop(page);
  await page.locator('#btnRace').click();await page.locator('.race-launch').click();
  assert.equal(await page.evaluate(()=>raceUI.snapshot().laps),3);
  await page.keyboard.press('Escape');await page.locator('#raceExit').click();
  await page.locator('#btnPlay').click();await page.keyboard.down('d');
  await page.waitForFunction(()=>G.mode==='play'&&G.player.vx>0);await page.keyboard.up('d');
});
for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:820,height:1180}]){
 test('touch '+viewport.width+'×'+viewport.height+': live cue, pause and immediate exit',{timeout:30000},async t=>{
   const {page}=await launch(t,{viewport,hasTouch:true,isMobile:true});
   await page.locator('#btnExpedition').tap();await page.waitForFunction(()=>expedition?.snapshot().phase==='playing');
   const box=await page.locator('#expeditionCue').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);
   assert.equal(await page.locator('#expeditionCue').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
   await capture(page,'continuous-'+viewport.width+'x'+viewport.height);
   await stop(page);assert.equal(await page.locator('#ovAttract').evaluate(el=>el.inert),false);
   await page.locator('#btnExpedition').tap();await stop(page);
 });
}
test('pause and visibility handlers in every mode; held key/pad and synthetic touch cleanup across a live transition',{timeout:420000},async t=>{
  const {page}=await launch(t);
  await page.locator('#btnRace').click();await page.locator('[data-track=ember]').click();
  await page.getByRole('button',{name:'← All games',exact:true}).click();
  const saved=await page.evaluate(()=>localStorage.getItem(BUILD.storageKey('sm2.race.v1')));
  await page.locator('#btnExpedition').click();await drive(page);
  const checked=new Set();
  while(checked.size<3){
    const mode=await page.evaluate(()=>expedition.snapshot().current.id);
    if(checked.has(mode)){await page.waitForFunction(mode=>expedition.snapshot().current.id!==mode,mode,{timeout:110000});continue;}
    await page.evaluate(()=>{clearInterval(driver);testPad.axes=[0,0];testPad.buttons.forEach(b=>b.pressed=false);});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>expedition.snapshot().current.id==='runner'?G.mode:expedition.snapshot().current.id==='arena'?arenaUI.screen:raceUI.screen),'pause');
    const before=await page.evaluate(()=>expedition.snapshot().current.id==='runner'?G.frameCount:expedition.snapshot().current.id==='arena'?arenaUI.snapshot().tick:raceUI.snapshot().tick);
    await page.waitForTimeout(250);
    const after=await page.evaluate(()=>expedition.snapshot().current.id==='runner'?G.frameCount:expedition.snapshot().current.id==='arena'?arenaUI.snapshot().tick:raceUI.snapshot().tick);
    if(mode!=='runner')assert.equal(after,before);
    await page.locator(mode==='runner'?'#btnResume':mode==='arena'?'#arenaResume':'#raceResume').click();
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{value:true,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(()=>expedition.snapshot().current.id==='runner'?G.mode:expedition.snapshot().current.id==='arena'?arenaUI.screen:raceUI.screen),'pause');
    const routeAtBackground=await page.evaluate(()=>expedition.snapshot().token);
    await page.waitForTimeout(200);
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{value:false,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(()=>expedition.snapshot().token),routeAtBackground);
    assert.equal(await page.evaluate(()=>expedition.snapshot().current.id==='runner'?G.mode:expedition.snapshot().current.id==='arena'?arenaUI.screen:raceUI.screen),'pause','returning does not resume automatically');
    await page.locator(mode==='runner'?'#btnResume':mode==='arena'?'#arenaResume':'#raceResume').click();
    checked.add(mode);await drive(page);
  }
  await page.waitForFunction(()=>expedition.snapshot().current.id==='runner'&&!G.player.dead,undefined,{timeout:180000});
  await page.evaluate(()=>{clearInterval(driver);testPad.axes=[0,0];testPad.buttons.forEach(b=>b.pressed=false);});
  const oldToken=await page.evaluate(()=>expedition.snapshot().token);
  // Hold key/pad plus a synthetic touch pointer through a genuine runner end.
  // Synthetic touch verifies state cleanup; native capture needs device/browser QA.
  await page.keyboard.down('d');
  await page.evaluate(()=>{testPad.axes[0]=1;});
  const box=await page.locator('#game').boundingBox();
  await page.locator('#game').dispatchEvent('pointerdown',{pointerId:91,pointerType:'touch',isPrimary:true,clientX:box.width*.2,clientY:box.height*.65,buttons:1});
  await page.locator('#game').dispatchEvent('pointermove',{pointerId:91,pointerType:'touch',isPrimary:true,clientX:box.width*.35,clientY:box.height*.65,buttons:1});
  await page.waitForFunction(token=>expedition.snapshot().token!==token,oldToken,{timeout:50000});
  await page.keyboard.down('d'); // Repeated keydown models OS repeat into the new mode.
  await page.waitForTimeout(1100);
  const neutral=await page.evaluate(()=>{
    const id=expedition.snapshot().current.id;
    if(id==='arena'){const s=arenaUI.snapshot(),a=s.actors.find(a=>a.controller==='human');return Math.abs(a.vx)<.1&&a.attackTicks===0;}
    const a=raceUI.snapshot().actors[0];return Math.abs(a.steering)<.001&&!a.boosting;
  });
  assert.equal(neutral,true,'held input cannot leak into the new control scheme');
  assert.equal(await page.evaluate(()=>input.stick.active||input.jumpHeld||input.shootBtn.pressed),false);
  await page.keyboard.up('d');
  await page.evaluate(()=>{testPad.axes=[0,0];window.dispatchEvent(new PointerEvent('pointerup',{pointerId:91,pointerType:'touch',isPrimary:true}));});
  await stop(page);
  assert.equal(await page.evaluate(()=>localStorage.getItem(BUILD.storageKey('sm2.race.v1'))),saved);
});

test('solo team elimination catches the rescue shuttle instead of waiting for CPUs',{timeout:90000},async t=>{
  const {page}=await launch(t);
  // Choose a reproducible real itinerary; engine clocks and outcomes remain untouched.
  await page.evaluate(()=>{window.originalRandom=Math.random;Math.random=()=>0;});
  await page.locator('#btnExpedition').click();
  await page.evaluate(()=>{Math.random=originalRandom;});
  await page.keyboard.down('d');
  await page.waitForFunction(()=>arenaUI?.active&&arenaUI.snapshot()?.format==='teams',undefined,{timeout:50000});
  await page.keyboard.up('d');
  await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing');
  const token=await page.evaluate(()=>expedition.snapshot().token);
  await page.keyboard.down('d');
  await page.waitForFunction(()=>{
    const s=arenaUI?.snapshot();return s&&s.actors.find(a=>a.controller==='human').stocks===0;
  },undefined,{timeout:22000});
  const left=await page.evaluate(()=>arenaUI.snapshot().timeLeftTicks);
  assert.ok(left>600,'the original team match still has substantial clock remaining');
  await page.waitForFunction(token=>expedition.snapshot().token>token,token,{timeout:2500});
  await page.keyboard.up('d');
  const record=await page.evaluate(()=>expedition.snapshot().records.find(r=>r.id==='arena'));
  assert.equal(record.won,false,'extraction does not invent a victory');
  await stop(page);
});

for (const mode of ['arena','race']) test(mode+' input yields to an inert sibling crew dialog and restores safely',{timeout:25000},async t=>{
  const {page}=await launch(t);
  await page.locator(mode==='arena'?'#btnArena':'#btnRace').click();
  await page.locator(mode==='arena'?'.arena-launch':'.race-launch').click();
  await page.keyboard.press('Escape');
  await page.evaluate(mode=>{
    const game=document.querySelector(mode==='arena'?'.arena-root':'.race-root');
    const panel=document.createElement('div');panel.id='crewDialogFixture';panel.setAttribute('role','dialog');
    panel.style.cssText='position:fixed;inset:20px;z-index:9999;background:#102030;color:white;padding:30px';
    panel.innerHTML='<input id="crewNameFixture" aria-label="Crew name"><button id="crewActionFixture">Crew action</button>';
    window.fixtureClicks=0;window.fixtureEscapes=0;
    panel.querySelector('button').onclick=()=>fixtureClicks++;
    panel.addEventListener('keydown',e=>{if(e.code==='Escape')fixtureEscapes++;});
    game.inert=true;document.body.appendChild(panel);panel.querySelector('input').focus();
  },mode);
  await page.getByLabel('Crew name').pressSequentially('Nova');
  assert.equal(await page.getByLabel('Crew name').getAttribute('id'),'crewNameFixture');
  assert.equal(await page.getByLabel('Crew name').evaluate(e=>e.value),'Nova');
  await page.getByRole('button',{name:'Crew action',exact:true}).click();
  assert.equal(await page.evaluate(()=>fixtureClicks),1,'old pointer guard must not swallow the sibling click');
  await page.getByLabel('Crew name').click();
  await page.evaluate(()=>{testPad.buttons[13].pressed=true;testPad.buttons[0].pressed=true;});
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'crewNameFixture','old gamepad menu must not steal dialog focus');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>fixtureEscapes),1);
  assert.equal(await page.evaluate(mode=>mode==='arena'?arenaUI.screen:raceUI.screen,mode),'pause');
  await page.evaluate(mode=>{
    testPad.buttons.forEach(b=>b.pressed=false);testPad.axes=[0,0];
    document.querySelector('#crewDialogFixture').remove();
    document.querySelector(mode==='arena'?'.arena-root':'.race-root').inert=false;
  },mode);
  await page.locator(mode==='arena'?'#arenaResume':'#raceResume').click();
  assert.equal(await page.evaluate(mode=>mode==='arena'?arenaUI.screen:raceUI.screen,mode),'play');
  await page.keyboard.press('Escape');await page.locator(mode==='arena'?'#arenaExit':'#raceExit').click();
});

test('an inert crew dialog cancels a queued race recovery before the next simulation tick',{timeout:25000},async t=>{
  const {page}=await launch(t,{hasTouch:true,isMobile:true});
  await page.locator('#btnRace').click();await page.locator('.race-launch').click();
  await page.waitForFunction(()=>raceUI.snapshot()?.phase==='racing');
  const before=await page.evaluate(()=>raceUI.snapshot().actors[0].recoveries);
  await page.evaluate(()=>{
    // Dispatch the normal button action and transfer dialog ownership atomically.
    document.querySelector('.race-recover').click();
    document.querySelector('.race-root').inert=true;
  });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>raceUI.snapshot().actors[0].recoveries),before);
  await page.keyboard.down('d');
  await page.evaluate(()=>{document.querySelector('.race-root').inert=false;});
  await page.keyboard.down('d'); // A held dialog key produces repeat:true after restoration.
  await page.waitForTimeout(120);
  assert.ok(Math.abs(await page.evaluate(()=>raceUI.snapshot().actors[0].steering))<.001);
  await page.keyboard.up('d');await page.keyboard.down('d');await page.waitForTimeout(120);
  assert.ok(Math.abs(await page.evaluate(()=>raceUI.snapshot().actors[0].steering))>.001,'a fresh press regains steering');
  await page.keyboard.up('d');
  await page.keyboard.press('Escape');await page.locator('#raceExit').click();
});
