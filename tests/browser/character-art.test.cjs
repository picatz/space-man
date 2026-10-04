// Real production renderers, plus actual mode UI. Galleries are a visual review
// aid, not substitutes for the gameplay screenshots or input regressions.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'), ENGINE=process.env.SPACE_MAN_ART_BROWSER==='webkit'?webkit:chromium;
async function launch(t,viewport={width:1280,height:800},touch=false) {
 const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(ROOT,'.'+decodeURIComponent(pathname)+(pathname.endsWith('/')?'index.html':''));if(!file.startsWith(ROOT+path.sep))return res.writeHead(400).end();res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'}[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;t.after(async()=>{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 browser=await ENGINE.launch(ENGINE===chromium&&process.env.SPACE_MAN_CHROMIUM_PATH?{executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
 const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.goto(process.env.SPACE_MAN_BASE_URL||`http://127.0.0.1:${server.address().port}/`);await page.locator('#btnArena').waitFor();await page.evaluate(()=>{settings.muted=true;});return{page,context};
}
async function capture(page,name){const dir=process.env.SPACE_MAN_ART_SCREENSHOTS;if(!dir)return;await fs.mkdir(dir,{recursive:true});await page.screenshot({path:path.join(dir,name+'.png')});}
async function renderedCamera(page,mode) {
 await page.waitForFunction(mode=>{const r=document.querySelector('.race-root'),c=document.querySelector('.race-cockpit'),w=document.querySelector('.race-world');return r.dataset.camera===mode&&r.dataset.renderer===(mode==='topdown'?'2d':'webgl')&&w.hidden===(mode==='topdown')&&c.hidden===(mode!=='cockpit');},mode);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
for(const [width,height,touch] of [[390,844,true],[844,390,true],[820,1180,true],[1280,800,false]])test(`in-game character pixels ${width}x${height}`,{timeout:45000},async t=>{
 const{page}=await launch(t,{width,height},touch);
 await page.locator('#btnWardrobe').click();
 for(const [slot,id] of [['suit','mint'],['hat','antenna'],['eyes','happy'],['helmet','bubble'],['detail','stripe'],['ship','orbit']]) {
  await page.locator('#wardTab-'+slot).click();await page.locator('[data-slot="'+slot+'"][data-cosmetic="'+id+'"]').click();
 }
 await capture(page,`equipped-wardrobe-${width}`);await page.locator('#btnWardrobeDone').click();
 assert.equal(await page.evaluate(()=>G.cosmetics.ship),'orbit');
 if(touch){await page.locator('#btnPlay').tap({force:true});await page.touchscreen.tap(width*.8,height*.72);}else{await page.locator('#btnPlay').focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');}await page.waitForTimeout(220);await capture(page,`runner-${width}`);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Quit to Title',exact:true}).click();
 await page.locator('#btnArena').click();await capture(page,`arena-hero-${width}`);await page.locator('#arenaStart').click();await page.waitForFunction(()=>arenaUI.snapshot()?.phase==='playing');assert.equal(await page.evaluate(()=>arenaUI.snapshot().actors.find(a=>a.controller==='human').appearance.suit),'mint');
 await page.waitForFunction(()=>arenaUI.snapshot().tick>SpaceManArena.constants.COUNTDOWN_TICKS+40);await page.keyboard.press('Space');await page.waitForTimeout(130);await capture(page,`arena-jump-${width}`);await page.keyboard.press('Escape');await page.locator('#arenaExit').click();
 await page.locator('#btnRace').click();await capture(page,`race-hero-${width}`);await page.locator('.race-launch').click();await page.waitForFunction(()=>raceUI.snapshot()?.phase==='racing');assert.equal(await page.evaluate(()=>raceUI.snapshot().actors.find(a=>a.controller==='human').appearance.ship),'orbit');await page.waitForTimeout(300);await capture(page,`race-chase-${width}`);
 await page.keyboard.press('c');await renderedCamera(page,'cockpit');await capture(page,`race-cockpit-${width}`);await page.keyboard.press('c');await renderedCamera(page,'topdown');await capture(page,`race-topdown-${width}`);
 await page.evaluate(()=>{settings.reduceMotion=true;settings.batterySaver=true;});await page.waitForTimeout(200);await capture(page,`race-calm-saver-${width}`);await page.keyboard.press('c');await renderedCamera(page,'chase');await capture(page,`race-chase-calm-saver-${width}`);
});
test('shared full-suit and hoverpod contact sheet, including every accessory',{timeout:30000},async t=>{
 const{page}=await launch(t,{width:1280,height:900});
 const stats=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=1280;c.height=900;c.id='art-review';c.style='position:fixed;inset:0;z-index:99999;width:1280px;height:900px';document.body.append(c);const g=c.getContext('2d');g.fillStyle='#0A1428';g.fillRect(0,0,c.width,c.height);g.fillStyle='#CFE3FF';g.font='600 22px system-ui';g.fillText('ONE CREW / ORBITAL ARENA CHARACTER LANGUAGE',35,37);
  const C=SpaceManCosmetics,A=SpaceManArt;
  C.ORDERS.suit.forEach((s,i)=>{const x=80+i*160;A.drawAvatar(g,x,145,155,{...C.DEFAULTS,suit:s,eyes:['bright','calm','happy','determined'][i%4],helmet:C.ORDERS.helmet[i%3],detail:C.ORDERS.detail[i%3]},{reduceMotion:true});g.font='13px system-ui';g.fillStyle='#CFE3FF';g.fillText(s,x-30,245);});
  C.ORDERS.hat.forEach((hat,i)=>{const x=70+i*141;A.drawAvatar(g,x,355,150,{...C.DEFAULTS,hat},{reduceMotion:true});g.fillStyle='#CFE3FF';g.fillText(hat,x-30,455);});
  C.ORDERS.ship.forEach((ship,i)=>{const x=220+i*420;A.drawAvatar(g,x,610,290,{...C.DEFAULTS,suit:C.ORDERS.suit[i],ship,helmet:C.ORDERS.helmet[i],hat:['none','antenna','sprout'][i]},{reduceMotion:true,ship:true});g.fillStyle='#CFE3FF';g.fillText(ship,x-30,765);});
  const px=g.getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<px.length;i+=4)if(px[i]+px[i+1]+px[i+2]>350)lit++;return{lit};
 });assert.ok(stats.lit>25000,'actual canvas contains the authored character pixels');await capture(page,'character-contact-sheet');
});
test('front three-quarter WebGL pilots show their real face and equipped accessories',{timeout:30000},async t=>{
 const{page}=await launch(t,{width:1280,height:720});
 const rendered=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;canvas.style='position:fixed;inset:0;z-index:99999;width:1280px;height:720px';document.body.append(canvas);
  const renderer=SpaceManRender3D.create(canvas);if(!renderer)return false;renderer.resize(1280,720,1);
  const C=SpaceManCosmetics,s={tick:20,actors:C.ORDERS.ship.map((ship,i)=>({id:i+1,x:0,y:(i-1)*75,heading:0,color:['#38E1FF','#FFB454','#8AECAB'][i],appearance:{...C.DEFAULTS,ship,suit:C.ORDERS.suit[i],hat:['none','halo','sprout'][i],eyes:['bright','happy','determined'][i],helmet:C.ORDERS.helmet[i]}}))};
  window.drawArtReview=()=>renderer.draw({background:[.025,.035,.065],camera:{eye:[170,100,170],target:[0,15,0],fov:.7,near:1,far:1500},meshes:SpaceManRaceScene.actorMeshes(s),fog:{near:800,far:1500,color:[.025,.035,.065]}});window.drawArtReview();window.artReviewFrame=()=>{window.drawArtReview();requestAnimationFrame(window.artReviewFrame);};requestAnimationFrame(window.artReviewFrame);return true;
 });assert.equal(rendered,true,'hosted browser must actually render WebGL gallery');await page.waitForTimeout(100);await capture(page,'pilot-webgl-front');
});

