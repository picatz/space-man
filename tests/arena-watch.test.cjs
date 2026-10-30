const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/arena-ui.js'),'utf8');
function view(actors,{format='free',local=null,id=1,roomStatus=null}={}){
 const context=vm.createContext({local2:null,state:{actors,format},onlineActive:()=>true,localActor:()=>local,spectatorId:id,camera:{initialized:true},roomStatus,painted:'',paintWatch(t){context.painted=t.name;},announced:[],announce(t){context.announced.push(t);},updateHud(){}});
 vm.runInContext(source.slice(source.indexOf('    function watchCandidates()'),source.indexOf('    function resetRoomPresentation()'))+source.slice(source.indexOf('    function watchedActor()'),source.indexOf('    function updateCamera(')),context);
 return context;
}
const actor=(id,extra={})=>({id,name:'Fighter '+id,controller:'cpu',team:0,stocks:3,respawnTicks:0,...extra});
test('Next skips respawning fighters and really follows the chosen boss after the camera updates',()=>{
 const actors=[actor(1),actor(2,{respawnTicks:60}),actor(3,{boss:{phase:'charging'}}),actor(4)];
 const before=JSON.stringify(actors),v=view(actors);
 v.cycleWatch(1);assert.equal(v.spectatorId,3);assert.equal(v.watchedActor().id,3);assert.equal(v.painted,'Fighter 3');
 v.cycleWatch(1);assert.equal(v.watchedActor().id,4);v.cycleWatch(-1);assert.equal(v.watchedActor().id,3);
 assert.equal(JSON.stringify(actors),before,'camera selection never mutates fighters');
});
test('a defeated team member cycles the same living allies that the camera allows',()=>{
 const v=view([actor(1,{controller:'human',stocks:0}),actor(2),actor(3,{team:1}),actor(4)],{format:'teams',local:{id:1},id:2});
 v.cycleWatch(1);assert.equal(v.watchedActor().id,4);v.cycleWatch(1);assert.equal(v.watchedActor().id,2);
});
test('selection removal and an entirely respawning roster have safe deterministic fallback',()=>{
 const v=view([actor(1),actor(2,{respawnTicks:30}),actor(3)],{id:2});
 v.cycleWatch(-1);assert.equal(v.watchedActor().id,3);v.spectatorId=2;v.cycleWatch(1);assert.equal(v.watchedActor().id,1);
 v.state.actors.forEach(a=>a.respawnTicks=30);const before=v.spectatorId;v.cycleWatch(1);assert.equal(v.spectatorId,before);assert.ok(v.watchedActor());
});

test('A queued friend sees UP NEXT on the watch bar while they wait for the next lobby',()=>{
 const v=view([actor(1),actor(2)],{roomStatus:{info:{waiting:true}}});
 v.cycleWatch(1);assert.equal(v.painted,'Fighter 2');assert.equal(v.watchLabel(),'UP NEXT · WATCHING');
});

test('a roster card follows that fighter; out or respawning fighters are not selectable',()=>{
 const v=view([actor(1,{controller:'human',stocks:0}),actor(2),actor(3,{respawnTicks:40}),actor(4)],{local:{id:1},id:2});
 assert.equal(v.watchActor(4),true);assert.equal(v.watchedActor().id,4);assert.equal(v.painted,'Fighter 4');
 assert.deepEqual(v.announced,['Watching Fighter 4']);
 assert.equal(v.watchActor(1),false);assert.equal(v.watchActor(3),false);assert.equal(v.watchedActor().id,4,'a rejected tap keeps the current fighter');
 assert.equal(v.watchActor(4),true);assert.equal(v.announced.length,1,'re-picking the same fighter is not re-announced');
});
