/* Presentation-only cameras: one simulation snapshot can feed any view. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SpaceManRaceCamera=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const MODES=Object.freeze(['chase','cockpit','topdown']);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const mix=(a,b,t)=>a+(b-a)*t;
function create(){
 let current=null,lastRecovery=null,lastActor=null;
 return {
  reset(){current=null;lastRecovery=null;lastActor=null;},
  update(actor,course,at,options={}){
   if(!actor)return null;
   const mode=MODES.includes(options.mode)?options.mode:'chase',calm=!!options.reduceMotion;
   const dt=Math.max(0,Math.min(.1,Number.isFinite(options.dt)?options.dt:1/60));
   const reset=!current||current.mode!==mode||lastActor!==actor.id||lastRecovery!==actor.recoveries;
   const h=actor.heading,fx=Math.cos(h),fz=Math.sin(h);
   const cockpit=mode==='cockpit';
   // Fixed horizon: never roll or shake. Reduced motion removes speed zoom and
   // follow lag, rather than making the road turn underneath a fixed camera.
   const desired={mode,x:actor.x-fx*(cockpit?-6:132),y:cockpit?22:94,z:actor.y-fz*(cockpit?-6:132),heading:h,
    fov:(cockpit?68:59)+(!calm?Math.min(4,Math.max(0,actor.speed||0)*.5):0)};
   if(reset||calm)current={...desired};
   else {
    const t=1-Math.exp(-dt*12);
    current.x=mix(current.x,desired.x,t);current.y=mix(current.y,desired.y,t);current.z=mix(current.z,desired.z,t);
    current.heading+=wrap(h-current.heading)*t;current.fov=mix(current.fov,desired.fov,1-Math.exp(-dt*3));
   }
   lastRecovery=actor.recoveries;lastActor=actor.id;
   const look=cockpit?360:270;
   return {eye:[current.x,current.y,current.z],target:[current.x+Math.cos(current.heading)*look,cockpit?17:4,current.z+Math.sin(current.heading)*look],
    fov:current.fov*Math.PI/180,near:2,far:6500,mode};
  }
 };
}
return Object.freeze({MODES,create,wrap});
});