test('close WebGL headwear sheet keeps all nine accessories clear of expressive eyes',{timeout:30000},async t=>{
 const{page}=await launch(t,{width:1280,height:1020});
 const count=await page.evaluate(()=>{
  const sheet=document.createElement('div');sheet.style='position:fixed;inset:0;z-index:99999;background:#07111e;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,340px)';document.body.append(sheet);const draws=[],C=SpaceManCosmetics;
  for(let i=0;i<C.ORDERS.hat.length;i++) {
   const box=document.createElement('div');box.style='position:relative';const canvas=document.createElement('canvas');canvas.width=426;canvas.height=310;canvas.style='width:100%;height:310px';box.append(canvas);const label=document.createElement('div');label.textContent=C.ORDERS.hat[i]+' / '+C.ORDERS.helmet[i%3];label.style='position:absolute;bottom:12px;width:100%;color:#CFE3FF;font:14px system-ui;text-align:center';box.append(label);sheet.append(box);
   const renderer=SpaceManRender3D.create(canvas,{powerSaving:true});if(!renderer)return 0;renderer.resize(426,310,1);
   const snapshot={tick:20,actors:[{id:1,x:0,y:0,heading:0,color:'#38E1FF',appearance:{...C.DEFAULTS,hat:C.ORDERS.hat[i],helmet:C.ORDERS.helmet[i%3],eyes:i%2?'happy':'bright'}}]};
   draws.push(()=>renderer.draw({background:[.025,.045,.08],camera:{eye:[85,56,43],target:[-4,22,0],fov:.7,near:1,far:800},meshes:SpaceManRaceScene.actorMeshes(snapshot),fog:{near:400,far:800}}));
  }
  const frame=()=>{draws.forEach(draw=>draw());requestAnimationFrame(frame);};frame();return draws.length;
 });assert.equal(count,9);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture(page,'pilot-webgl-all-headwear');
});

