'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const{client,relay,until}=require('../harness.cjs');
const{decodePixels,attachCanvasDOM}=require('./qr-decode-helper.cjs');
for(const previewMode of [false,true]) test((previewMode?'preview':'production')+' rendered host Journey QR decodes verbatim and joins the same isolated room/build/mode',async t=>{
 const sha='a'.repeat(40),buildSha='b'.repeat(40),basePath='/pr/53/'+sha+'/'+buildSha+'/';
 const opts=previewMode?{game:false,preview:{schema:1,pr:53,sha,buildSha,basePath},pathname:basePath}:{game:false,pathname:'/'};
 const hub=relay(),host=client(hub,opts),friend=client(hub,opts);
 t.after(()=>{host.context.ui?.room.leave();friend.context.room?.leave();host.close();friend.close();});
 const nodes=attachCanvasDOM(host);
 host.run("window.ui=SpaceManJourneyUI.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test'}),build:SpaceManBuild,baseUrl:()=>location.origin+location.pathname});");
 assert.equal(await host.context.ui.room.hosting(2),true);
 const qr=nodes.find(n=>n.id==='journeyInviteQr');assert.ok(qr);assert.equal(qr.hidden,false);
 const decoded=decodePixels(qr.width,qr.height,qr.getContext().pixels);
 assert.equal(decoded,host.net.info().link,'pixels contain full exact invite capability');
 assert.equal(new URL(decoded).pathname,previewMode?basePath:'/','correct production or revision-pinned route');
 friend.run("window.room=SpaceManJourneyRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test'}),build:SpaceManBuild,baseUrl:()=>location.origin+location.pathname});");
 assert.equal(await friend.context.room.join(decoded,0),true);
 await until(()=>friend.context.room.current&&friend.net.roster().some(r=>r.you));
 assert.equal(friend.net.info().roomId,host.net.info().roomId);
 assert.equal(friend.context.room.current.mode,host.context.ui.room.current.mode);
 assert.equal(friend.context.room.current.phase,'lobby');
 host.context.ui.room.leave();
 await until(()=>qr.hidden,'leaving clears the QR');
 assert.equal(qr.getContext().pixels.some(v=>v!==0),false,'old capability pixels cleared');
});

test('Journey QR changes with link, hides for guests, and refuses truncation with a copy fallback',t=>{
 const c=client(relay(),{game:false});t.after(()=>c.close());const nodes=attachCanvasDOM(c);let update;
 c.context.SpaceManJourneyRoom={create(opts){update=opts.onChange;return {leave(){},status(){return{};}};}};
 c.run('window.ui=SpaceManJourneyUI.create({});');
 const status=link=>({active:true,host:true,info:{link,role:0,players:1,spectators:0},journey:{phase:'lobby'},pendingRole:null,roster:[]});
 const qr=nodes.find(n=>n.id==='journeyInviteQr'),caption=nodes.find(n=>n.tagName==='FIGCAPTION');
 for(const link of ['https://space.test/#j=first','https://space.test/pr/53/revision/build/#j=next']){update(status(link));assert.equal(qr.hidden,false);assert.equal(decodePixels(qr.width,qr.height,qr.getContext().pixels),link);}
 const prefix='https://space.test/#j=',boundary=prefix+'x'.repeat(412-prefix.length);
 update(status(boundary));assert.equal(qr.hidden,false);assert.equal(decodePixels(qr.width,qr.height,qr.getContext().pixels),boundary,'maximum supported link is not truncated');
 const long=boundary+'x';update(status(long));
 assert.equal(qr.hidden,true);assert.match(caption.textContent,/too long.*Copy the full/);
 assert.equal(nodes.find(n=>n.tagName==='INPUT'&&n.readOnly).value,long,'copy source remains unmodified');
 update(status(prefix+'🚀'.repeat(120)));assert.equal(qr.hidden,true,'guard counts UTF-8 bytes, not string characters');
 update({...status('https://space.test/#j=guest'),host:false});assert.equal(qr.hidden,true);
 assert.equal(qr.getContext().pixels.some(v=>v!==0),false);
});
