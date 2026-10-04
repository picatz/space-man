// Full UI + genuine gameplay/crypto. By default only the opaque relay hop is
// substituted; SPACE_MAN_RELAY_HOST opts into the actual public relay.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises');
const {chromium,webkit}=require('playwright'),{simulatedRelay,validateRelayHost}=require('./arena-network-helper.cjs');
const ROOT=path.resolve(__dirname,'../..'),live=false,engine=process.env.SPACE_MAN_JOURNEY_BROWSER==='webkit'?webkit:chromium;
const relayHost='relay.test';if(live)validateRelayHost(relayHost);
async function launch(t){
 let server,browser;const peers=[],hub=live?null:require('../harness.cjs').relay();
 let base=process.env.SPACE_MAN_BASE_URL;
 if(!base){server=http.createServer(async(req,res)=>{const p=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname)+(req.url.endsWith('/')?'index.html':''));if(!p.startsWith(ROOT+path.sep))return res.writeHead(400).end();try{const b=await fs.readFile(p);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(p)]||'application/octet-stream','cache-control':'no-store'}).end(b);}catch(_){res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port+'/';}
 browser=await engine.launch(engine===chromium&&process.env.SPACE_MAN_CHROMIUM_PATH?{executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
 t.after(async()=>{for(const c of peers)await c.page.evaluate(()=>SpaceManNet.leave()).catch(()=>{});await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}for(const c of peers)assert.deepEqual(c.errors,[],c.name+' has no uncaught errors');});
 async function peer(name,device={}){
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',...device});const c={name,context,errors:[],sockets:0,unexpectedSockets:0,deliveryErrors:0,sent:0,received:0,encryptedSent:0,encryptedReceived:0,sentTypes:{},receivedTypes:{},offline:false};peers.push(c);
  if(!live)await simulatedRelay(context,c,hub);
  await context.addInitScript(host=>{const p=/^\/pr\/([1-9]\d*)\/([a-f0-9]{40})\/([a-f0-9]{40})\//.exec(location.pathname),prefix=p?'sm2.preview.'+p[1]+'.'+p[2]+'.'+p[3]+'.':'';localStorage.setItem(prefix+'sm2.settings',JSON.stringify({netRelay:host==='default'?'':host,music:false,sfx:false,muted:true,haptics:false,reduceMotion:true}));window.testPad={connected:true,mapping:'standard',index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad],configurable:true});},relayHost);
  c.page=await context.newPage();c.page.setDefaultTimeout(30000);c.page.on('pageerror',e=>c.errors.push(e.message));c.acceptDialog=d=>d.accept();c.page.on('dialog',c.acceptDialog);if(live)c.page.on('websocket',ws=>{c.sockets++;ws.on('framesent',e=>{if(Buffer.from(e.payload)[0]===4)c.encryptedSent++;});ws.on('framereceived',e=>{if(Buffer.from(e.payload)[0]===5)c.encryptedReceived++;});});await c.page.goto(base);await c.page.evaluate(()=>{window.journeyWire=null;SpaceManNet.onEvent('journey-data',d=>{const x=SpaceManJourneyOnline.decode(d.bytes);if(x&&x.type===2)journeyWire={index:x.index,epoch:x.epoch,phase:x.phase,revision:x.revision,mode:x.mode,length:x.payload.length};});});if(process.env.SPACE_MAN_EXPECTED_SHA)assert.equal(JSON.parse(await c.page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha,process.env.SPACE_MAN_EXPECTED_SHA);return c;
 }
 return{peer,peers};
}

const {decodePixels}=require('./qr-decode-helper.cjs');
async function decodeCanvas(p){
 const pixels=await p.locator('#journeyInviteQr').evaluate(c=>{const bytes=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return{width:c.width,height:c.height,data:btoa(text)};});
 return decodePixels(pixels.width,pixels.height,Buffer.from(pixels.data,'base64'));
}

// Decode the screenshot itself, not just the backing canvas. PNG decoding is
// delegated to the browser; QR interpretation remains independent in libzbar.
async function decodeScreenshot(page, png) {
 const raster=await page.evaluate(async base64=>{
  const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const c=canvas.getContext('2d');c.drawImage(image,0,0);const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
  let text='';for(let i=0;i<pixels.length;i+=16384)text+=String.fromCharCode(...pixels.subarray(i,i+16384));
  return{width:canvas.width,height:canvas.height,data:btoa(text)};
 },png.toString('base64'));
 return{...raster,link:decodePixels(raster.width,raster.height,Buffer.from(raster.data,'base64'))};
}
async function settleQr(page) {
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  let previous='',quietSince=performance.now();const deadline=quietSince+5000;
  function sample(){
   const r=document.getElementById('journeyInviteQr').getBoundingClientRect();
   const key=[r.x,r.y,r.width,r.height,document.getElementById('journeyFriends').scrollTop].map(n=>Math.round(n*2)/2).join(':');
   const now=performance.now();if(key!==previous){previous=key;quietSince=now;}
   if(now-quietSince>=250)return resolve();
   if(now>deadline)return reject(new Error('QR geometry did not settle: '+key));
   requestAnimationFrame(sample);
  }sample();
 }));
}
async function qrGeometry(page) {return page.locator('#journeyInviteQr').evaluate(e=>{
 const r=e.getBoundingClientRect(),v=visualViewport;
 return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,innerHeight,clientHeight:document.documentElement.clientHeight,visualHeight:v?.height,visualWidth:v?.width,visualTop:v?.offsetTop||0,visualLeft:v?.offsetLeft||0,hint:document.getElementById('journeyHint')?.textContent||'',scrollTop:document.getElementById('journeyFriends').scrollTop};
});}

