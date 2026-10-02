/* Original low-poly Star Circuit art. Pure mesh generation; no physics state. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SpaceManRaceScene=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const shade=(c,s)=>c.map(v=>Math.min(1,v*s));
function builder(){
 const v=[];
 function triangle(a,b,c,color){
  const u=b.map((n,i)=>n-a[i]),w=c.map((n,i)=>n-a[i]);let n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],d=Math.hypot(...n)||1;n=n.map(x=>x/d);
  for(const p of [a,b,c])v.push(...p,...n,...color);
 }
 function quad(a,b,c,d,color){triangle(a,b,c,color);triangle(a,c,d,color);}
 function box(x,y,z,w,h,d,color,heading=0){
  const co=Math.cos(heading),si=Math.sin(heading),p=(a,b,c)=>[x+a*co-c*si,y+b,z+a*si+c*co];
  const a=p(-w/2,0,-d/2),b=p(w/2,0,-d/2),c=p(w/2,0,d/2),e=p(-w/2,0,d/2),A=p(-w/2,h,-d/2),B=p(w/2,h,-d/2),C=p(w/2,h,d/2),E=p(-w/2,h,d/2);
  quad(A,E,C,B,color);quad(a,b,B,A,shade(color,.78));quad(b,c,C,B,shade(color,.9));quad(c,e,E,C,color);quad(e,a,A,E,shade(color,.8));
 }
 function crystal(x,y,z,r,h,color,sides=6){
  for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2;triangle([x+r*Math.cos(a),y,z+r*Math.sin(a)],[x,y+h,z],[x+r*Math.cos(b),y,z+r*Math.sin(b)],shade(color,.7+(i%3)*.15));}
 }
 function sphere(x,y,z,r,color){
  const at=(a,b)=>[x+r*Math.cos(b)*Math.cos(a),y+r*Math.sin(b),z+r*Math.cos(b)*Math.sin(a)];
  for(let i=0;i<24;i++)for(let j=0;j<12;j++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12,c=-Math.PI/2+j*Math.PI/12,d=c+Math.PI/12;quad(at(a,c),at(b,c),at(b,d),at(a,d),shade(color,.83+(j%3)*.08));}
 }
 return {triangle,quad,box,crystal,sphere,mesh:()=>({vertices:new Float32Array(v)})};
}
function roadPoint(p,side,y){return[p.x-p.ty*side,y,p.y+p.tx*side];}
function course(c,at){
 const b=builder(),edge=rgb(c.edge),accent=rgb(c.accent),road=rgb(c.road);
 const ribbon=(p,q,l,r,y,color)=>b.quad(roadPoint(p,l,y),roadPoint(q,l,y),roadPoint(q,r,y),roadPoint(p,r,y),color);
 const half=c.width/2;
 const points=c.segments.map(p=>({x:p.x,y:p.y,tx:p.tx,ty:p.ty}));
 for(let i=0;i<points.length;i++){
  const p=points[i],q=points[(i+1)%points.length];
  ribbon(p,q,-half-95,half+95,-3,[.075,.12,.17]);
  ribbon(p,q,-half,half,0,shade(road,i%8<4?1.12:1));
  for(const side of [-1,1]){
   ribbon(p,q,side*half-3,side*half+3,1,edge);
   ribbon(p,q,side*(half+9)-5,side*(half+9)+5,0,i%6<3?[.8,.86,.85]:shade(road,.6));
   ribbon(p,q,side*(half+90)-3,side*(half+90)+3,-2,shade(edge,.38));
  }
  if(i%4<2)ribbon(p,q,-1,1,.3,[.4,.55,.62]);
 }
 // Repeated luminous pylons create strong speed/depth cues without collision walls.
 for(let d=0;d<c.length;d+=105){const p=at(c,d),h=Math.atan2(p.ty,p.tx);for(const side of [-1,1]){
  const x=p.x-p.ty*(half+25)*side,z=p.y+p.tx*(half+25)*side;
  b.box(x,0,z,7,17,7,[.12,.2,.27],h);b.box(x,16,z,8,3,8,edge,h);
 }}
 // Track-specific skyline silhouettes are generated locally, not fetched assets.
 for(let i=0;i<32;i++){
  const p=at(c,i*c.length/32),side=i%2?-1:1,dist=half+135+(i%4)*55,x=p.x-p.ty*dist*side,z=p.y+p.tx*dist*side;
  if(c.id==='ember'){b.crystal(x,-9,z,34+i%3*12,70+i%4*25,rgb(c.planet));b.crystal(x+17,-5,z+13,15,42,accent);}
  else if(c.id==='bloom'){b.box(x,-6,z,17,65+i%4*15,17,[.12,.29,.27]);b.sphere(x,60+i%4*15,z,30+i%3*8,shade(rgb(c.planet),1.25));}
  else {b.box(x,-5,z,33,85+i%5*27,30,[.12,.2,.31]);b.box(x,55+i%5*27,z,36,5,33,shade(edge,.8));b.crystal(x,85+i%5*27,z,22,30,shade(edge,.7));}
 }
 for(const fraction of c.pads){const p=at(c,fraction*c.length),h=Math.atan2(p.ty,p.tx);b.box(p.x,.5,p.y,60,.5,c.width*.68,shade(accent,.35),h);
  for(let j=-1;j<=1;j++)for(const side of [-1,1]){const point=(f,s)=>[p.x+Math.cos(h)*f-Math.sin(h)*s,1.4,p.y+Math.sin(h)*f+Math.cos(h)*s];b.quad(point(j*16-8,side*30),point(j*16-2,side*30),point(j*16+10,0),point(j*16+4,0),accent);}
 }
 const p=at(c,0),h=Math.atan2(p.ty,p.tx);
 for(let j=0;j<2;j++)for(let i=0;i<10;i++){const side=-half+(i+.5)*c.width/10;b.box(p.x-p.ty*side+p.tx*(j-.5)*13,.8,p.y+p.tx*side+p.ty*(j-.5)*13,13,.3,c.width/10,(i+j)%2?[.86,.95,.93]:[.06,.12,.19],h);}
 for(const side of [-1,1])b.box(p.x-p.ty*(half+19)*side,0,p.y+p.tx*(half+19)*side,13,128,13,shade(edge,.6),h);
 b.box(p.x,125,p.y,17,14,c.width+53,[.17,.28,.37],h);b.box(p.x+Math.cos(h)*10,130,p.y+Math.sin(h)*10,3,5,c.width+34,accent,h);
 const mesh=b.mesh();mesh.static=true;
 const sky=builder();sky.sphere(2000,900,2000,500,rgb(c.planet));sky.sphere(-1000,520,1200,240,shade(accent,.6));
 // Star diamonds at a stable world distance; they move only with the view.
 for(let i=0;i<160;i++){const a=i*2.39996,r=3100,y=220+(i*137%1900),x=900+Math.cos(a)*r,z=750+Math.sin(a)*r,s=i%7?2.7:5;sky.crystal(x,y,z,s,s*2,[.65,.8,.92],4);}
 const skyMesh=sky.mesh();skyMesh.static=true;
 return {meshes:[skyMesh,mesh],background:rgb(c.sky),fog:{color:rgb(c.sky),near:1700,far:6000}};
}
function actors(snapshot,{hideId=null,calm=false}={}){
 const b=builder();
 for(const a of snapshot.actors){
  if(a.id===hideId)continue;
  const h=a.heading,co=Math.cos(h),si=Math.sin(h),color=rgb(a.color),white=[.86,.93,.97];
  const part=(f,u,s,w,t,d,col)=>b.box(a.x+co*f-si*s,u,a.y+si*f+co*s,w,t,d,col,h);
  // Broad twin hover pods, angular fuselage, visible pilot helmet and spoiler.
  part(-2,5,0,39,7,24,[.17,.27,.34]);part(2,10,0,35,7,20,white);part(19,9,0,16,4,14,color);
  for(const s of [-17,17]){part(-3,5,s,37,8,9,color);part(0,5,s,25,2,10,[.47,.91,1]);part(-21,7,s,3,4,7,[.8,.98,1]);}
  part(-12,18,0,7,3,43,color);part(-13,10,-13,4,9,3,white);part(-13,10,13,4,9,3,white);
  b.sphere(a.x-3*co,21,a.y-3*si,8,white);part(2,20,0,7,7,13,[.025,.16,.23]);part(6,22,0,1,2,10,color);
  // Ground contact shadow is geometry, avoiding a texture or per-frame asset.
  b.quad([a.x-24*co+23*si,.15,a.y-24*si-23*co],[a.x+29*co+23*si,.15,a.y+29*si-23*co],[a.x+29*co-23*si,.15,a.y+29*si+23*co],[a.x-24*co-23*si,.15,a.y-24*si+23*co],[.045,.08,.12]);
  if(a.boosting||a.padTicks>0){const length=calm?35:35+(snapshot.tick%5)*3;for(const s of [-17,17]){const p=(f,u,side)=>[a.x+co*f-si*side,u,a.y+si*f+co*side];b.triangle(p(-23,7,s-4),p(-23,11,s+4),p(-length-23,8,s),color);b.triangle(p(-23,6,s+4),p(-23,12,s-4),p(-length-23,8,s),[.8,1,1]);}}
 }
 return b.mesh();
}
return Object.freeze({rgb,builder,course,actors});
});
