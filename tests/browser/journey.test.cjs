// Full UI + genuine gameplay/crypto. By default only the opaque relay hop is
// substituted; SPACE_MAN_RELAY_HOST opts into the actual public relay.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises');
const {chromium,webkit}=require('playwright'),{simulatedRelay,validateRelayHost}=require('./arena-network-helper.cjs');
const ROOT=path.resolve(__dirname,'../..'),live=!!process.env.SPACE_MAN_RELAY_HOST,engine=process.env.SPACE_MAN_JOURNEY_BROWSER==='webkit'?webkit:chromium;
const relayHost=process.env.SPACE_MAN_RELAY_HOST||'relay.test';if(live)validateRelayHost(relayHost);
async function launch(t){
 let server,browser;const peers=[],hub=live?null:require('../harness.cjs').relay();
 let base=process.env.SPACE_MAN_BASE_URL;
 if(!base){server=http.createServer(async(req,res)=>{const p=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname)+(req.url.endsWith('/')?'index.html':''));if(!p.startsWith(ROOT+path.sep))return res.writeHead(400).end();try{const b=await fs.readFile(p);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(p)]||'application/octet-stream','cache-control':'no-store'}).end(b);}catch(_){res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port+'/';}
 browser=await engine.launch(engine===chromium&&process.env.SPACE_MAN_CHROMIUM_PATH?{executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
 t.after(async()=>{for(const c of peers){console.log('Journey diagnostics',c.name,JSON.stringify({deliveryErrors:c.deliveryErrors,maxDeliveryQueue:c.maxDeliveryQueue,...await diagnostics(c.page).catch(()=>({closed:true}))}));await capture(c.page,'journey-final-'+c.name.replaceAll(' ','-')).catch(()=>{});}for(const c of peers)await c.page.evaluate(()=>{clearInterval(window.driver);SpaceManNet.leave();}).catch(()=>{});await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}for(const c of peers)assert.deepEqual(c.errors,[],c.name+' has no uncaught errors');});
 async function peer(name,device={}){
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',...device});const c={name,context,errors:[],sockets:0,unexpectedSockets:0,deliveryErrors:0,sent:0,received:0,encryptedSent:0,encryptedReceived:0,sentTypes:{},receivedTypes:{},offline:false};peers.push(c);
  if(!live)await simulatedRelay(context,c,hub);
  await context.addInitScript(host=>{const p=/^\/pr\/([1-9]\d*)\/([a-f0-9]{40})\/([a-f0-9]{40})\//.exec(location.pathname),prefix=p?'sm2.preview.'+p[1]+'.'+p[2]+'.'+p[3]+'.':'';localStorage.setItem(prefix+'sm2.settings',JSON.stringify({netRelay:host==='default'?'':host,music:false,sfx:false,muted:true,haptics:false,reduceMotion:true}));window.testPad={connected:true,mapping:'standard',index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad],configurable:true});},relayHost);
  c.page=await context.newPage();c.page.setDefaultTimeout(30000);c.page.on('pageerror',e=>c.errors.push(e.message));c.acceptDialog=d=>d.accept();c.page.on('dialog',c.acceptDialog);if(live)c.page.on('websocket',ws=>{c.sockets++;ws.on('framesent',e=>{if(Buffer.from(e.payload)[0]===4)c.encryptedSent++;});ws.on('framereceived',e=>{if(Buffer.from(e.payload)[0]===5)c.encryptedReceived++;});});await c.page.goto(base);await c.page.evaluate(()=>{window.journeyWire=null;SpaceManNet.onEvent('journey-data',d=>{const x=SpaceManJourneyOnline.decode(d.bytes);if(x&&x.type===2)journeyWire={index:x.index,epoch:x.epoch,phase:x.phase,revision:x.revision,mode:x.mode,length:x.payload.length};});});if(process.env.SPACE_MAN_EXPECTED_SHA)assert.equal(JSON.parse(await c.page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha,process.env.SPACE_MAN_EXPECTED_SHA);return c;
 }
 return{peer,peers};
}
async function driver(p){await p.evaluate(()=>{window.visited=[];window.driver=setInterval(()=>{const j=journeyUI?.room.current;if(!j)return;if(!visited.includes(j.index))visited.push(j.index);testPad.axes=[0,0];testPad.buttons.forEach(b=>b.pressed=false);if(j.phase!=='running')return;if(j.mode==='runner'){testPad.axes[0]=1;}else if(j.mode==='arena'){testPad.axes[0]=j.config.kind==='boss'?0:1;testPad.buttons[2].pressed=true;}else{const s=raceUI?.snapshot(),a=s?.actors.find(a=>a.controller==='human');if(s&&a&&s.phase==='racing'){const cmd=SpaceManRace.cpuInput(s,a);testPad.axes[0]=cmd.steer;testPad.buttons[0].pressed=cmd.boost;testPad.buttons[1].pressed=cmd.brake;testPad.buttons[5].pressed=cmd.item;}}},16);});}
async function capture(p,name){if(!process.env.SPACE_MAN_JOURNEY_SCREENSHOTS)return;await fs.mkdir(process.env.SPACE_MAN_JOURNEY_SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.SPACE_MAN_JOURNEY_SCREENSHOTS,name+'.png'),animations:'disabled',timeout:5000});}
// Keep evidence for missed UI actions separate from protocol failures. This
// observer never changes role requests, frame timing, or the native dialog.
async function observeJourney(p){await p.evaluate(()=>{
 window.journeyHistory=[];window.journeyUIEvents=[];window.journeyUpdateCount=0;let previous='';
 journeyUI.room.attach({onChange(s){journeyUpdateCount++;const j=s.journey,entry={index:j?.index,epoch:j?.epoch,phase:j?.phase,role:SpaceManNet.info().role,effectiveRole:s.info.role,pendingRole:s.pendingRole,players:j?.players};const key=JSON.stringify(entry);if(key!==previous){previous=key;journeyHistory.push({...entry,at:Math.round(performance.now())});if(journeyHistory.length>64)journeyHistory.shift();}}});
 for(const type of['pointerdown','pointerup','click'])document.addEventListener(type,e=>{const target=e.target.closest?.('#journeyRole,#journeyLeave,#journeyResume');if(target){journeyUIEvents.push({type,id:target.id,at:Math.round(performance.now()),trusted:e.isTrusted});if(journeyUIEvents.length>30)journeyUIEvents.shift();}},true);
});}
// A trusted mouse gesture remains held across several genuine room snapshots.
// Repainting unchanged labels must not replace the pressed text node or cancel
// activation. No programmatic button.click(), forced input, or fake update.
async function clickAcrossRoomUpdates(p,selector){
 const target=p.locator(selector);await target.click({trial:true});const box=await target.boundingBox();assert.ok(box,'Crew button has a hit box');
 await target.evaluate(el=>{window.journeyHeldButton=el;window.journeyHeldText=el.firstChild;});
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
 try{
  const count=await p.evaluate(()=>window.journeyUpdateCount);
  await p.waitForFunction(n=>window.journeyUpdateCount>=n+3,count,{timeout:5000});
  assert.equal(await p.evaluate(()=>journeyHeldText?.isConnected&&journeyHeldButton.firstChild===journeyHeldText),true,selector+' preserves its pressed text node across snapshots');
 }finally{await p.mouse.up();}
}
const diagnostics=p=>p.evaluate(()=>{
 const s=journeyUI?.room.status(),j=s?.journey;
 const describe=id=>{const el=document.getElementById(id);if(!el)return null;const r=el.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)),hit=document.elementFromPoint(x,y);return{hidden:el.hidden,disabled:el.disabled,inert:!!el.closest('[inert]'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.id||hit?.className||hit?.tagName};};
 return{accepted:j?{index:j.index,epoch:j.epoch,phase:j.phase}:null,status:s?.error,active:SpaceManNet.active,role:SpaceManNet.info().role,effectiveRole:s?.info.role,pendingRole:s?.pendingRole,players:s?.info.players,spectators:s?.info.spectators,wire:window.journeyWire,visibility:document.visibilityState,focus:document.activeElement?.id,ui:{crew:describe('journeyFriends'),role:describe('journeyRole'),leave:describe('journeyLeave')},history:window.journeyHistory,events:window.journeyUIEvents};
});
const state=p=>p.evaluate(()=>{const s=journeyUI.room.status();return{mode:s.journey?.mode,index:s.journey?.index,epoch:s.journey?.epoch,phase:s.journey?.phase,p:SpaceManNet.info().myP,room:SpaceManNet.info().roomId,role:SpaceManNet.info().role,effectiveRole:s.info.role,players:s.info.players,spectators:s.info.spectators};});
test((live?'LIVE public':'simulated')+' relay: one crew through all engines and a boss, late watch, queued seat, reconnect and exit',{timeout:420000},async t=>{
 const{peer}=await launch(t),host=await peer('host'),friend=await peer('phone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}),watcher=await peer('watcher',{viewport:{width:320,height:568},isMobile:true,hasTouch:true});
 await host.page.locator('#btnExpeditionFriends').click();await observeJourney(host.page);await host.page.locator('#journeyHost').click();await host.page.waitForFunction(()=>journeyUI?.room.active);const invite=await host.page.evaluate(()=>SpaceManNet.info().link);
 for(const[c,watch]of[[friend,false],[watcher,true]]){await c.page.locator('#btnExpeditionFriends').click();await observeJourney(c.page);await c.page.locator('#journeyJoinInput').fill(invite);await c.page.locator(watch?'#journeyWatch':'#journeyJoin').click();await c.page.waitForFunction(()=>journeyUI?.room.active&&SpaceManNet.roster().some(r=>r.you));}
 await host.page.waitForFunction(()=>SpaceManNet.roster().length===3);const initial=await Promise.all([host,friend,watcher].map(c=>state(c.page)));
 await host.page.locator('#journeyStart').click();await Promise.all([host,friend,watcher].map(c=>c.page.waitForFunction(()=>journeyUI.room.current?.phase==='running')));
 assert.equal((await state(watcher.page)).role,1);assert.equal(await host.page.locator('#btnExpeditionContinue').count(),0);await capture(friend.page,'journey-phone-first');await host.page.keyboard.press('Escape');await host.page.waitForFunction(()=>journeyUI.room.current?.phase==='paused');
 // A real socket interruption; session key and role must recover without a new room.
 const key=await friend.page.evaluate(()=>SpaceManNet._n1.bytes.hex(SpaceManNet._n1.session().keys.pub));await friend.page.evaluate(()=>SpaceManNet._n1.session().relay.kick('acceptance socket interruption'));
 await friend.page.waitForFunction(()=>SpaceManNet._n1.session()?.relay.state==='established');assert.equal(await friend.page.evaluate(()=>SpaceManNet._n1.bytes.hex(SpaceManNet._n1.session().keys.pub)),key);
 const late=await peer('late viewer',{viewport:{width:320,height:568},isMobile:true,hasTouch:true});await late.page.locator('#btnExpeditionFriends').click();await observeJourney(late.page);await late.page.locator('#journeyJoinInput').fill(invite);await late.page.locator('#journeyJoin').click();await late.page.waitForFunction(()=>journeyUI.room.active&&SpaceManNet.roster().some(r=>r.you)&&journeyUI.room.current?.phase==='paused');assert.equal((await state(late.page)).role,1);const lateMode=(await state(late.page)).mode;const crew=late.page.locator(lateMode==='runner'?'#btnJourneyCrew':lateMode==='arena'?'#arenaJourneyCrew':'#raceJourneyCrew');if(!await crew.isVisible())await late.page.keyboard.press('Escape');await crew.click();await clickAcrossRoomUpdates(late.page,'#journeyRole');await late.page.waitForFunction(()=>journeyUI.room.status().pendingRole===0,undefined,{timeout:5000});assert.equal((await state(late.page)).role,1,'queued request keeps viewer role until host admits it');await late.page.locator('#journeyResume').click();const hostMode=(await state(host.page)).mode;await host.page.locator(hostMode==='runner'?'#btnResume':hostMode==='arena'?'#arenaResume':'#raceResume').click();await late.page.waitForFunction(()=>journeyUI.room.current?.phase==='running');const resume=late.page.locator(lateMode==='runner'?'#btnResume':lateMode==='arena'?'#arenaResume':'#raceResume');if(await resume.isVisible()&&await resume.isEnabled())await resume.click();await driver(host.page);await driver(friend.page);await driver(late.page);
 for(let index=1;index<=5;index++){
  await host.page.waitForFunction(n=>journeyUI.room.current?.index>=n,index,{timeout:115000});await friend.page.waitForFunction(n=>journeyUI.room.current?.index>=n,index,{timeout:15000});await watcher.page.waitForFunction(n=>journeyUI.room.current?.index>=n,index,{timeout:15000});
  const states=await Promise.all([host,friend,watcher].map(c=>state(c.page)));states.forEach((s,i)=>{assert.equal(s.room,initial[i].room);assert.equal(s.p,initial[i].p);assert.equal(s.role,initial[i].role);});
  if(index===4){await host.page.waitForFunction(()=>journeyUI.room.current?.phase==='running');assert.equal(await host.page.evaluate(()=>arenaUI.snapshot().actors.length),5);await watcher.page.waitForFunction(()=>journeyUI.room.current?.index===4&&arenaUI?.snapshot()?.actors.some(a=>a.boss)&&document.querySelector('#expeditionCue').hidden&&document.querySelector('.arena-countdown').hidden);
   const bossName=await watcher.page.evaluate(()=>arenaUI.snapshot().actors.find(a=>a.boss).name);
   for(let n=0;n<6&&!(await watcher.page.locator('.arena-watch-tools span').innerText()).includes(bossName);n++)await watcher.page.locator('#arenaWatchNext').click();
   assert.ok((await watcher.page.locator('.arena-watch-tools span').innerText()).includes(bossName),'ordinary spectator camera follows the boss');
   for(const phase of['charging','active','recover']){await watcher.page.waitForFunction(phase=>arenaUI?.snapshot()?.actors.some(a=>a.boss?.phase===phase),phase,{timeout:25000});await watcher.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await watcher.page.locator('#expeditionCue').isVisible(),false);await capture(watcher.page,'journey-phone-boss-'+phase);} }
 }
 assert.equal((await state(late.page)).role,0,'late viewer takes requested seat at next boundary');
 for(const c of[host,friend,watcher])assert.ok(c.encryptedSent>0&&c.encryptedReceived>0,'genuine encrypted relay traffic');
 // Finish synthetic driving before exercising the human host's close-room
 // confirmation. WebKit needs the page foregrounded for native modal input.
 await Promise.all([host,friend,late].map(c=>c.page.evaluate(()=>{clearInterval(window.driver);testPad.axes=[0,0];testPad.buttons.forEach(b=>b.pressed=false);})));
 await host.page.bringToFront();
 await host.page.waitForFunction(()=>journeyUI.room.current?.phase==='running');
 await host.page.keyboard.press('Escape');
 const exitMode=(await state(host.page)).mode;
 await host.page.locator(exitMode==='runner'?'#btnJourneyCrew':exitMode==='arena'?'#arenaJourneyCrew':'#raceJourneyCrew').click();
 const leave=host.page.locator('#journeyLeave');
 // Finish scrolling/actionability before listening for the native modal. The
 // previous independent 5s event timer could expire while click() was still
 // waiting, hiding its actual actionability error and abandoning its promise.
 await leave.click({trial:true});
 const confirmations=[],responses=[];
 const confirmClose=dialog=>{
  const actual={type:dialog.type(),message:dialog.message()};confirmations.push(actual);
  const valid=actual.type==='confirm'&&actual.message==='Close this expedition for everyone?';
  const response=(valid?dialog.accept():dialog.dismiss()).then(()=>null,error=>error);responses.push(response);
 };
 host.page.off('dialog',host.acceptDialog);host.page.on('dialog',confirmClose);
 try{
  await clickAcrossRoomUpdates(host.page,'#journeyLeave'); // Includes native-dialog handling.
  const errors=await Promise.all(responses);for(const error of errors)if(error)throw error;
  assert.deepEqual(confirmations,[{type:'confirm',message:'Close this expedition for everyone?'}],'one genuine host close-room confirmation');
 }finally{host.page.off('dialog',confirmClose);host.page.on('dialog',host.acceptDialog);}
 await host.page.waitForFunction(()=>!journeyUI.room.active&&!SpaceManNet.active,undefined,{timeout:5000});
 await Promise.all([friend,watcher,late].map(c=>c.page.waitForFunction(()=>!SpaceManNet.active&&!sharedEncounter&&!arenaUI?.active&&!raceUI?.active)));
 assert.equal(await host.page.locator('#ovAttract').evaluate(el=>el.inert),false);
});
