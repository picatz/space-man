/* Arena authority boundary: only a host owns a simulation. Guests send bounded
 * commands; snapshots are display data, never host collision/scoring inputs. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./arena.js'):root.SpaceManArena);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SpaceManArenaOnline=api;
})(typeof window!=='undefined'?window:globalThis,function(Arena){
  'use strict';
  const VERSION=1,INPUT=1,SNAPSHOT=2,MAX_BYTES=1024,INPUT_BYTES=23,HEADER_BYTES=27,ACTOR_BYTES=63,EVENT_BYTES=18;
  // Shared-expedition packets have their own opt-in version. The standalone
  // VERSION 1 layout and 1024-byte cap remain byte-for-byte unchanged.
  const JOURNEY_VERSION=2,JOURNEY_MAX_BYTES=990,JOURNEY_HEADER_BYTES=35,JOURNEY_EVENT_BYTES=20,BOSS_BYTES=30;
  const BOSS_PHASES=['idle','charging','active','recover','defeated'],BOSS_MOVES=['shockwave','lance'];
  const INPUT_TTL_MS=200,REJOIN_MS=10000,SNAPSHOT_MS=50;
  const FORMATS=['duel','ffa','teams'],DIFFICULTIES=['easy','normal','hard'],PHASES=['countdown','playing','over'],EVENTS=['jump','attack','hit','ringout','respawn','finish'];
  const JOURNEY_EVENTS=EVENTS.concat(['boss-warning','boss-strike','boss-exposed','boss-defeated']);
  const uint=(n,max=0xffffffff)=>Number.isInteger(n)&&n>=0&&n<=max;
  const blank=()=>Arena.normalizeCommand();
  function configuration(options){
    const o=options||{},rules={arenaId:Arena.getArena(o.arenaId).id,format:FORMATS.includes(o.format)?o.format:'duel',difficulty:DIFFICULTIES.includes(o.difficulty)?o.difficulty:'normal'};
    if(o.encounter==='boss'||o.encounter==='skirmish'){
      const s=Arena.create(Object.assign({},o,rules)),e=s.encounter;
      Object.assign(rules,{format:s.format,encounter:e.type,durationTicks:e.durationTicks,countdownTicks:e.countdownTicks,stocks:e.stocks});
      if(e.type==='boss'){Object.assign(rules,{bossTier:e.bossTier,wingmate:e.wingmate});if(e.crewCount!==undefined)rules.crewCount=e.crewCount;}
    }
    return rules;
  }
  function encodeInput(o,options){
    const c=Arena.normalizeCommand(o.command),b=new Uint8Array(INPUT_BYTES),v=new DataView(b.buffer);b[0]=options&&options.journey?JOURNEY_VERSION:VERSION;b[1]=INPUT;
    v.setUint32(2,o.epoch,true);v.setUint32(6,o.seq,true);v.setUint32(10,o.tick,true);v.setInt8(14,Math.round(c.moveX*127));v.setInt8(15,Math.round(c.moveY*127));b[16]=c.jumpHeld?1:0;
    v.setUint16(17,o.edges[0],true);v.setUint16(19,o.edges[1],true);v.setUint16(21,o.edges[2],true);return b;
  }
  function decodeInput(b,options){
    if(!(b instanceof Uint8Array)||b.length!==INPUT_BYTES||b[0]!==(options&&options.journey?JOURNEY_VERSION:VERSION)||b[1]!==INPUT||b[16]>1)return null;
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    return{epoch:v.getUint32(2,true),seq:v.getUint32(6,true),tick:v.getUint32(10,true),edges:[v.getUint16(17,true),v.getUint16(19,true),v.getUint16(21,true)],command:Arena.normalizeCommand({moveX:v.getInt8(14)/127,moveY:v.getInt8(15)/127,jumpHeld:!!b[16]})};
  }
  function encodeSnapshot(host){
    const s=host.state,journey=host.journey===true,headerBytes=journey?JOURNEY_HEADER_BYTES:HEADER_BYTES,eventBytes=journey?JOURNEY_EVENT_BYTES:EVENT_BYTES,eventTypes=journey?JOURNEY_EVENTS:EVENTS;
    const boss=journey&&s.actors.find(a=>a.boss),events=host.events.slice(-12),b=new Uint8Array(headerBytes+ACTOR_BYTES*s.actors.length+(boss?BOSS_BYTES:0)+eventBytes*events.length),v=new DataView(b.buffer);
    b[0]=journey?JOURNEY_VERSION:VERSION;b[1]=SNAPSHOT;v.setUint32(2,host.revision,true);v.setUint32(6,host.epoch,true);v.setUint32(10,s.tick,true);
    b[14]=Arena.arenas.findIndex(a=>a.id===s.arenaId);b[15]=FORMATS.indexOf(s.format);b[16]=DIFFICULTIES.indexOf(s.difficulty);b[17]=host.status==='lobby'?0:host.status==='paused'?2:1;b[18]=PHASES.indexOf(s.phase);
    v.setUint16(19,s.countdownTicks,true);v.setUint16(21,s.timeLeftTicks,true);b[23]=s.actors.length;b[24]=s.result?s.result.winnerIds.reduce((m,id)=>m|(1<<(id-1)),0):0;b[25]=!s.result?0:(s.result.reason==='time'?2:1)|(s.result.tie?4:0);b[26]=events.length;
    if(journey){const e=s.encounter;b[27]=!e?0:e.type==='boss'?2:1;if(e){v.setUint16(28,e.durationTicks,true);b[30]=e.countdownTicks;b[31]=e.stocks;b[32]=e.bossTier||0;b[33]=e.wingmate?1:0;b[34]=e.crewCount||0;}}
    let o=headerBytes;
    for(const a of s.actors){
      const seat=host.seats.find(p=>p.actorId===a.id);b[o]=a.id;b[o+1]=seat?seat.p:0;b[o+2]=seat&&!seat.connected?1:0;v.setUint32(o+3,seat?seat.seq:0,true);
      for(const[i,k]of['x','y','px','py','vx','vy'].entries())v.setFloat32(o+7+i*4,a[k],true);v.setUint16(o+31,a.damage,true);
      for(const[i,k]of['stocks','deaths','kos','stun','invulnerable','attackTicks','dashTicks','dashCooldown','respawnTicks','jumpCount'].entries())b[o+33+i]=a[k];
      v.setInt16(o+43,Math.round(a.attackDirX*32767),true);v.setInt16(o+45,Math.round(a.attackDirY*32767),true);b[o+47]=(a.onGround?1:0)|(a.airDashAvailable?2:0)|(a.facing>0?4:0);v.setUint32(o+48,a.attackSerial,true);b[o+52]=a.lastHitBy||0;v.setUint32(o+53,seat?seat.lastAcceptedTick:0,true);
      for(let i=0;i<3;i++)v.setUint16(o+57+i*2,seat?seat.edges[i]:0,true);o+=ACTOR_BYTES;
    }
    if(boss){const a=boss.boss;b[o]=BOSS_PHASES.indexOf(a.phase);b[o+1]=BOSS_MOVES.indexOf(a.move);b[o+2]=a.phaseTicks;b[o+3]=a.phaseDuration;v.setUint16(o+4,a.health,true);v.setUint16(o+6,a.maxHealth,true);v.setUint32(o+8,a.cycle,true);b[o+12]=a.attack?1:0;if(a.attack)for(const[i,k]of['x','y','w','h'].entries())v.setFloat32(o+13+i*4,a.attack[k],true);b[o+29]=a.hitIds.reduce((mask,id)=>mask|(1<<(id-1)),0);o+=BOSS_BYTES;}
    for(const e of events){v.setUint32(o,e.serial,true);b[o+4]=eventTypes.indexOf(e.type);b[o+5]=e.actorId||0;b[o+6]=e.targetId||0;v.setFloat32(o+7,e.x,true);v.setFloat32(o+11,e.y,true);b[o+15]=e.stocks||0;b[o+16]=e.double?1:0;b[o+17]=e.damage||0;if(journey){b[o+18]=e.move?BOSS_MOVES.indexOf(e.move)+1:0;b[o+19]=e.ticks||0;}o+=eventBytes;}
    return b;
  }
  function decodeSnapshot(b,options){
    const journey=!!(options&&options.journey),headerBytes=journey?JOURNEY_HEADER_BYTES:HEADER_BYTES,eventBytes=journey?JOURNEY_EVENT_BYTES:EVENT_BYTES,eventTypes=journey?JOURNEY_EVENTS:EVENTS;
    if(!(b instanceof Uint8Array)||b.length<headerBytes||b.length>(journey?JOURNEY_MAX_BYTES:MAX_BYTES)||b[0]!==(journey?JOURNEY_VERSION:VERSION)||b[1]!==SNAPSHOT)return null;
    if(!Arena.arenas[b[14]]||!FORMATS[b[15]]||!DIFFICULTIES[b[16]]||b[17]>2||!PHASES[b[18]]||b[26]>12||b[25]>6)return null;
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),config={arenaId:Arena.arenas[b[14]].id,format:FORMATS[b[15]],difficulty:DIFFICULTIES[b[16]]};
    if(journey){
      if(b[27]>2)return null;
      if(b[27]){
        Object.assign(config,{encounter:b[27]===2?'boss':'skirmish',durationTicks:v.getUint16(28,true),countdownTicks:b[30],stocks:b[31]});
        if(config.durationTicks<900||config.durationTicks>5400||config.countdownTicks>180||config.stocks<1||config.stocks>3)return null;
        if(b[27]===2){if(b[32]<1||b[32]>5||b[33]>1||b[34]>4||config.format!=='teams')return null;config.bossTier=b[32];config.wingmate=!!b[33];if(b[34]){config.crewCount=b[34];if(config.wingmate!==(config.crewCount>1))return null;}}
        else if(b[32]||b[33]||b[34])return null;
      }else if(Array.from(b.subarray(28,35)).some(Boolean))return null;
      if(options.config&&JSON.stringify(configuration(options.config))!==JSON.stringify(configuration(config)))return null;
    }
    const state=Arena.create(config),boss=journey&&state.actors.find(a=>a.boss);
    if(b[23]!==state.actors.length||b[24]>((1<<state.actors.length)-1)||b.length!==headerBytes+b[23]*ACTOR_BYTES+(boss?BOSS_BYTES:0)+b[26]*eventBytes)return null;
    state.tick=v.getUint32(10,true);state.phase=PHASES[b[18]];state.countdownTicks=v.getUint16(19,true);state.timeLeftTicks=v.getUint16(21,true);
    if(state.countdownTicks>(state.encounter?state.encounter.countdownTicks:Arena.constants.COUNTDOWN_TICKS)||state.timeLeftTicks>(state.encounter?state.encounter.durationTicks:Arena.constants.MATCH_TICKS)||state.tick>60*60*24)return null;
    const seats=[],seenP=new Set();let o=headerBytes;
    for(const a of state.actors){
      if(b[o]!==a.id||(a.boss&&b[o+1])||b[o+1]>48||b[o+2]>1||(b[o+1]&&seenP.has(b[o+1])))return null;
      if(b[o+1]){seenP.add(b[o+1]);seats.push({p:b[o+1],actorId:a.id,connected:!b[o+2],seq:v.getUint32(o+3,true),lastAcceptedTick:v.getUint32(o+53,true),edges:[v.getUint16(o+57,true),v.getUint16(o+59,true),v.getUint16(o+61,true)]});}
      a.controller=b[o+1]?'remote':'cpu';
      for(const[i,k]of['x','y','px','py','vx','vy'].entries()){a[k]=v.getFloat32(o+7+i*4,true);if(!Number.isFinite(a[k])||Math.abs(a[k])>8192)return null;}
      a.damage=v.getUint16(o+31,true);if(a.damage>999)return null;
      for(const[i,k]of['stocks','deaths','kos','stun','invulnerable','attackTicks','dashTicks','dashCooldown','respawnTicks','jumpCount'].entries())a[k]=b[o+33+i];
      if(a.stocks>3||a.attackTicks>Arena.constants.ATTACK_TICKS||a.dashTicks>Arena.constants.DASH_TICKS||a.jumpCount>2||b[o+47]>7||b[o+52]>(journey?state.actors.length:4))return null;
      a.attackDirX=v.getInt16(o+43,true)/32767;a.attackDirY=v.getInt16(o+45,true)/32767;a.onGround=!!(b[o+47]&1);a.airDashAvailable=!!(b[o+47]&2);a.facing=b[o+47]&4?1:-1;a.attackSerial=v.getUint32(o+48,true);a.lastHitBy=b[o+52]||null;o+=ACTOR_BYTES;
    }
    if(boss){
      const a=boss.boss,health=v.getUint16(o+4,true),maxHealth=v.getUint16(o+6,true);
      if(!BOSS_PHASES[b[o]]||!BOSS_MOVES[b[o+1]]||b[o+2]>b[o+3]||b[o+3]>78||maxHealth!==a.maxHealth||health>maxHealth||b[o+12]>1||b[o+29]>((1<<(boss.id-1))-1))return null;
      Object.assign(a,{phase:BOSS_PHASES[b[o]],move:BOSS_MOVES[b[o+1]],phaseTicks:b[o+2],phaseDuration:b[o+3],health,cycle:v.getUint32(o+8,true),attack:null,hitIds:state.actors.filter(x=>x.id!==boss.id&&(b[o+29]&(1<<(x.id-1)))).map(x=>x.id)});
      if(b[o+12]){a.attack={};for(const[i,k]of['x','y','w','h'].entries()){a.attack[k]=v.getFloat32(o+13+i*4,true);if(!Number.isFinite(a.attack[k])||Math.abs(a.attack[k])>8192)return null;}if(a.attack.w<=0||a.attack.h<=0||a.attack.w>1000||a.attack.h>2000)return null;}
      else if(Array.from(b.subarray(o+13,o+29)).some(Boolean))return null;
      if(((a.phase==='charging'||a.phase==='active'||a.phase==='recover')&&!a.attack)||((a.phase==='idle'||a.phase==='defeated')&&a.attack)||(a.phase==='defeated')!==(a.health===0)||boss.stocks!==(a.health>0?1:0))return null;
      o+=BOSS_BYTES;
    }
    state.events=[];
    for(let i=0;i<b[26];i++){
      const e={serial:v.getUint32(o,true),type:eventTypes[b[o+4]],actorId:b[o+5],targetId:b[o+6]||null,x:v.getFloat32(o+7,true),y:v.getFloat32(o+11,true),stocks:b[o+15],double:!!b[o+16],damage:b[o+17]};
      if(!e.type||e.actorId>(journey?state.actors.length:4)||e.targetId>(journey?state.actors.length:4)||!Number.isFinite(e.x)||!Number.isFinite(e.y)||Math.abs(e.x)>8192||Math.abs(e.y)>8192||(i&&e.serial<=state.events[i-1].serial))return null;if(journey){if(b[o+18]>2||b[o+19]>78)return null;if(b[o+18])e.move=BOSS_MOVES[b[o+18]-1];if(b[o+19])e.ticks=b[o+19];if(boss&&e.targetId===boss.id&&e.type==='hit')e.boss=true;}state.events.push(e);o+=eventBytes;
    }
    const winners=state.actors.filter(a=>b[24]&(1<<(a.id-1))).map(a=>a.id);
    state.result=b[25]?{winnerIds:winners,winnerTeam:state.format==='teams'&&!(b[25]&4)&&winners.length?state.actors[winners[0]-1].team:null,tie:!!(b[25]&4),reason:(b[25]&3)===2?'time':'stocks'}:null;
    if((state.phase==='over')!==!!state.result)return null;
    return{revision:v.getUint32(2,true),epoch:v.getUint32(6,true),status:['lobby','running','paused'][b[17]],state,seats};
  }
  function createHost(options,mode){
    const journey=!!(mode&&mode.journey),inputOptions={journey},eventTypes=journey?JOURNEY_EVENTS:EVENTS;
    // Only the explicit journey authority may create expedition variants.
    const cleanRules=(next)=>{const config=Object.assign({},next);if(!journey)for(const key of ['encounter','durationTicks','countdownTicks','stocks','bossTier','wingmate','crewCount'])delete config[key];return configuration(config);};
    let rules=cleanRules(options),roster=[],epoch=0,revision=0,status='lobby',eventSerial=0,events=[];
    let state=Arena.create(rules),seats=[];const teamChoices=new Map();
    function assign(){
      const players=roster.filter(r=>r.role===0).sort((a,b)=>a.p-b.p),order=[1,2,3,4];
      if(rules.format==='teams'&&rules.encounter!=='boss'){const counts=[0,0];for(const[i,r]of players.slice(0,4).entries()){let team=teamChoices.get(r.identity);if(![0,1].includes(team)||counts[team]>=2)team=counts[0]<=counts[1]?0:1;order[i]=(team===0?1:3)+counts[team]++;teamChoices.set(r.identity,team);}}
      seats=players.slice(0,state.actors.filter(a=>!a.boss).length).map((r,i)=>({p:r.p,identity:r.identity,actorId:order[i],connected:true,disconnectedAt:null,seq:0,edges:[0,0,0],pending:[false,false,false],command:blank(),receivedAt:-Infinity,lastAcceptedTick:0,bucket:12,bucketAt:0}));
      for(const a of state.actors)a.controller=seats.some(s=>s.actorId===a.id)?'human':'cpu';
    }
    function forfeit(seat,now){if(state.phase!=='over'&&!seat.connected&&seat.disconnectedAt!==null&&now-seat.disconnectedAt>=REJOIN_MS){const a=state.actors.find(a=>a.id===seat.actorId);a.stocks=0;a.damage=0;a.attackTicks=0;a.dashTicks=0;a.respawnTicks=0;}}
    function syncRoster(rows,now){
      const seenP=new Set(),seenIdentity=new Set();
      roster=(Array.isArray(rows)?rows:[]).filter(r=>{if(!r||!uint(r.p,48)||r.p===0||(r.role!==0&&r.role!==1)||typeof r.identity!=='string'||!r.identity||r.identity.length>128||seenP.has(r.p)||seenIdentity.has(r.identity))return false;seenP.add(r.p);seenIdentity.add(r.identity);return true;}).slice(0,48).map(r=>({p:r.p,role:r.role,identity:r.identity}));
      if(status==='lobby'){for(const identity of teamChoices.keys())if(!roster.some(r=>r.identity===identity))teamChoices.delete(identity);state=Arena.create(rules);assign();}
      else for(const seat of seats){forfeit(seat,now);const connected=roster.some(r=>r.p===seat.p&&r.identity===seat.identity&&r.role===0);if(connected!==seat.connected){seat.connected=connected;seat.command=blank();seat.pending=[false,false,false];seat.receivedAt=-Infinity;seat.disconnectedAt=connected?null:now;}}
    }
    function configure(next){if(status!=='lobby')return false;rules=cleanRules(next);state=Arena.create(rules);assign();return true;}
    function setTeam(p,team){if(status!=='lobby'||rules.format!=='teams'||rules.encounter==='boss'||![0,1].includes(team))return false;const seat=seats.find(s=>s.p===p);if(!seat)return false;const old=state.actors.find(a=>a.id===seat.actorId).team;if(old===team)return true;const target=seats.filter(s=>state.actors.find(a=>a.id===s.actorId).team===team);if(target.length>=2)teamChoices.set(target[target.length-1].identity,old);teamChoices.set(seat.identity,team);assign();return true;}
    function resetCommands(){for(const s of seats)Object.assign(s,{seq:0,edges:[0,0,0],pending:[false,false,false],command:blank(),receivedAt:-Infinity,lastAcceptedTick:0,bucket:12,bucketAt:0});}
    function start(seed){if(roster.filter(r=>r.role===0).length>state.actors.filter(a=>!a.boss).length)return false;epoch++;status='running';state=Arena.create(Object.assign({},rules,{seed}));events=[];assign();return true;}
    function lobby(){epoch++;status='lobby';events=[];state=Arena.create(rules);assign();}
    function pause(on){if(status==='lobby'||state.phase==='over')return false;if((status==='paused')===!!on)return true;status=on?'paused':'running';epoch++;resetCommands();return true;}
    function receive(p,identity,bytes,now){
      const input=decodeInput(bytes,inputOptions),seat=seats.find(s=>s.p===p&&s.identity===identity&&s.connected);
      if(!input||!seat||status!=='running'||state.phase==='over'||input.epoch!==epoch||!input.seq||input.seq<=seat.seq||input.seq-seat.seq>3600||input.tick+120<state.tick||input.tick>state.tick+12)return false;
      seat.bucket=Math.min(12,seat.bucket+Math.max(0,now-seat.bucketAt)*.06);seat.bucketAt=now;if(seat.bucket<1)return false;
      for(let i=0;i<3;i++)if(input.edges[i]<seat.edges[i]||input.edges[i]-seat.edges[i]>Math.min(120,input.seq-seat.seq))return false;
      seat.bucket--;for(let i=0;i<3;i++){seat.pending[i]||=input.edges[i]>seat.edges[i];seat.edges[i]=input.edges[i];}seat.seq=input.seq;seat.command=input.command;seat.receivedAt=now;seat.lastAcceptedTick=state.tick;return true;
    }
    function step(now){
      if(status!=='running'||state.phase==='over')return state;const commands={};
      for(const a of state.actors){const seat=seats.find(s=>s.actorId===a.id);if(!seat){commands[a.id]=Arena.cpuInput(state,a.id);continue;}forfeit(seat,now);commands[a.id]=seat.connected&&now-seat.receivedAt<=INPUT_TTL_MS?Object.assign({},seat.command,{jumpPressed:seat.pending[0],attackPressed:seat.pending[1],dashPressed:seat.pending[2]}):blank();seat.pending=[false,false,false];}
      Arena.step(state,commands);for(const e of state.events)if(eventTypes.includes(e.type)){e.serial=++eventSerial;events.push(Object.assign({},e));}events=events.slice(-12);return state;
    }
    const host={journey,syncRoster,configure,setTeam,start,lobby,pause,receive,step,packet(){revision++;return encodeSnapshot(host);},get state(){return state;},get status(){return status;},get seats(){return seats;},get epoch(){return epoch;},get revision(){return revision;},get events(){return events;}};return host;
  }
  function createClient(options){
    let current=null,eventSerial=0,seq=0,edges=[0,0,0];
    function accept(bytes,sender=1){if(sender!==1)return null;const next=decodeSnapshot(bytes,options);if(!next||(current&&(next.revision<=current.revision||next.epoch<current.epoch||(next.epoch===current.epoch&&next.state.tick<current.state.tick))))return null;if(!current||next.epoch!==current.epoch){seq=0;edges=[0,0,0];}next.state.events=next.state.events.filter(e=>e.serial>eventSerial);for(const e of next.state.events)eventSerial=Math.max(eventSerial,e.serial);current=next;return next;}
    function input(command,p){if(!current||current.status!=='running'||current.state.phase==='over'||!current.seats.some(s=>s.p===p&&s.connected))return null;const seat=current.seats.find(s=>s.p===p);seq=Math.max(seq,seat.seq);for(let i=0;i<3;i++)edges[i]=Math.max(edges[i],seat.edges[i]);const c=Arena.normalizeCommand(command);for(const[i,k]of['jumpPressed','attackPressed','dashPressed'].entries())if(c[k])edges[i]=Math.min(65535,edges[i]+1);return encodeInput({epoch:current.epoch,seq:++seq,tick:current.state.tick,edges,command:c},options);}
    return{accept,input,get current(){return current;}};
  }
  return Object.freeze({VERSION,JOURNEY_VERSION,JOURNEY_MAX_BYTES,MAX_BYTES,INPUT_BYTES,INPUT_TTL_MS,REJOIN_MS,SNAPSHOT_MS,configuration,encodeInput,decodeInput,encodeSnapshot,decodeSnapshot,createHost,createClient});
});