test('legacy Journey host QR is visible, decodes and joins the exact isolated expedition',{timeout:90000},async t=>{
 const {peer}=await launch(t),host=await peer('QR host'),friend=await peer('QR phone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 // This compatibility flow remains covered even when its home launcher is hidden.
 await host.page.evaluate(()=>openSharedJourney());await host.page.locator('#journeyHost').click();
 await host.page.waitForFunction(()=>journeyUI?.room.active);
 const qr=host.page.locator('#journeyInviteQr');await qr.waitFor({state:'visible'});
 const decoded=await decodeCanvas(host.page);
 assert.equal(decoded,await host.page.evaluate(()=>SpaceManNet.info().link));
 assert.equal(await host.page.getByLabel('Expedition invite link',{exact:true}).inputValue(),decoded,'copy field preserves exact capability');
 await friend.page.evaluate(()=>openSharedJourney());await friend.page.locator('#journeyJoinInput').fill(decoded);await friend.page.locator('#journeyJoin').click();
 await friend.page.waitForFunction(()=>journeyUI?.room.active&&SpaceManNet.roster().some(r=>r.you));
 const state=p=>p.evaluate(()=>({room:SpaceManNet.info().roomId,mode:journeyUI.room.current.mode,phase:journeyUI.room.current.phase}));
 assert.deepEqual(await state(friend.page),await state(host.page),'decoded QR joins same room and mode');
 assert.equal(await friend.page.locator('#journeyInviteQr').isVisible(),false,'guest does not display a host capability');
 await host.page.bringToFront();
 for(const [width,height] of [[320,568],[390,844],[667,375],[820,1180],[1440,900]]){
  await host.page.setViewportSize({width,height});
  await host.page.waitForFunction(width=>document.documentElement.clientWidth===width,width);
  await host.page.evaluate(()=>document.fonts.ready);
  await host.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const first=await qrGeometry(host.page);
  // A normal wheel gesture centers the code in the real screenshot viewport.
  // This host context is desktop WebKit/Chromium at each responsive size.
  await host.page.mouse.move(width/2,height/2);await host.page.mouse.wheel(0,first.y+first.height/2-height/2);
  await host.page.waitForFunction(({width,height})=>{const r=document.getElementById('journeyInviteQr').getBoundingClientRect();return r.left>=0&&r.right<=width&&r.top>=0&&r.bottom<=height;},{width,height});
  await settleQr(host.page);
  const before=await qrGeometry(host.page),png=await host.page.screenshot(),after=await qrGeometry(host.page);
  if(process.env.SPACE_MAN_JOURNEY_SCREENSHOTS){await fs.mkdir(process.env.SPACE_MAN_JOURNEY_SCREENSHOTS,{recursive:true});await fs.writeFile(path.join(process.env.SPACE_MAN_JOURNEY_SCREENSHOTS,`journey-qr-${width}x${height}.png`),png);}
  console.log('QR screenshot geometry',JSON.stringify({width,height,before,after}));
  for(const g of [before,after]){const visibleHeight=Math.min(height,g.clientHeight,g.visualHeight||height),visibleWidth=Math.min(width,g.visualWidth||width);assert.ok(g.x>=g.visualLeft&&g.right<=g.visualLeft+visibleWidth&&g.y>=g.visualTop&&g.bottom<=g.visualTop+visibleHeight&&g.width>=240&&g.height>=240,'entire QR is inside the actual screenshot and visual viewport');}
  // WebKit can finish a reflow during capture. Both boxes must stay fully
  // inside; decoding the actual screenshot below is the pixel-level gate.
  const screen=await decodeScreenshot(host.page,png);
  assert.equal(screen.width,width);assert.equal(screen.height,height);assert.equal(screen.link,decoded,'on-screen QR pixels preserve the complete invite');
  assert.equal(await decodeCanvas(host.page),decoded,'resizing keeps backing pixels correct');
  for(const id of ['journeyCopy','journeyStart','journeyLeave']){const b=host.page.locator('#'+id);await b.scrollIntoViewIfNeeded();assert.equal(await b.evaluate(e=>{const r=e.getBoundingClientRect();const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(h===e||e.contains(h));}),true,id+' reachable after QR');}
 }
 await friend.page.locator('#journeyLeave').click();await friend.page.waitForFunction(()=>!journeyUI.room.active);
 await host.page.locator('#journeyLeave').click();await host.page.waitForFunction(()=>!journeyUI.room.active);
 assert.equal(await qr.isVisible(),false,'closed room clears QR');
});
