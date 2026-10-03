/* One authenticated session across engine changes. The outer epoch scopes every
 * inner engine packet; only the host chooses the encounter and active clock.
 * Runner samples are shared presence, never authoritative scores or commands. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./expedition.js'):root.SpaceManExpedition,node?require('./arena-online.js'):root.SpaceManArenaOnline,node?require('./race-online.js'):root.SpaceManRaceOnline);
  if(node)module.exports=api;else root.SpaceManJourneyOnline=api;
})(typeof window!=='undefined'?window:globalThis,function(Director,Arena,Race){
  'use strict';
  const VERSION=1,HEADER=34,MAX_BYTES=1024,INPUT=1,SNAPSHOT=2,READY=3;
  const MODES=['runner','arena','race'],PHASES=['lobby','barrier','running','paused'];
  const MIN_BARRIER_MS=900,MAX_BARRIER_MS=3500,MAX_INDEX=1000000;
  const uint=(n,max=0xffffffff)=>Number.isInteger(n)&&n>=0&&n<=max;
  function encounter(seed,index){return Director.encounterAt(seed,index);}
  function encode(o,payload=new Uint8Array()){
    if(!uint(o.session)||!o.session||!uint(o.epoch)||!uint(o.index,MAX_INDEX)||!uint(o.seed)||!uint(o.revision)||!uint(o.tick)||!MODES.includes(o.mode)||!PHASES.includes(o.phase)||![INPUT,SNAPSHOT,READY].includes(o.type)||!(payload instanceof Uint8Array)||payload.length>MAX_BYTES-HEADER)return null;
    const b=new Uint8Array(HEADER+payload.length),v=new DataView(b.buffer);b[0]=VERSION;b[1]=o.type;
    for(const[k,pos]of[['session',2],['epoch',6],['index',10],['seed',14],['revision',18],['tick',24],['players',28]])v.setUint32(pos,o[k]>>>0,true);
    b[22]=MODES.indexOf(o.mode);b[23]=PHASES.indexOf(o.phase);v.setUint16(32,payload.length,true);b.set(payload,HEADER);return b;
  }
  function decode(b){
    if(!(b instanceof Uint8Array)||b.length<HEADER||b.length>MAX_BYTES||b[0]!==VERSION||![INPUT,SNAPSHOT,READY].includes(b[1])||!MODES[b[22]]||!PHASES[b[23]])return null;
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),o={type:b[1],mode:MODES[b[22]],phase:PHASES[b[23]],payload:b.slice(HEADER)};
    for(const[k,pos]of[['session',2],['epoch',6],['index',10],['seed',14],['revision',18],['tick',24],['players',28]])o[k]=v.getUint32(pos,true);
    if(!o.session||o.index>MAX_INDEX||v.getUint16(32,true)!==o.payload.length||(o.type===READY&&o.payload.length))return null;
    const e=encounter(o.seed,o.index);if(!e||e.id!==o.mode)return null;return o;
  }
  const hasPlayer=(mask,p)=>uint(p,32)&&p>0&&!!(mask&(1<<(p-1)));
  function runnerSample(raw){
    if(!raw||!['x','y','vx','vy','score','dist','frame'].every(k=>Number.isFinite(raw[k]))||Math.abs(raw.x)>1e7||Math.abs(raw.y)>1e5||Math.abs(raw.vx)>1e4||Math.abs(raw.vy)>1e4||raw.score<0||raw.score>1e8||raw.dist<0||raw.dist>1e6||!uint(raw.frame)||!uint(raw.state,31)||!uint(raw.chain,255))return null;
    return{x:raw.x,y:raw.y,vx:raw.vx,vy:raw.vy,score:Math.floor(raw.score),dist:Math.floor(raw.dist),frame:raw.frame,state:raw.state,chain:raw.chain};
  }
  function encodeRunner(rows){
    if(!Array.isArray(rows)||rows.length>4)return null;const b=new Uint8Array(1+rows.length*32),v=new DataView(b.buffer);b[0]=rows.length;let i=1;
    for(const r of rows){if(!uint(r.p,32)||!r.p||!runnerSample(r))return null;b[i]=r.p;b[i+1]=r.state;b[i+2]=r.chain;b[i+3]=0;['x','y','vx','vy'].forEach((k,n)=>v.setFloat32(i+4+n*4,r[k],true));v.setUint32(i+20,r.score,true);v.setUint32(i+24,r.dist,true);v.setUint32(i+28,r.frame,true);i+=32;}return b;
  }
  function decodeRunner(b){
    if(!(b instanceof Uint8Array)||!b.length||b[0]>4||b.length!==1+32*b[0])return null;const v=new DataView(b.buffer,b.byteOffset,b.byteLength),rows=[],seen=new Set();
    for(let i=1;i<b.length;i+=32){const r={p:b[i],state:b[i+1],chain:b[i+2],score:v.getUint32(i+20,true),dist:v.getUint32(i+24,true),frame:v.getUint32(i+28,true)};['x','y','vx','vy'].forEach((k,n)=>r[k]=v.getFloat32(i+4+n*4,true));if(!r.p||r.p>32||b[i+3]||seen.has(r.p)||!runnerSample(r))return null;seen.add(r.p);rows.push(r);}return rows;
  }
  function validRoster(rows){const ids=new Set(),ps=new Set();return(Array.isArray(rows)?rows:[]).filter(r=>{if(!r||!uint(r.p,32)||!r.p||![0,1].includes(r.role)||typeof r.identity!=='string'||!r.identity||r.identity.length>128||ids.has(r.identity)||ps.has(r.p))return false;ids.add(r.identity);ps.add(r.p);return true;}).slice(0,8).map(r=>({...r}));}
  function createHost(options={}){
    const seed=options.seed>>>0,session=options.session>>>0||1;let epoch=0,index=0,revision=0,tick=0,phase='lobby',config=encounter(seed,0),engine=null,rows=[],seats=[],barrierAt=0,lastNow=0;
    const ready=new Set(),samples=new Map(),runnerSeq=new Map();
    const engineAPI=()=>config.id==='arena'?Arena:config.id==='race'?Race:null;
    function syncRoster(value,now=lastNow){rows=validRoster(value);if(engine)engine.syncRoster(rows.filter(r=>seats.some(s=>s.identity===r.identity)),now);}
    function prepare(now){if(epoch===0xffffffff||index>MAX_INDEX)return false;epoch++;tick=0;phase='barrier';barrierAt=now;config=encounter(seed,index);engine=null;seats=[];ready.clear();samples.clear();runnerSeq.clear();return true;}
    function start(now=0){if(phase!=='lobby'||!Number.isFinite(now)||now<0)return false;lastNow=now;return prepare(now);}
    function launch(){
      seats=rows.filter(r=>r.role===0&&ready.has(r.identity)).slice(0,4);const api=engineAPI();
      if(api){engine=api.createHost(config.id==='arena'?{...config,format:config.encounter==='boss'?'teams':config.format==='duel'?'ffa':config.format,crewCount:4}:config,{journey:true});engine.syncRoster(seats,lastNow);if(config.format==='teams'&&engine.setTeam){for(let i=0;i<seats.length;i++)engine.setTeam(seats[i].p,i<2?0:1);}engine.start(config.seed);}
      phase='running';tick=0;
    }
    function receive(p,identity,bytes,now=lastNow){
      const o=decode(bytes),row=rows.find(r=>r.p===p&&r.identity===identity&&r.role===0);
      if(!o||!row||o.session!==session||o.epoch!==epoch||o.index!==index||o.seed!==seed||o.mode!==config.id||!Number.isFinite(now)||now<0)return false;
      if(o.type===READY){if(phase!=='barrier')return false;ready.add(identity);return true;}
      if(o.type!==INPUT||phase!=='running'||!seats.some(s=>s.identity===identity&&s.p===p))return false;
      if(engine)return engine.receive(p,identity,o.payload,now);
      const rr=decodeRunner(o.payload);if(!rr||rr.length!==1||rr[0].p!==p||o.revision<=(runnerSeq.get(identity)||0))return false;
      runnerSeq.set(identity,o.revision);samples.set(identity,{...rr[0],state:rr[0].state|((samples.get(identity)?.state||0)&20),at:now});return true;
    }
    function step(now){
      if(!Number.isFinite(now)||now<lastNow)return false;lastNow=now;
      if(phase==='barrier'){
        const expected=rows.filter(r=>r.role===0).slice(0,4);
        if(now-barrierAt>=MAX_BARRIER_MS||(now-barrierAt>=MIN_BARRIER_MS&&expected.every(r=>ready.has(r.identity))))launch();
        return true;
      }
      if(phase!=='running')return false;tick++;
      if(engine)engine.step(now);
      const maxTicks=Math.max(60,Math.min(60*180,config.maxTicks||config.durationTicks||60*60));
      const finished=engine&&(engine.state.phase==='over'||engine.state.phase==='finished');
      const runnerDone=!engine&&tick>120&&seats.length>0&&seats.every(s=>{const r=samples.get(s.identity);return r&&(r.state&20);});
      if(finished||runnerDone||tick>=maxTicks){index++;return prepare(now);}return true;
    }
    function pause(on){if(!['running','paused'].includes(phase))return false;phase=on?'paused':'running';if(engine)engine.pause(on);return true;}
    function packet(){
      if(revision===0xffffffff)return null;const players=rows.filter(r=>r.role===0&&seats.some(s=>s.identity===r.identity)).reduce((m,r)=>m|(1<<(r.p-1)),0)>>>0;
      const payload=engine?engine.packet():encodeRunner(seats.map(s=>samples.get(s.identity)).filter(Boolean));
      return encode({type:SNAPSHOT,session,epoch,index,seed,revision:++revision,tick,players,phase,mode:config.id},payload||new Uint8Array());
    }
    return{syncRoster,start,receive,step,pause,packet,get config(){return config;},get phase(){return phase;},get epoch(){return epoch;},get index(){return index;},get engine(){return engine;},get seats(){return seats;}};
  }
  function createClient(){
    let current=null,engine=null,runner=[],seq=0;
    function accept(bytes,sender){
      if(sender!==1)return null;const o=decode(bytes);
      if(!o||o.type!==SNAPSHOT||(current&&(o.session!==current.session||o.seed!==current.seed||o.revision<=current.revision||o.epoch<current.epoch||o.index<current.index||(o.epoch===current.epoch&&(o.index!==current.index||o.mode!==current.mode||o.tick<current.tick)))))return null;
      const changed=!current||o.epoch!==current.epoch;
      let candidate=changed?null:engine,inner=null,rs=[];
      if(o.phase==='running'||o.phase==='paused'){
        if(o.mode==='runner'){rs=decodeRunner(o.payload);if(!rs||rs.some(r=>!hasPlayer(o.players,r.p)))return null;}
        else{const api=o.mode==='arena'?Arena:Race;candidate=candidate||api.createClient(o.mode==='arena'?{journey:true}:undefined);inner=candidate.accept(o.payload,1);if(!inner)return null;}
      }else if(o.payload.length!==1||o.payload[0]!==0)return null;
      if(changed)seq=0;engine=candidate;runner=rs;current={...o,config:encounter(o.seed,o.index),engine:inner,runner,changed};return current;
    }
    function message(type,payload){if(!current||seq===0xffffffff)return null;return encode({...current,type,revision:++seq},payload);}
    function ready(){return current&&current.phase==='barrier'?message(READY,new Uint8Array()):null;}
    function input(command,p){if(!current||current.phase!=='running'||!hasPlayer(current.players,p))return null;const payload=current.mode==='runner'?encodeRunner([{...command,p}]):engine.input(command,p);return payload?message(INPUT,payload):null;}
    return{accept,ready,input,get current(){return current;}};
  }
  return Object.freeze({VERSION,HEADER,MAX_BYTES,INPUT,SNAPSHOT,READY,MIN_BARRIER_MS,MAX_BARRIER_MS,encode,decode,encodeRunner,decodeRunner,hasPlayer,createHost,createClient});
});
