/* Home-only illustration. Uses the same equipped art as every playable mode.
   Painted only when returning home, with no timer, sockets or save writes. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  function ellipse(c,x,y,rx,ry,fill) { c.fillStyle=fill;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill(); }
  function line(c,points,color,width) { c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke(); }
  function star(c,x,y,size,color) { c.fillStyle=color;c.beginPath();c.moveTo(x,y-size);c.quadraticCurveTo(x+size*.22,y-size*.22,x+size,y);c.quadraticCurveTo(x+size*.22,y+size*.22,x,y+size);c.quadraticCurveTo(x-size*.22,y+size*.22,x-size,y);c.quadraticCurveTo(x-size*.22,y-size*.22,x,y-size);c.fill(); }
  function surface(id,w,h) { const canvas=root.document.getElementById(id);if(!canvas)return null;const dpr=Math.min(root.devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');if(!c)return null;c.scale(dpr,dpr);c.clearRect(0,0,w,h);return c; }
  function hero(c,appearance) {
    // A tiny landing moon, soft atmospheric rings and distant destinations.
    c.save();c.translate(320,218);c.rotate(-.18);c.strokeStyle='#7dcde429';c.lineWidth=1.5;c.beginPath();c.ellipse(0,0,247,104,0,0,TAU);c.stroke();c.strokeStyle='#c2eef118';c.beginPath();c.ellipse(0,0,270,129,0,0,TAU);c.stroke();c.restore();
    ellipse(c,489,104,43,43,'#25465e');ellipse(c,479,94,31,30,'#2b536b');ellipse(c,490,95,7,5,'#365f74');ellipse(c,473,117,9,5,'#24465e');
    c.save();c.translate(489,104);c.rotate(-.4);c.strokeStyle='#85c7cb77';c.lineWidth=5;c.beginPath();c.ellipse(0,0,65,17,0,0,TAU);c.stroke();c.restore();
    ellipse(c,136,204,21,21,'#87644f');ellipse(c,130,196,13,12,'#b58d60');
    star(c,160,92,9,'#ffda8b');star(c,450,221,7,'#9cf3ed');star(c,390,55,5,'#bbeaff');star(c,217,244,4,'#d6edff');star(c,516,262,4,'#d6edff');
    [[106,139],[210,60],[553,171],[448,42],[383,292],[118,271],[546,69],[239,159]].forEach(([x,y],i)=>ellipse(c,x,y,i%3===0?2:1.3,i%3===0?2:1.3,'#b6d9e377'));
    ellipse(c,320,323,135,29,'#081727');ellipse(c,320,310,115,28,'#26455c');ellipse(c,320,306,115,20,'#3b6175');ellipse(c,320,300,109,16,'#60909c');ellipse(c,320,301,84,9,'#8fbbbc');
    line(c,[[226,310],[242,315]],'#a8efdf',3);line(c,[[399,314],[412,310]],'#a8efdf',3);
    root.SpaceManArt.drawAvatar(c,320,176,260,appearance,{reduceMotion:true});
    // One playful, unambiguous non-player companion watches the departure.
    ellipse(c,414,289,14,4,'#182f3f');ellipse(c,415,272,14,18,'#7fce92');ellipse(c,417,265,12,10,'#a8e4a1');ellipse(c,411,263,3.4,4.6,'#f0fcdb');ellipse(c,423,263,3.4,4.6,'#f0fcdb');ellipse(c,412,264,1.7,2.8,'#143845');ellipse(c,423,264,1.7,2.8,'#143845');line(c,[[410,248],[408,242]],'#9ce6ac',2);ellipse(c,408,241,3,3,'#c8f5b4');
  }
  function tile(c,mode,appearance) {
    star(c,207,27,3,'#ceebe966');star(c,47,22,2,'#ceebe966');
    if(mode==='run') {
      ellipse(c,214,99,44,55,'#b97c4944');ellipse(c,225,105,33,42,'#ffc87444');
      line(c,[[14,115],[82,115]],'#23434f',17);line(c,[[14,109],[82,109]],'#78d5d2',5);
      line(c,[[130,135],[250,135]],'#23434f',20);line(c,[[130,126],[250,126]],'#b2d3a0',5);
      root.SpaceManArt.drawAvatar(c,112,54,98,appearance,{reduceMotion:true});star(c,174,67,7,'#ffd887');
    } else if(mode==='arena') {
      ellipse(c,131,108,105,23,'#193847');ellipse(c,131,101,105,17,'#6ca4a8');ellipse(c,131,99,91,9,'#376979');
      root.SpaceManArt.drawAvatar(c,92,44,91,appearance,{reduceMotion:true});
      root.SpaceManArt.drawAvatar(c,179,49,77,{...appearance,suit:'rose',hat:'none',eyes:'determined'},{reduceMotion:true});star(c,140,65,13,'#ffcc80');
    } else {
      c.strokeStyle='#94cab444';c.lineWidth=31;c.beginPath();c.ellipse(127,102,110,50,-.2,0,TAU);c.stroke();
      c.strokeStyle='#add5b455';c.lineWidth=2;c.beginPath();c.ellipse(127,102,110,50,-.2,0,TAU);c.stroke();
      line(c,[[18,108],[50,108]],'#ffcf7c',4);line(c,[[25,119],[54,119]],'#ffcf7c88',3);
      root.SpaceManArt.drawAvatar(c,132,59,165,appearance,{reduceMotion:true,ship:true});
    }
  }
  root.SpaceManHome=Object.freeze({render(appearance) {
    const c=surface('homeHero',640,400);if(c&&root.SpaceManArt?.drawAvatar)hero(c,appearance);
    [['homeRunArt','run'],['homeArenaArt','arena'],['homeRaceArt','race']].forEach(([id,mode])=>{const g=surface(id,260,156);if(g&&root.SpaceManArt?.drawAvatar)tile(g,mode,appearance);});
  }});
})(typeof window!=='undefined'?window:globalThis);
