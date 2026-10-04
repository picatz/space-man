'use strict';
// Production input/lifecycle functions; only DOM/audio/browser objects are stubs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Arena=require('../src/arena.js');
const source=fs.readFileSync(require.resolve('../src/arena-ui.js'),'utf8');
function body(name,next){const start=source.indexOf('    function '+name+'('),end=source.indexOf('    function '+next+'(',start);assert.ok(start>=0&&end>start,name);return source.slice(start,end);}
function ui(guest=false){
 const physical={index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false}))};
 const state=Arena.create();state.phase='playing';state.tick=100;state.actors[0].attackTicks=5;state.actors[0].invulnerable=0;
 const node={classList:{add(){},remove(){}},style:{removeProperty(){}},setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){}};
 const c=vm.createContext({arena:Arena,actionBuffer:Arena.createActionBuffer(),state,held:new Map(),touches:new Map(),moveX:0,moveY:0,jumpEdge:false,attackEdge:false,dashEdge:false,touchEdges:{jump:false,attack:false,dash:false},stick:null,stickBase:node,stickKnob:{style:{}},recoveryTap:null,
  pad:{moveX:0,moveY:0,jump:false},padPrevious:{},padNeedsNeutral:true,lastPadId:null,currentPrefs:{},root:{navigator:{getGamepads:()=>[physical]}},rootEl:{dataset:{epoch:'1'},inert:false},inputSuspended:false,active:true,activeModal:null,paused:false,roomPaused:false,localRoomMenu:false,roomStatus:null,view:'match',matchSerial:1,usingTouch:false,thumbBounds:null,identityBoundsDirty:false,
  control:true,online:guest,room:{isHost:!guest,release(){},pause(){}},onlineActive(){return c.online;},canControl(){return c.control;},localActor(){return c.state.actors.find(a=>a.controller==='human');},isRunning(){return !c.paused&&c.state.phase!=='over';},isMatch:()=>true,sharedSession:null,
  clamp:(v,l,h)=>Math.max(l,Math.min(h,v)),performance:{now:()=>c.now},now:1000,document:{hidden:false},pausePanel:{querySelector:()=>({textContent:''})},audio:null,accumulator:0,lastTime:0,
  setModal(p){c.activeModal=p;},syncRoomChoices(){},announce(){},paint(){},unlockAudio(){},ensureFrame(){},focusStep(){},close(){},showLobby(){},resultPanel:{},resumeButton:{}});
 for(const [name,next]of[['resetTouchInput','resetInput'],['resetInput','ownsInput'],['ownsInput','focusables'],['actionForKey','actionHeld'],['actionHeld','onKeyDown'],['onKeyDown','onKeyUp'],['onKeyUp','escapeAction'],['escapeAction','guardPointer'],['buttonTouchDown','releaseTouch'],['releaseTouch','stickDown'],['pollGamepad','command'],['command','guardRecoveryClick'],['pauseMatch','resumeMatch'],['resumeMatch','showLobby']])vm.runInContext(body(name,next),c);
 function press(device,action){
  if(device==='keyboard')c.onKeyDown({code:action==='attack'?'KeyF':'KeyK',key:action==='attack'?'f':'k',repeat:false,preventDefault(){},stopImmediatePropagation(){}});
  if(device==='touch')c.buttonTouchDown({pointerType:'touch',pointerId:1,currentTarget:node,preventDefault(){},stopPropagation(){}},action);
  if(device==='gamepad'){physical.buttons[action==='attack'?2:1].pressed=true;c.pollGamepad();}
 }
 function release(device,action,type='pointerup'){
  if(device==='keyboard')c.onKeyUp({code:action==='attack'?'KeyF':'KeyK',key:action==='attack'?'f':'k',preventDefault(){},stopImmediatePropagation(){}});
  if(device==='touch')c.releaseTouch({pointerId:1,type});
  if(device==='gamepad'){physical.buttons[action==='attack'?2:1].pressed=false;c.pollGamepad();}
 }
 c.pollGamepad();
 return{c,physical,press,release,advance(){c.state.tick++;c.now+=1000/60;c.state.actors[0].attackTicks=Math.max(0,c.state.actors[0].attackTicks-1);}};
}
for(const role of ['offline','host'])for(const device of ['keyboard','touch','gamepad'])for(const action of ['attack','dash'])test(`${role} ${device} late ${action} tap is buffered once through actual input handler`,()=>{
 const x=ui();x.c.online=role==='host';const field=action==='attack'?'attackPressed':'dashPressed';x.press(device,action);
 assert.equal(x.c.command()[field],false);x.release(device,action);
 for(let n=1;n<=4;n++){x.advance();assert.equal(x.c.command()[field],n===4);}
 x.advance();assert.equal(x.c.command()[field],false);
});
for(const device of ['keyboard','touch','gamepad'])test(`${device} guest path preserves fresh edges without buffering stale snapshot guesses`,()=>{
 const x=ui(true);x.press(device,'attack');assert.equal(x.c.command().attackPressed,true);x.release(device,'attack');
 for(let n=0;n<7;n++){x.advance();assert.equal(x.c.command().attackPressed,false);}
});
for(const device of ['keyboard','touch','gamepad'])test(`${device} pause/resume clears intent and a held device cannot fire it`,()=>{
 const x=ui();x.press(device,'attack');x.c.command();x.c.pauseMatch('Match paused');assert.equal(x.c.paused,true);x.c.resumeMatch();assert.equal(x.c.paused,false);
 for(let n=0;n<7;n++){x.advance();if(device==='gamepad')x.c.pollGamepad();assert.equal(x.c.command().attackPressed,false);}
 x.release(device,'attack');x.press(device,'attack');assert.equal(x.c.command().attackPressed,true,'fresh press after neutral still works');
});
test('touch cancel after sampling clears pending intent while ordinary pointer-up preserves it',()=>{
 const x=ui();x.press('touch','attack');x.c.command();x.release('touch','attack','pointercancel');
 for(let n=0;n<7;n++){x.advance();assert.equal(x.c.command().attackPressed,false);}
});
test('UI generation, control loss and inert menu ownership cannot replay a pending intent',()=>{
 for(const reason of ['generation','control','inert']){
  const x=ui();x.press('keyboard','attack');x.c.command();x.release('keyboard','attack');
  if(reason==='generation')x.c.rootEl.dataset.epoch='2';if(reason==='control')x.c.control=false;if(reason==='inert')x.c.rootEl.inert=true;
  x.c.command();x.c.control=true;x.c.rootEl.inert=false;
  for(let n=0;n<7;n++){x.advance();assert.equal(x.c.command().attackPressed,false,reason);}
 }
});

test('host to guest to host ownership never transfers a queued action',()=>{
 const x=ui();x.c.online=true;x.press('keyboard','attack');x.c.command();x.release('keyboard','attack');
 x.c.room.isHost=false;x.c.command();x.c.room.isHost=true;
 for(let n=0;n<7;n++){x.advance();assert.equal(x.c.command().attackPressed,false);}
 x.press('keyboard','attack');assert.equal(x.c.command().attackPressed,true);
});
