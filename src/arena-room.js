/* Arena browser coordinator. Transport authenticates peers; arena-online owns
 * gameplay. A host pause is shared. No migration or persisted match restoration. */
(function(root){
  'use strict';
  function create(options){
    const opts=options||{},net=opts.net,online=root.SpaceManArenaOnline,sim=root.SpaceManArena;
    let host=null,client=online.createClient(),active=false,busy=false,serial=0,timer=null,off=null;
    const social=root.SpaceManRoomSocial,lastRoom=opts.lastRoom||null;
    let votes=null;
    let lastPublish=-Infinity,lastInput=-Infinity,lastReceived=0,steps=0,pending=null,error='',closedReason='',connection='';
    const now=()=>root.performance.now(),info=()=>net.info();
    function roster(){return net.roster().map(r=>Object.assign({},r,{identity:r.p===1?'host':r.pubHex||('peer-'+r.p)}));}
    const overNow=(c)=>!!(c&&c.state&&c.state.phase==='over'),lobbyNow=(c)=>!!(c&&c.status==='lobby');
    function ensureVotes(){
      if(!votes&&social)votes=social.createRoomVotes({net,host:()=>!!host,roster,myP:()=>info().myP,myRole:()=>info().role,isLobby:()=>lobbyNow(client.current),isOver:()=>overNow(client.current),blocked:()=>!active||!!connection,changed,delay:opts.autoStartDelayMs,autoStart:kind=>{if(opts.onAutoStart)opts.onAutoStart(kind);}});
      return votes;
    }
    function status(){return{active,busy,error,closedReason,connection,host:!!host,info:info(),roster:roster(),current:client.current,stale:active&&!host&&now()-lastReceived>1500,votes:active&&votes?votes.status():null};}
    function changed(){if(opts.onChange)opts.onChange(status());}
    function present(snapshot){
      const s=sim.snapshot(snapshot.state),rows=roster(),local=info(),myP=local.myP;
      for(const a of s.actors){const seat=snapshot.seats.find(p=>p.actorId===a.id),row=seat&&seat.connected&&rows.find(r=>r.p===seat.p&&r.role===0);a.controller=seat?(seat.p===myP&&local.role===0&&seat.connected?'human':'remote'):'cpu';if(seat){a.name=row&&row.callsign||('PLAYER '+seat.p);a.appearance=row&&row.appearance;a.peerP=seat.p;a.connected=seat.connected;}}
      if(votes)votes.observe();
      if(opts.onSnapshot)opts.onSnapshot(Object.assign({},snapshot,{state:s,receivedAt:now(),isHost:!!host}));
    }
    function publish(force){
      if(!active||!host||(!force&&now()-lastPublish<online.SNAPSHOT_MS))return;
      lastPublish=now();const bytes=host.packet(),snapshot=client.accept(bytes);
      if(snapshot){lastReceived=now();if(force||host.status!=='running'||host.state.phase==='over')present(snapshot);}
      net.sendArena(bytes).catch(()=>{});changed();
    }
    function sync(){if(host){host.syncRoster(roster(),now());publish(true);}if(votes)votes.evaluate();changed();}
    function cleanup(leave=true){if(votes)votes.reset();serial++;active=false;busy=false;pending=null;connection='';host=null;client=online.createClient();if(timer){root.clearInterval(timer);timer=null;}if(off){off();off=null;}if(leave)net.leave();}
    function subscribe(){
      ensureVotes();
      off=net.onEvent((event,data)=>{
        if(!active&&!busy)return;
        if(event==='emote'){if(votes&&data&&social.kindOf(data.id))votes.onSignal(data.p,data.id);return;}
        if(votes&&data&&(event==='leave'||event==='kick'||event==='banned'||event==='join'))votes.drop(data.p);
        if(event==='arena-data'){
          if(host)host.receive(data.p,data.p===1?'host':data.pubHex,data.bytes,now());
          else{const snapshot=client.accept(data.bytes,data.p);if(snapshot){lastReceived=now();connection='';present(snapshot);changed();}}
        }else if(['join','rejoin','roster','role','leave','kick','banned','welcomed','ok'].includes(event))sync();
        else if(event==='reconnecting'||event==='hostaway'){connection=host?'Connection lost · match paused':'Reconnecting · controls released';pending=null;if(host)host.pause(true);publish(true);changed();}
        else if(event==='reconnected'||event==='hostback'){connection='';sync();}
        else if(event==='bye'){
          const message=data&&data.reason===4?'This arena room is full.':data&&data.reason===3&&data.detail===16?'This invite is for a different game mode.':data&&data.away?'The host stayed away, so this room ended.':data&&data.reason===1?'The host closed the room.':'The host ended your arena connection.';
          if(busy)error=message;else closedReason=message;cleanup();changed();
        }
      });
      timer=root.setInterval(()=>{publish(false);if(active&&!host&&now()-lastReceived>1500)changed();},50);
    }
    async function hosting(config){
      if(active||busy||net.active)return false;const mine=++serial;busy=true;error='';closedReason='';connection='';client=online.createClient();subscribe();changed();
      try{
        await net.openRoom(Object.assign({},typeof opts.hostOptions==='function'?opts.hostOptions():{},typeof opts.identity==='function'?opts.identity():{},{mode:'arena',code:!(opts.build&&opts.build.preview),baseUrl:typeof opts.baseUrl==='function'?opts.baseUrl():opts.baseUrl}));
        if(mine!==serial)return false;host=online.createHost(config);active=true;busy=false;host.syncRoster(roster(),now());publish(true);changed();return true;
      }catch(e){if(mine===serial){error=e&&e.message||'Could not reach the room relay.';cleanup();changed();}return false;}
    }
    async function join(target,role,trustedPayload=false){
      if(active||busy||net.active)return false;const mine=++serial;busy=true;error='';closedReason='';connection='';client=online.createClient();subscribe();changed();
      let codeRoom=null;
      try{
        let payload;
        if(trustedPayload)payload=target;
        else{const resolved=opts.build?opts.build.resolveJoin(target):{value:target};if(resolved.error)throw new Error(resolved.error);const parsed=net.parseJoin(resolved.value);if(parsed.kind==='invite')payload=parsed.payload;else if(parsed.kind==='code'){payload=(await net.lookupCode(resolved.value)).invite;codeRoom={region:parsed.region||'',code:parsed.code,mode:'arena'};}else throw new Error('Paste your friend’s arena invite link or room code.');}
        if(mine!==serial)return false;const peek=net.peekInvite(payload);
        if(peek.err)throw new Error(peek.err==='expired'?'This arena invite has expired.':'This invite is not compatible. Refresh both games.');
        if(peek.mode!=='arena')throw new Error(peek.mode==='race'?'That is a Star Circuit room. Join it from Star Circuit.':'That is a Run Together room. Join it from the runner.');
        if(net.blocklist().some(b=>b.pubkey===peek.hostHex))throw new Error('This host is blocked. Manage blocked hosts in the runner settings first.');
        if(codeRoom&&lastRoom)lastRoom.save(codeRoom);
        await net.acceptJoin(payload,Object.assign({},typeof opts.identity==='function'?opts.identity():{},{mode:'arena',role:role===1?1:0}));
        if(mine!==serial)return false;active=true;busy=false;lastReceived=now();if(client.current)present(client.current);changed();return true;
      }catch(e){if(mine===serial){error=e&&e.message||'Could not join this arena.';cleanup();changed();}return false;}
    }
    function submit(command,time=now()){
      if(!active||connection)return;const packet=client.input(command,info().myP);if(!packet)return;
      if(host)host.receive(1,'host',packet,time);else{pending=packet;if(time-lastInput>=30){lastInput=time;net.sendArena(pending).catch(()=>{});pending=null;}}
    }
    function step(command,time=now()){
      if(!active)return;submit(command,time);
      if(host && !connection){host.step(time);steps++;present({state:host.state,seats:host.seats,status:host.status,epoch:host.epoch,revision:host.revision});if(steps%3===0)publish(false);}
    }
    function release(){if(active){submit(sim.normalizeCommand(),now());if(pending){net.sendArena(pending).catch(()=>{});pending=null;}}}
    function configure(config){if(!host)return false;const ok=host.configure(config);publish(true);return ok;}
    function setTeam(p,team){if(!host)return false;const ok=host.setTeam(p,team);publish(true);return ok;}
    function start(seed){if(!host || connection)return false;host.syncRoster(roster(),now());const ok=host.start(seed);if(ok){net.setArenaRoleLock(true);if(votes)votes.reset();publish(true);}return ok;}
    function pause(on){release();if(host && !on && connection)return false;if(host){host.pause(on);publish(true);}return!!host;}
    function lobby(){if(!host)return false;host.lobby();net.setArenaRoleLock(false);host.syncRoster(roster(),now());publish(true);return true;}
    async function role(value){if(!active)return false;const ok=await net.setRole(value);sync();return ok;}
    function close(){cleanup();closedReason='';error='';connection='';changed();}
    function vote(kind){return votes?votes.vote(kind):false;}
    function cancelAuto(){return votes?votes.cancelAuto():false;}
    function setAutoStart(on){if(votes)votes.setAutoStart(on);}
    return Object.freeze({hosting,join,configure,setTeam,start,pause,lobby,role,vote,cancelAuto,setAutoStart,step,release,close,status,get active(){return active;},get busy(){return busy;},get isHost(){return!!host;},get current(){return client.current;}});
  }
  root.SpaceManArenaRoom=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
