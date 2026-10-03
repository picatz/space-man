/* Browser ownership for a continuous shared expedition. The transport and its
 * identities survive all encounters; adapters only attach/detach presentation. */
(function(root){
  'use strict';
  function create(options={}){
    const net=options.net,online=root.SpaceManJourneyOnline,listeners=new Set();
    let active=false,busy=false,host=null,client=online.createClient(),serial=0,off=null,timer=null,lastPublish=-Infinity,lastReceived=0,lastBeat=0,acc=0,error='',closedReason='',connection='',presented=null,encounterEpoch=-1,readyEpoch=-1,lastReady=-Infinity,lastInput=-Infinity,pendingRole=null;
    const now=()=>root.performance.now();
    const roster=()=>net.roster().map(r=>({...r,identity:r.p===1?'host':r.pubHex||'peer-'+r.p}));
    function info(){const i=net.info(),c=client.current;return{...i,role:c&&['running','paused'].includes(c.phase)&&!online.hasPlayer(c.players,i.myP)?1:i.role,seed:c?c.config.seed:i.seed,runId:c?c.epoch:i.runId};}
    function status(){return{active,busy,host:!!host,error,closedReason,connection,info:info(),roster:roster(),current:presented,journey:client.current,stale:active&&!host&&now()-lastReceived>1500,pendingRole};}
    function changed(){const s=status();options.onChange?.(s);for(const l of listeners)l.onChange?.(s);}
    function present(c){
      if(!c.engine){presented=null;return;}const sim=c.mode==='arena'?root.SpaceManArena:root.SpaceManRace;
      const s=sim.snapshot(c.engine.state),rs=roster(),i=info();
      for(const a of s.actors){const seat=c.engine.seats.find(p=>p.actorId===a.id),row=seat&&rs.find(r=>r.p===seat.p);a.controller=seat?(seat.p===i.myP&&i.role===0&&seat.connected&&!seat.forfeited?'human':'remote'):'cpu';if(seat){a.peerP=seat.p;a.connected=seat.connected;a.forfeited=!!seat.forfeited;a.name=row?.callsign||'PLAYER '+(seat.displayP||seat.p);a.appearance=row?.appearance;}}
      if(s.results)for(const r of s.results){const a=s.actors.find(a=>a.id===r.id);if(a)r.name=a.name;}
      presented={...c.engine,epoch:c.epoch*1024+c.engine.epoch,state:s,receivedAt:now(),isHost:!!host};
      options.onSnapshot?.(presented);for(const l of listeners)l.onSnapshot?.(presented);
    }
    function adopt(bytes){
      const c=client.accept(bytes,1);if(!c)return;lastReceived=now();
      if(c.epoch!==encounterEpoch&&c.phase!=='lobby'){
        encounterEpoch=c.epoch;readyEpoch=-1;presented=null;
        // UI loading is synchronous today; asynchronous adapters may return a
        // promise. Only acknowledge after their controls/assets are prepared.
        const generation=serial,result=options.onEncounter?.(c.config,{...c,info:info()});
        Promise.resolve(result).then(()=>{if(generation===serial&&client.current?.epoch===c.epoch){readyEpoch=c.epoch;sendReady();}}).catch(()=>{error='Could not prepare this encounter. You will watch until the next one.';changed();});
      }
      present(c);changed();
    }
    function sendReady(){const c=client.current;if(!active||!c||c.phase!=='barrier'||readyEpoch!==c.epoch||net.info().role===1)return;const b=client.ready();if(b){lastReady=now();if(host)host.receive(1,'host',b,now());else net.sendJourney(b).catch(()=>{});}}
    function publish(force=false){if(!active||!host||(!force&&now()-lastPublish<50))return;lastPublish=now();const b=host.packet();if(b){adopt(b);net.sendJourney(b).catch(()=>{});}}
    function sync(){if(host){host.syncRoster(roster(),now());publish(true);}changed();}
    function beat(){
      if(!active)return;const t=now();
      if(host&&!connection){acc+=Math.min(100,Math.max(0,t-lastBeat));let steps=0;while(acc>=1000/60&&steps++<6){acc-=1000/60;const before=host.epoch;host.step(t);if(host.epoch!==before){net.setJourneyRoleLock(false);acc=0;break;}}net.setJourneyRoleLock(host.phase!=='lobby'&&host.phase!=='barrier');publish();}
      lastBeat=t;if(client.current?.phase==='barrier'&&t-lastReady>250)sendReady();
      if(pendingRole!==null&&client.current?.phase==='barrier'){const value=pendingRole;pendingRole=null;net.setRole(value).then(ok=>{if(!ok){pendingRole=value;changed();}});}
      if(!host&&t-lastReceived>1500)changed();
    }
    function subscribe(){
      off=net.onEvent((event,data)=>{
        if(!active&&!busy)return;
        if(event==='journey-data'){if(host){host.receive(data.p,data.p===1?'host':data.pubHex,data.bytes,now());}else adopt(data.bytes);}
        else if(['join','rejoin','roster','role','leave','kick','banned','welcomed','ok','appearance'].includes(event))sync();
        else if(event==='reconnecting'||event==='hostaway'){connection=host?'Connection lost · expedition paused':'Reconnecting · controls released';if(host)host.pause(true);changed();}
        else if(event==='reconnected'||event==='hostback'){connection='';if(host)host.pause(false);lastBeat=now();acc=0;sync();}
        else if(event==='bye'){closedReason=data?.reason===4?'This expedition is full.':data?.reason===3?'This expedition uses a different game version. Refresh both games.':data?.reason===1?'The host closed the expedition.':'The expedition connection ended.';cleanup();changed();options.onExit?.(closedReason);}
      });
      lastBeat=now();timer=root.setInterval(beat,1000/60);
    }
    function cleanup(){serial++;active=false;busy=false;host=null;pendingRole=null;presented=null;if(timer)root.clearInterval(timer);timer=null;off?.();off=null;net.leave();client=online.createClient();connection='';encounterEpoch=readyEpoch=-1;acc=0;}
    async function hosting(seed){if(active||busy||net.active)return false;const mine=++serial;busy=true;error=closedReason=connection='';subscribe();changed();try{await net.openRoom({...options.hostOptions?.(),...options.identity?.(),mode:'journey',code:!options.build?.preview,baseUrl:typeof options.baseUrl==='function'?options.baseUrl():options.baseUrl});if(serial!==mine)return false;const random=new Uint32Array(1);root.crypto.getRandomValues(random);host=online.createHost({seed:seed>>>0,session:random[0]||1});active=true;busy=false;host.syncRoster(roster(),now());publish(true);return true;}catch(e){if(serial===mine){error=e?.message||'Could not reach the expedition relay.';cleanup();changed();}return false;}}
    async function join(target,role=0,trusted=false){if(active||busy||net.active)return false;const mine=++serial;busy=true;error=closedReason=connection='';subscribe();changed();try{let payload=target;if(!trusted){const r=options.build?options.build.resolveJoin(target):{value:target};if(r.error)throw new Error(r.error);const p=net.parseJoin(r.value);if(p.kind==='invite')payload=p.payload;else if(p.kind==='code')payload=(await net.lookupCode(r.value)).invite;else throw new Error('Paste a Star Expedition invite link or room code.');}if(mine!==serial)return false;const peek=net.peekInvite(payload);if(peek.err)throw new Error('This expedition invite has expired or is incompatible.');if(peek.mode!=='journey')throw new Error('This invite is for another mode. Open its own friends menu.');if(net.blocklist().some(b=>b.pubkey===peek.hostHex))throw new Error('This host is blocked.');await net.acceptJoin(payload,{...options.identity?.(),mode:'journey',role:role===1?1:0});if(mine!==serial)return false;active=true;busy=false;lastReceived=now();if(client.current&&client.current.phase!=='lobby'&&encounterEpoch===client.current.epoch){readyEpoch=client.current.epoch;sendReady();}changed();return true;}catch(e){if(mine===serial){error=e?.message||'Could not join this expedition.';cleanup();changed();}return false;}}
    function start(){if(!host||connection)return false;host.syncRoster(roster(),now());const ok=host.start(now());if(ok)publish(true);return ok;}
    function submit(command){if(!active||connection||(!host&&now()-lastReceived>1500))return;const b=client.input(command,net.info().myP);if(!b)return;if(host)host.receive(1,'host',b,now());else if(now()-lastInput>=25){lastInput=now();net.sendJourney(b).catch(()=>{});}}
    function release(){if(client.current?.mode==='runner')return;submit({});}
    function pause(on){release();if(!host||connection)return false;const ok=host.pause(on);lastBeat=now();acc=0;publish(true);return ok;}
    function leave(){const message=host?'Expedition closed.':'You left the expedition.';cleanup();closedReason='';error='';changed();options.onExit?.(message);}
    async function role(value){if(!active||![0,1].includes(value))return false;if(client.current?.phase==='running'||client.current?.phase==='paused'){pendingRole=value;changed();return true;}const ok=await net.setRole(value);sync();sendReady();return ok;}
    function attach(callbacks){listeners.add(callbacks);callbacks.onChange?.(status());if(presented)callbacks.onSnapshot?.(presented);return()=>listeners.delete(callbacks);}
    const adapter={attach,step:submit,release,pause,leave,close:leave,status,role,configure:()=>false,setTeam:()=>false,lobby:()=>false,start:()=>false,get active(){return active;},get busy(){return busy;},get isHost(){return!!host;},get current(){return presented;}};
    const runnerNet=new Proxy(net,{get(target,key){
      if(key==='info')return info;
      if(key==='presence')return()=>{const c=client.current;if(c?.mode!=='runner')return[];const rs=roster();return c.runner.map(s=>{const r=rs.find(r=>r.p===s.p)||{};return{...s,...r,runId:c.epoch,suit:r.suit||0,hat:r.hat||0,you:s.p===net.info().myP,host:s.p===1,spectator:false};});};
      if(key==='sendPresence')return(x,y,vx,state,chain,score,dist,frame=0,vy=0)=>submit({x,y,vx,vy,state,chain,score,dist,frame});
      if(key==='roundClock')return()=>{const c=client.current;return{active:!!c&&c.mode==='runner',runId:c?.epoch||0,seed:c?.config.seed||0,startInMs:c?.phase==='barrier'?500:0,elapsedMs:(c?.tick||0)*1000/60};};
      if(key==='startRound'||key==='newWorld'||key==='kill')return()=>false;
      if(key==='setRole')return role;if(key==='leave')return leave;
      return Reflect.get(target,key);
    }});
    return Object.freeze({hosting,join,start,leave,pause,role,attach,status,adapter,runnerNet,runnerDone(sample){submit({...sample,state:(sample.state||8)|16});},get active(){return active;},get busy(){return busy;},get current(){return client.current;},get isHost(){return!!host;}});
  }
  root.SpaceManJourneyRoom=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