test('ship materials and compact silhouettes agree in 2D, front and chase WebGL',{timeout:30000},async t=>{
 const{page}=await launch(t,{width:1280,height:960});
 const stats=await page.evaluate(()=>{
  const sheet=document.createElement('div');sheet.style='position:fixed;inset:0;z-index:99999;background:#091c2c;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,320px)';document.body.append(sheet);
  const draws=[],C=SpaceManCosmetics;let vertices=0;
  C.ORDERS.ship.forEach((ship,row)=>{
   const appearance={...C.DEFAULTS,ship,suit:C.ORDERS.suit[row],helmet:C.ORDERS.helmet[row]},state={tick:20,actors:[{id:1,x:0,y:0,heading:0,color:'#38E1FF',appearance}]};
   for(const view of ['2D','FRONT','CHASE + BOOST']){
    const box=document.createElement('div');box.style='position:relative';const canvas=document.createElement('canvas');canvas.width=426;canvas.height=292;canvas.style='width:100%;height:292px';box.append(canvas);const label=document.createElement('div');label.textContent=ship.toUpperCase()+' / '+view;label.style='position:absolute;bottom:8px;width:100%;color:#cfe3ff;text-align:center;font:12px system-ui;letter-spacing:.12em';box.append(label);sheet.append(box);
    if(view==='2D'){
     const g=canvas.getContext('2d');g.fillStyle='#091c2c';g.fillRect(0,0,426,292);g.translate(213,146);g.scale(4.2,4.2);SpaceManArt.hoverpod(g,SpaceManArt.characterStyle(appearance,'#38E1FF'),{calm:true});
    }else{
     const renderer=SpaceManRender3D.create(canvas,{powerSaving:true});if(!renderer)throw Error('Ship comparison requires real WebGL');renderer.resize(426,292,1);
     const meshes=SpaceManRaceScene.actorMeshes(view==='CHASE + BOOST'?{...state,actors:state.actors.map(a=>({...a,boosting:true}))}:state,{calm:true});vertices=Math.max(vertices,meshes[0].vertices.length/9);
     draws.push(()=>renderer.draw({background:[.035,.11,.173],camera:{eye:view==='FRONT'?[83,58,52]:[-82,58,28],target:[0,14,0],fov:.76,near:1,far:800},meshes,fog:{near:400,far:800}}));
    }
   }
  });
  const frame=()=>{draws.forEach(draw=>draw());requestAnimationFrame(frame);};frame();return{renderers:draws.length,vertices};
 });
 assert.equal(stats.renderers,6);assert.ok(stats.vertices<9000);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture(page,'ship-cross-view-materials');
});
