/* A single friends lobby for the whole journey. Never swaps or recreates rooms. */
(function(root){
  'use strict';
  function create(options={}){
    const doc=root.document,el=doc.createElement('section');el.id='journeyFriends';el.hidden=true;el.className='journey-friends';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','journeyFriendsTitle');
    const style=doc.createElement('style');style.textContent='.journey-friends{position:fixed;z-index:110;inset:0;overflow:auto;box-sizing:border-box;padding:max(22px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(22px,env(safe-area-inset-bottom));background:radial-gradient(ellipse at 50% 0,#233251,#081120 70%);color:#f5f6fa;font:16px/1.5 system-ui;display:grid;place-items:center}.journey-friends[hidden]{display:none}.journey-friends-card{width:min(100%,520px);display:grid;gap:14px}.journey-friends h1{font-size:clamp(28px,7vw,40px);margin:0}.journey-friends p{margin:0;color:#bdc9de}.journey-friends button,.journey-friends input{box-sizing:border-box;min-height:48px;border:1px solid #56728d;border-radius:14px;padding:12px 16px;background:#172a42;color:#f5f6fa;font:600 16px system-ui;touch-action:manipulation}.journey-friends input{width:100%;background:#080f1d;font-weight:400}.journey-friends .primary{background:#c7e4fb;color:#12273d;border-color:#e7f5ff}.journey-friends .actions{display:flex;flex-wrap:wrap;gap:10px}.journey-friends .actions>*{flex:1}.journey-friends [hidden]{display:none!important}.journey-friends ul{margin:0;padding-left:24px}.journey-friends button:disabled{opacity:.5}.journey-friends-code{font-weight:750;letter-spacing:.08em}.journey-friends-note{font-size:14px}.journey-friends-status{min-height:24px;color:#bce7ff!important}';doc.head.appendChild(style);
    const card=doc.createElement('div');card.className='journey-friends-card';el.appendChild(card);doc.body.appendChild(el);
    const text=(tag,value,cls)=>{const n=doc.createElement(tag);n.textContent=value;if(cls)n.className=cls;card.appendChild(n);return n;};
    const title=text('h1','A shared Star Expedition');title.id='journeyFriendsTitle';text('p','Run, race and take on the stars together. One crew, one invite, a journey that keeps going.');
    text('p','Up to 4 players + 4 watchers. Arcade encounters fill empty seats with CPUs. The host keeps this tab open. Joining mid-encounter starts in watch mode; ask for a seat at the next change.','journey-friends-note');
    const hint=text('p','','journey-friends-status');hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
    const entry=doc.createElement('div');entry.className='journey-friends-card';card.appendChild(entry);
    const makeButton=(parent,label,fn,cls)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;if(cls)b.className=cls;b.addEventListener('click',fn);parent.appendChild(b);return b;};
    const hostButton=makeButton(entry,'Create expedition',async()=>{await room.hosting((Math.random()*0xffffffff)>>>0);},'primary');hostButton.id='journeyHost';
    const input=doc.createElement('input');input.id='journeyJoinInput';input.placeholder='Invite link or room code';input.setAttribute('aria-label','Star Expedition invite link or room code');entry.appendChild(input);
    const actions=doc.createElement('div');actions.className='actions';entry.appendChild(actions);
    const joinButton=makeButton(actions,'Join expedition',()=>room.join(input.value,0));joinButton.id='journeyJoin';const watchButton=makeButton(actions,'Watch',()=>room.join(input.value,1));watchButton.id='journeyWatch';
    const connected=doc.createElement('div');connected.className='journey-friends-card';card.appendChild(connected);connected.hidden=true;
    const invite=doc.createElement('input');invite.readOnly=true;invite.setAttribute('aria-label','Expedition invite link');connected.appendChild(invite);
    const code=doc.createElement('p');code.className='journey-friends-code';connected.appendChild(code);
    const copy=makeButton(connected,'Copy invite',async()=>{try{await root.navigator.clipboard.writeText(invite.value);hint.textContent='Invite copied';}catch(_){invite.focus();invite.select();hint.textContent='Select and copy the invite link';}});copy.id='journeyCopy';
    const members=doc.createElement('ul');members.setAttribute('aria-label','Expedition crew');connected.appendChild(members);
    const start=makeButton(connected,'Start together',()=>room.start(),'primary');start.id='journeyStart';
    const role=makeButton(connected,'Watch instead',()=>room.role(room.status().info.role===1?0:1));role.id='journeyRole';
    const resume=makeButton(connected,'Back to expedition',()=>hide());resume.id='journeyResume';
    const leave=makeButton(card,'Back',()=>{const s=room.status();if((s.active||s.busy)&&s.host&&s.info.players+s.info.spectators>1&&!root.confirm('Close this expedition for everyone?'))return;if(s.active||s.busy)room.leave();else{hide();options.onClose?.();}});leave.id='journeyLeave';
    let oldFocus=null,inert=[],visible=false,signature='',padFrame=0,padNeutral=false,padPrevious={},padAt=0;
    function update(s){
      entry.hidden=s.active;connected.hidden=!s.active;for(const b of[hostButton,joinButton,watchButton])b.disabled=s.busy;
      hint.textContent=s.error||s.closedReason||s.connection||(s.stale?'Waiting for the host · controls released':s.busy?'Connecting… You can cancel below.':s.active?s.journey?.phase==='barrier'?'Crew regrouping · the next encounter starts automatically':s.journey?.phase==='lobby'?'Invite your crew, then start together.':s.pendingRole!==null?'Seat change requested for the next encounter.':'Your crew stays together between encounters.':'');
      const link=s.host?s.info.link||'':'';invite.value=link;invite.hidden=!link;copy.hidden=!link;code.textContent=s.info.joinCode|| (link?'Invite link · same game build':'Shared expedition');
      start.hidden=!s.host||s.journey?.phase!=='lobby';resume.hidden=!s.journey||s.journey.phase==='lobby';role.textContent=s.pendingRole===0?'Player seat requested':s.pendingRole===1?'Will watch next encounter':s.info.role===1?'Join next encounter':'Watch next encounter';role.disabled=s.pendingRole!==null;
      leave.textContent=s.busy?'Cancel connecting':s.active?s.host?'Close expedition':'Leave expedition':'Back';
      const next=JSON.stringify(s.roster.map(r=>[r.p,r.role,r.callsign]));if(next!==signature){signature=next;members.replaceChildren();for(const r of s.roster){const row=doc.createElement('li');row.textContent=(r.callsign||'PLAYER '+r.p)+(r.you?' · YOU':'')+(r.host?' · HOST':'')+(r.role===1?' · WATCHING':'');members.appendChild(row);}}
      options.onChange?.(s);
    }
    const room=root.SpaceManJourneyRoom.create({...options,onOpenCrew:()=>open(),onChange:update,onEncounter(config,context){hide();return options.onEncounter?.(config,context,room);},onExit(reason){hide();options.onExit?.(reason);}});
    function padMenu(time){
      if(!visible)return;
      let p;try{p=Array.from(root.navigator.getGamepads?.()||[]).find(p=>p&&p.connected);}catch(_){}
      if(p){const down=i=>!!p.buttons[i]?.pressed,x=p.axes[0]||0,y=p.axes[1]||0,held=p.buttons.some(b=>b?.pressed)||Math.abs(x)>.45||Math.abs(y)>.45;
        if(!padNeutral){if(!held)padNeutral=true;}
        else{const keys={up:down(12)||y<-.6,left:down(14)||x<-.6,down:down(13)||y>.6,right:down(15)||x>.6,choose:down(0),back:down(1)};
          const controls=Array.from(el.querySelectorAll('button,input')).filter(n=>!n.hidden&&!n.disabled&&n.getClientRects().length);
          if(time-padAt>180&&((keys.up&&!padPrevious.up)||(keys.left&&!padPrevious.left)||(keys.down&&!padPrevious.down)||(keys.right&&!padPrevious.right))){const direction=keys.up||keys.left?-1:1,at=controls.indexOf(doc.activeElement);controls[(at+direction+controls.length)%controls.length]?.focus();padAt=time;}
          if(keys.choose&&!padPrevious.choose&&doc.activeElement?.tagName==='BUTTON')doc.activeElement.click();
          if(keys.back&&!padPrevious.back){if(room.active&&room.current?.phase!=='lobby')hide();else leave.click();}
          padPrevious=keys;
        }
      }
      if(visible)padFrame=root.requestAnimationFrame(padMenu);
    }
    function open(){if(visible)return;visible=true;el.inert=false;padNeutral=false;padPrevious={};padFrame=root.requestAnimationFrame(padMenu);oldFocus=doc.activeElement;inert=Array.from(doc.body.children).filter(n=>n!==el&&n.tagName!=='SCRIPT'&&n.tagName!=='STYLE').map(n=>({n,value:n.inert}));for(const r of inert)r.n.inert=true;el.hidden=false;update(room.status());(room.active?resume.hidden?start:resume:hostButton).focus();}
    function hide(){if(!visible)return;visible=false;if(padFrame)root.cancelAnimationFrame(padFrame);padFrame=0;el.hidden=true;for(const r of inert)r.n.inert=r.value;inert=[];if(oldFocus?.isConnected)oldFocus.focus({preventScroll:true});}
    el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(room.active&&room.current?.phase!=='lobby')hide();else leave.click();}if(e.key==='Tab'){const controls=Array.from(el.querySelectorAll('button,input')).filter(n=>!n.hidden&&!n.disabled&&n.getClientRects().length);const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first?.focus();}}});
    return Object.freeze({open,hide,room,joinInvite(payload,role=0){open();return room.join(payload,role,true);},get active(){return visible;},destroy(){room.leave();hide();el.remove();style.remove();}});
  }
  root.SpaceManJourneyUI=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
