'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const engine=process.env.SPACE_MAN_ARENA_BROWSER==='webkit'?webkit:chromium;
async function launch(t,device){
 let server,browser;t.after(async()=>{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}});
 server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),file=path.resolve(ROOT,'.'+decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(ROOT+path.sep))return res.writeHead(400).end();const b=await fs.readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream'}).end(b);}catch(_){res.writeHead(404).end();}});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
 browser=await engine.launch(engine===chromium&&process.env.SPACE_MAN_CHROMIUM_PATH?{executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
 const context=await browser.newContext({viewport:device==='touch'?{width:820,height:1180}:{width:1440,height:900},hasTouch:device==='touch',isMobile:device==='touch',serviceWorkers:'block'});
 const errors=[],sockets=[];await context.routeWebSocket('**/*',ws=>{sockets.push(ws.url());ws.close();});
 if(device==='gamepad')await context.addInitScript(()=>{window.testPad={connected:true,mapping:'standard',index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[testPad],configurable:true});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));t.after(()=>{assert.deepEqual(errors,[]);assert.deepEqual(sockets,[]);});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 // Read-only probe around the production buffer. No actor/clock/result changes.
 await page.evaluate(()=>{
  window.bufferSamples=[];const original=SpaceManArena;
  window.SpaceManArena=Object.freeze({...original,createActionBuffer(){const inner=original.createActionBuffer();return Object.freeze({reset:inner.reset,sample(...args){const result=inner.sample(...args),[input,a,tick]=args;bufferSamples.push({tick,now:performance.now(),attackTicks:a?.attackTicks,dashCooldown:a?.dashCooldown,stun:a?.stun,input:{...input},output:{...result}});if(bufferSamples.length>600)bufferSamples.shift();return result;}});}});
 });
 await page.locator('#btnArena').click();await page.locator('#arenaStart').click();await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing');
 return page;
}
async function tap(page,device,action,touchPoint){
 if(device==='keyboard')await page.keyboard.press(action==='attack'?'f':'k');
 else if(device==='touch')await page.touchscreen.tap(touchPoint.x,touchPoint.y);
 else {const n=action==='attack'?2:1;await page.evaluate(n=>{testPad.buttons[n]={pressed:true,value:1};},n);await page.waitForFunction(({action})=>bufferSamples.some(s=>s.input[action==='attack'?'attackPressed':'dashPressed']),{action});await page.evaluate(n=>{testPad.buttons[n]={pressed:false,value:0};},n);}
}
for(const device of ['keyboard','touch','gamepad'])test(`${device} real Pulse tap near recovery executes once at readiness`,{timeout:45000},async t=>{
 const page=await launch(t,device);
 // Resolve geometry before the timed input window; locator.tap() would repeat
 // actionability/stability waits after observing a window of at most 100ms.
 const touchBox=device==='touch'?await page.locator('.arena-touch-attack').boundingBox():null;
 if(device==='touch')assert.ok(touchBox,'actual touch button is visible');
 const touchPoint=touchBox?{x:touchBox.x+touchBox.width/2,y:touchBox.y+touchBox.height/2}:null;
 await tap(page,device,'attack',touchPoint);await page.waitForFunction(()=>arenaUI.snapshot().actors[0].attackSerial===1);
 await page.evaluate(()=>bufferSamples.length=0);
 await page.waitForFunction(()=>{const a=arenaUI.snapshot().actors[0];return a.attackTicks<=6&&a.attackTicks>1;},undefined,{polling:'raf'});
 await tap(page,device,'attack',touchPoint);
 await page.waitForFunction(()=>arenaUI.snapshot().actors[0].attackSerial===2);
 const samples=await page.evaluate(()=>bufferSamples),late=samples.find(s=>s.input.attackPressed);
 assert.ok(late&&late.attackTicks>1&&late.attackTicks<=7,'the second actual device press landed within the late window');
 assert.equal(late.output.attackPressed,false,'late input waited rather than bypassing recovery');
 const released=samples.filter(s=>s.output.attackPressed);assert.equal(released.length,1);assert.equal(released[0].attackTicks,1);
 assert.ok(released[0].tick-late.tick<=6);assert.ok(released[0].now-late.now<=115,'100ms buffer plus bounded observation scheduling');
 await page.locator('#arenaPause').click();assert.equal(await page.evaluate(()=>arenaUI.snapshot().actors[0].attackSerial),2);
 console.log(JSON.stringify({device,lateLock:late.attackTicks,delayedTicks:released[0].tick-late.tick,observedMs:released[0].now-late.now,attacks:2}));
});
