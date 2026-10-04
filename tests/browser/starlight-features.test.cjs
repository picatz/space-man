// Real rendering/input acceptance. Read-only driver/probes never move actors,
// grant pickups, skip gates, change physics, or pretend automation establishes fun.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),engine=process.env.SPACE_MAN_RACE_BROWSER==='webkit'?webkit:chromium;
async function launch(t,device,{camera="chase",calm=false}={}){
 const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(ROOT,'.'+decodeURIComponent(pathname)+(pathname.endsWith('/')?'index.html':''));if(!file.startsWith(ROOT+path.sep))return res.writeHead(400).end();const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'content-type':type,'cache-control':'no-store'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await engine.launch(engine===chromium&&process.env.SPACE_MAN_CHROMIUM_PATH?{executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
 const context=await browser.newContext({serviceWorkers:'block',...device}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.deepEqual(errors,[]);});
 await page.goto(process.env.SPACE_MAN_BASE_URL||`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(calm=>{if(calm){settings.reduceMotion=true;settings.batterySaver=true;}},calm);
 await page.evaluate(()=>{
  window.trackProbe={events:{},airMax:0,coins:0,items:[],warningInputs:0,emptyWarningInputs:0};
  const api=SpaceManRace;
  window.SpaceManRace={...api,step(state,inputs){const out=api.step(state,inputs),a=state.actors[0];
   trackProbe.airMax=Math.max(trackProbe.airMax,a.z||0);
   if(a.item&&!trackProbe.items.includes(a.item))trackProbe.items.push(a.item);
   for(const e of state.events){if(e.id===a.id)trackProbe.events[e.type]=(trackProbe.events[e.type]||0)+1;}
   if(inputs[a.id]?.warnings?.some(Boolean)){trackProbe.warningInputs++;const w=document.querySelector('.race-warning');if(!w||w.hidden||w.dataset.kind!=='pulse')trackProbe.emptyWarningInputs++;}
   return out;}};
  window.testPad={index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[testPad]});
  window.autoItem=false;
  window.trackDriver=setInterval(()=>{
   const s=typeof raceUI!=='undefined'?raceUI?.snapshot():null;
   if(!s||s.phase!=='racing'||raceUI.screen!=='play'){testPad.axes[0]=0;testPad.buttons.forEach(b=>{b.pressed=false;b.value=0;});return;}
   const actor=s.actors[0],command=SpaceManRace.cpuInput(s,actor),course=SpaceManRace.course(s.trackId),near=SpaceManRace.nearest(course,actor.x,actor.y);
   // Deliberately drive both choice lines through real gamepad steering. A fast
   // first-place driver otherwise sensibly chooses Shield at every row.
   const row=SpaceManRace.features(course).rows.find(row=>!actor.item&&!(actor.rowMask&(1<<row.index))&&near.s>=row.s-200&&near.s<row.s+24);
   if(row){const lane=trackProbe.items.includes('shield')?44:-44,ahead=SpaceManRace.at(course,near.s+70+actor.speed*13),heading=Math.atan2(ahead.y+ahead.tx*lane-actor.y,ahead.x-ahead.ty*lane-actor.x),turn=Math.atan2(Math.sin(heading-actor.heading),Math.cos(heading-actor.heading));command.steer=Math.max(-1,Math.min(1,turn*1.85));}
   testPad.axes[0]=command.steer;
   for(const[i,on]of[[0,command.boost],[1,command.brake]]){testPad.buttons[i].pressed=!!on;testPad.buttons[i].value=on?1:0;}
   if(autoItem){testPad.buttons[5].pressed=!!command.item;testPad.buttons[5].value=command.item?1:0;}
  },16);
 });
 await page.locator('#btnRace').click();await page.locator('.race-launch').click();
 if(camera==='cockpit')await page.keyboard.press('c');
 await page.waitForFunction(()=>raceUI.snapshot()?.phase==='racing');
 return{page,context};
}
async function shot(page,name){if(!process.env.SPACE_MAN_RACE_SCREENSHOTS)return;await fs.mkdir(process.env.SPACE_MAN_RACE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.SPACE_MAN_RACE_SCREENSHOTS,name+'.png')});}
async function controlsFit(page){
 const boxes=await page.locator('.race-item,.race-touch-button,.race-recover').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&!n.closest('[hidden]')).map(n=>{const b=n.getBoundingClientRect();return{action:n.dataset.action||'rescue',x:b.x,y:b.y,w:b.width,h:b.height};}));
 const viewport=page.viewportSize();for(const b of boxes){assert.ok(b.w>=44&&b.h>=44,JSON.stringify(b));assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=viewport.width+1&&b.y+b.h<=viewport.height+1,JSON.stringify(b));}
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.x+a.w<=b.x+.5||b.x+b.w<=a.x+.5||a.y+a.h<=b.y+.5||b.y+b.h<=a.y+.5,'touch controls overlap: '+JSON.stringify([a,b]));}
}
for(const device of[
 {name:'small-phone',viewport:{width:320,height:568},isMobile:true,hasTouch:true},
 {name:'phone-portrait',viewport:{width:390,height:844},isMobile:true,hasTouch:true},
 {name:'phone-landscape',viewport:{width:844,height:390},isMobile:true,hasTouch:true},
 {name:'cockpit-portrait',camera:'cockpit',viewport:{width:390,height:844},isMobile:true,hasTouch:true},
 {name:'cockpit-calm-landscape',camera:'cockpit',calm:true,viewport:{width:844,height:390},isMobile:true,hasTouch:true},
 {name:'tablet',viewport:{width:820,height:1180},isMobile:true,hasTouch:true},
])test(`Starlight ${device.name}: genuine ramp, coin route, item tap and interruption`,{timeout:90000},async t=>{
 const{name,camera,calm,...options}=device,{page}=await launch(t,options,{camera,calm});await controlsFit(page);
 await page.waitForFunction(()=>{const s=raceUI.snapshot(),c=SpaceManRace.course(s.trackId),n=SpaceManRace.nearest(c,s.actors[0].x,s.actors[0].y),r=SpaceManRace.features(c).ramps[0];return n.s>r.startS-150&&n.s<r.startS-35;},null,{timeout:30000});
 await shot(page,'track-'+name+'-approach');
 await page.waitForFunction(()=>{const a=raceUI.snapshot().actors[0];return a.airRamp&&a.airTicks>=8&&a.airTicks<23;},null,{timeout:30000});
 await shot(page,'track-'+name+'-jump');
 await page.keyboard.press('Escape');await page.locator('#raceResume').waitFor();
 const before=await page.evaluate(()=>raceUI.snapshot());await page.waitForTimeout(120);const after=await page.evaluate(()=>raceUI.snapshot());assert.equal(after.tick,before.tick);assert.equal(after.actors[0].z,before.actors[0].z);
 await page.locator('#raceResume').click();
 await page.waitForFunction(()=>!!raceUI.snapshot().actors[0].item,null,{timeout:30000});
 await controlsFit(page);await shot(page,'track-'+name+'-item');
 const item=await page.evaluate(()=>raceUI.snapshot().actors[0].item),box=await page.locator('.race-item').boundingBox();
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
 await page.waitForFunction(item=>(trackProbe.events[item]||0)>0,item,{timeout:3000});
 assert.equal(await page.evaluate(item=>trackProbe.events[item],item),1,'one native tap activates once');
 const probe=await page.evaluate(()=>trackProbe);assert.ok(probe.airMax>20);assert.ok((probe.events.coin||0)>0,'route collected real boost coins');
 assert.equal(probe.emptyWarningInputs,0,'no warning acknowledgement without visible warning');
 if(name==='phone-portrait'){
  await page.setViewportSize({width:844,height:390});await controlsFit(page);
  await page.keyboard.press('Escape');await page.locator('#raceResume').waitFor();await page.getByRole('button',{name:'All games',exact:true}).click();assert.equal(await page.locator('.race-root').isVisible(),false);
 }
});
test('Starlight desktop: real keyboard and controller item edges, full ordered race and warning receipts',{timeout:150000},async t=>{
 const{page}=await launch(t,{viewport:{width:1280,height:800}});
 await page.waitForFunction(()=>!!raceUI.snapshot().actors[0].item,null,{timeout:30000});
 const item=await page.evaluate(()=>raceUI.snapshot().actors[0].item);
 await page.keyboard.press('Escape');await page.locator('#raceResume').click();
 await page.keyboard.press('KeyF');await page.waitForFunction(()=>raceUI.snapshot().actors[0].item===null);
 assert.ok(await page.evaluate(item=>(trackProbe.events[item]||0)>0,item));
 await page.waitForFunction(()=>!!raceUI.snapshot().actors[0].item,null,{timeout:30000});
 await page.evaluate(()=>{testPad.buttons[5].pressed=true;testPad.buttons[5].value=1;});await page.waitForFunction(()=>raceUI.snapshot().actors[0].item===null);await page.evaluate(()=>{testPad.buttons[5].pressed=false;testPad.buttons[5].value=0;autoItem=true;});
 await page.waitForFunction(()=>raceUI.snapshot().phase==='finished',null,{timeout:80000});
 const result=await page.evaluate(()=>({state:raceUI.snapshot(),probe:trackProbe}));t.diagnostic(JSON.stringify(result.probe));
 assert.equal(result.state.actors[0].passed,60);assert.equal(result.state.actors[0].recoveries,0);
 assert.ok(result.probe.events.jump>=6);assert.ok(result.probe.events.coin>=6);assert.ok(result.probe.items.includes('shield')&&result.probe.items.includes('pulse'));
 assert.ok(result.probe.warningInputs>0,'actual screen warning was acknowledged');assert.equal(result.probe.emptyWarningInputs,0);
 await shot(page,'track-desktop-finish');t.diagnostic(JSON.stringify(result.probe));
});
