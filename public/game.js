/* Shithead client: the Slam game table. Network and menus live in net.js. */

(function(){
'use strict';
var $=function(s){return document.querySelector(s)};
var W=1280,H=720,scale=1,fitEl=$('#fit'),stage=$('#stage'),cardsL=$('#cards'),fxL=$('#fx');
function fit(){scale=Math.min(innerWidth/W,innerHeight/H);fitEl.style.transform='translate(-50%,-50%) scale('+scale+')'}
addEventListener('resize',fit);fit();
var wait=function(ms){return new Promise(function(r){setTimeout(r,ms/S.speed)})};
var COL=['#ffe600','#ff2e88','#19e3ff','#ff7a1a','#7dff3a','#b266ff'];

// ---------- audio + settings
var AC=null,E=null,pack=null,packs={},SFXN=['arcade','lethal','off'],SFXL=['ARCADE','LETHAL','OFF'];
var FXN=['MINIMAL','REDUCED','FULL'];
var S={fx:(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)?1:2,sfx:'lethal',vol:.7,speed:1};
try{var _s=JSON.parse(localStorage.getItem('shitheadSettings')||'null');if(_s)for(var _k in S)if(_s[_k]!==undefined&&typeof _s[_k]===typeof S[_k])S[_k]=_s[_k]}catch(_){}
function saveSettings(){try{localStorage.setItem('shitheadSettings',JSON.stringify(S))}catch(_){}}
// opponent sounds are panned toward their seat and a little quieter
function au(seat){return(seat==null||!view||seat===view.you)?null:{pan:(posOf(seat).x-640)/640*.7,opp:true}}
function snd(name){if(!pack)return;var a=[].slice.call(arguments,1);try{pack[name].apply(pack,a)}catch(e){console.error(e)}}
var sfx={
  whoosh:function(seat){snd('whoosh',au(seat))},
  hit:function(n,seat){snd('hit',n,au(seat))},
  sting:function(rank,seat){var m={2:'two',3:'three',7:'seven',11:'jack'}[rank];if(m){var o=au(seat);snd(m,{when:.06,pan:o?o.pan:0,opp:!!o})}},
  fight:function(){snd('fight')},joker:function(){snd('joker')},
  raise:function(i){snd('raise',Math.round(i||0))},lower:function(){snd('lower')},block:function(){snd('invalid')},
  take:function(seat){snd('take',au(seat))},turn:function(){snd('turn')},ready:function(){snd('ready')},
  four:function(seat){snd('four',au(seat))},eight:function(seat){snd('eight',au(seat))},
  burn:function(){snd('burn')},win:function(){snd('win')},lose:function(){snd('lose')},
  deal:function(i,when){snd('deal',i,{when:when})},draw:function(seat){snd('draw',au(seat))},swap:function(){snd('swap')},
  out:function(me,seat){snd('out',me,au(seat))},hover:function(){snd('hover')},button:function(){snd('button')},
  reset:function(){if(pack)pack.reset()}
};
function initAudio(){ // browsers only allow audio after a gesture
  if(AC)return;
  try{AC=new(window.AudioContext||window.webkitAudioContext)();E=SlamSfx.makeEngine(AC,AC.destination);E.setVolume(S.vol);E.setIntensity(S.fx);applySfx()}catch(e){console.error(e)}
}
function applySfx(preview){
  pack=null;if(E&&S.sfx!=='off')pack=packs[S.sfx]||(packs[S.sfx]=SlamSfx.buildPack(E,S.sfx));
  if(pack){pack.reset();if(preview){pack.hit(2);setTimeout(function(){snd('raise',1)},250)}}
}
function applyFx(){document.body.classList.toggle('fx1',S.fx===1);document.body.classList.toggle('fx0',S.fx===0);if(E)E.setIntensity(S.fx)}
function applySpeed(){document.documentElement.style.setProperty('--spd',S.speed);if(window.Net)Net.send({type:'speed',v:S.speed})}
function syncSettings(){
  document.querySelectorAll('#settings .seg').forEach(function(seg){var k=seg.dataset.k;seg.querySelectorAll('button').forEach(function(b){b.classList.toggle('on',String(S[k])===b.dataset.v)})});
  $('#vol').value=Math.round(S.vol*100);$('#volv').textContent=Math.round(S.vol*100)+'%';
}
function buildSettings(){
  var seg=function(k,vals,labels){var d=$('#settings .seg[data-k="'+k+'"]');d.innerHTML='';vals.forEach(function(v,i){var b=document.createElement('button');b.dataset.v=String(v);b.textContent=labels[i];d.appendChild(b)})};
  seg('fx',[0,1,2],FXN);seg('speed',[1,2,4,8],['\u00d71','\u00d72','\u00d74','\u00d78']);seg('sfx',SFXN,SFXL);
  $('#settings').addEventListener('click',function(e){
    var b=e.target.closest('.seg button');if(b){var k=b.parentNode.dataset.k,v=b.dataset.v;
      if(k==='speed'){S.speed=+v;applySpeed()}else if(k==='fx'){S.fx=+v;applyFx()}else if(k==='sfx'){S.sfx=v;initAudio();applySfx(true)}
      saveSettings();syncSettings();return}
    if(e.target===$('#settings')||e.target.id==='sclose')closeSettings();
  });
  $('#vol').addEventListener('input',function(){S.vol=this.value/100;if(E)E.setVolume(S.vol);saveSettings();syncSettings()});
  $('#vol').addEventListener('change',function(){initAudio();snd('hit',2)});
  $('#help').addEventListener('click',function(){RulesUI.open(view?view.rules:(window.Net&&Net.rules?Net.rules():null))});
  $('#rules').addEventListener('click',function(e){if(e.target===$('#rules')||e.target.id==='rclose')$('#rules').classList.remove('open')});
  $('#gear').addEventListener('click',function(){$('#settings').classList.contains('open')?closeSettings():openSettings()});
  applyFx();syncSettings();
}
function openSettings(){initAudio();syncSettings();$('#settings').classList.add('open')}
function closeSettings(){$('#settings').classList.remove('open')}

// ---------- juice
var trauma=0,sparks=[],shakeEl=$('#shake'),flashEl=$('#flash');
function flash(col,a,ms){a=S.fx===2?a:S.fx===1?a*.35:0;flashEl.style.transition='none';flashEl.style.background=col;flashEl.style.opacity=a;void flashEl.offsetWidth;flashEl.style.transition='opacity '+(ms||300)+'ms';flashEl.style.opacity=0}
async function hitstop(ms,invert){if(S.fx===0)ms=Math.min(ms,40);else if(S.fx===1)ms=Math.min(ms,120);fitEl.classList.add('hs');$('#inv').classList.toggle('on',!!invert&&S.fx===2);await wait(ms);fitEl.classList.remove('hs')}
function spark(x,y,n,cols,pow){
  for(var i=0;i<n;i++){var e=document.createElement('div');e.className='spark';e.style.background=cols[i%cols.length];fxL.appendChild(e);
    var a=Math.random()*6.283,s=(pow||16)*(.4+Math.random()*.8);sparks.push({e:e,x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,l:1,a:a})}
}
function stamp(text,x,y,o){
  o=o||{};var z=o.size||64;o.size=z>=120?110:z>=80?80:z>=56?60:z>=44?48:32;var e=document.createElement('div');e.className='stamp';e.style.transform='translate('+x+'px,'+y+'px)';
  var s=document.createElement('span');s.textContent=text;s.style.fontSize=(o.size||64)+'px';
  s.style.setProperty('--fg',o.fg||'#ffe600');s.style.setProperty('--bg',o.bg||'#000');s.style.setProperty('--r',(o.r===undefined?-6:o.r)+'deg');s.style.setProperty('--d',(o.dur||900)/S.speed+'ms');
  e.appendChild(s);fxL.appendChild(e);setTimeout(function(){e.remove()},(o.dur||900)/S.speed);
}
var last=0;
function frame(t){
  requestAnimationFrame(frame);var dt=Math.min(50,t-last);last=t;
  if(trauma>0){trauma=Math.max(0,trauma-dt/300);var s=trauma*trauma*38*(S.fx===2?1:S.fx===1?.35:0);shakeEl.style.transform='translate('+((Math.random()-.5)*s)+'px,'+((Math.random()-.5)*s)+'px)'}else shakeEl.style.transform='';
  if(fitEl.classList.contains('hs'))return;
  for(var i=sparks.length-1;i>=0;i--){var b=sparks[i];b.x+=b.vx;b.y+=b.vy;b.vx*=.9;b.vy*=.9;b.l-=dt/380;
    if(b.l<=0){b.e.remove();sparks.splice(i,1)}else b.e.style.transform='translate('+b.x+'px,'+b.y+'px) rotate('+b.a+'rad) scaleX('+b.l*1.6+')'}
}
requestAnimationFrame(frame);
// direction ring
(function(){var s='';for(var i=0;i<12;i++)s+='<path d="M-9,-160 L9,-150 L-9,-140" fill="none" stroke="#fff" stroke-width="5" opacity=".55" transform="rotate('+(i*30)+')"/>';$('#ring').innerHTML='<g>'+s+'</g>'})();

// ---------- cards
var RN={11:'J',12:'Q',13:'K',14:'A'},rn=function(r){return r===15?'JOKER':RN[r]||String(r)};
var SUITG={C:'♣',D:'♦',H:'♥',S:'♠'};
var TAG0={2:'RESET',3:'GHOST',4:'REVERSE',7:'LOW BLOW',8:'SKIP',10:'BURN',11:'JACKS'},TAGK={3:'r3',4:'r4',8:'r8',10:'r10'};
// card captions follow the room's rules: a 3 is only a "ghost" when 3s are transparent, and so on
var R=function(){return(view&&view.rules)||{r3:true,r4:true,r8:true,r10:true,four:true,combo:true,jokers:true,parry:true,randomJoker:false,difficulty:'assisted'}};
var TAG=function(r){return(!TAGK[r]||R()[TAGK[r]])?TAG0[r]:undefined};
var HANDX=330,RESX=890,PILE={x:640,y:300},DECK={x:885,y:300},BURN={x:1400,y:-80},HAND={x:640,y:600},RES={x:62,y:640};
var SLOT={
  left:{x:140,y:236,res:'below',wedge:'polygon(640px 300px,0px 20px,0px 500px)'},
  right:{x:1140,y:236,res:'below',wedge:'polygon(640px 300px,1280px 20px,1280px 500px)'},
  top:{x:640,y:62,res:'right',wedge:'polygon(640px 300px,330px 0px,950px 0px)'},
  topL:{x:380,y:62,res:'left',wedge:'polygon(640px 300px,150px 0px,610px 0px)'},
  topR:{x:900,y:62,res:'right',wedge:'polygon(640px 300px,670px 0px,1130px 0px)'}
},SLOTSETS={1:['top'],2:['left','right'],3:['left','top','right'],4:['left','topL','topR','right'],5:['left','topL','top','topR','right']},OPP=[],WME='polygon(640px 300px,120px 720px,1160px 720px)';
function resPos(P){if(P.res==='right')return{x:P.x+170,y:P.y};if(P.res==='left')return{x:P.x-270,y:P.y};if(P.res==='under')return{x:P.x-44,y:P.y+128};return{x:P.x-44,y:P.y+122}}
var maxDeck=0,sprites=new Map(),view=null,swapSel=null,spawnFrom=null,lastDownK=0,busy=false,oppSeats=[],panels={};
function jit(n,a){var x=Math.sin(n*127.1+a*311.7)*43758.5453;return((x-Math.floor(x))-.5)*2*a}
function faceEl(c){
  var f=document.createElement('div');f.className='face';
  if(c.rank===15){f.classList.add('jk');f.innerHTML='<div>JOKER</div>';return f}
  if(c.suit==='H'||c.suit==='D')f.classList.add('red');
  f.innerHTML='<div class="r">'+rn(c.rank)+'</div><div class="s">'+SUITG[c.suit]+'</div>'+(TAG(c.rank)?'<div class="tg">'+TAG(c.rank)+'</div>':'');return f;
}
function mk(key,card,x,y,o){
  o=o||{};var el=document.createElement('div');el.className='card';el.innerHTML='<div class="lift"><div class="flip"><div class="back"></div></div></div>';
  if(card)el.querySelector('.flip').appendChild(faceEl(card));
  var sp={key:key,card:card,el:el,x:x,y:y,r:0,s:o.s||1,up:!!o.up,role:''};el._sp=sp;cardsL.appendChild(el);sprites.set(key,sp);
  put(sp,{x:x,y:y,s:sp.s,up:sp.up,z:o.z||300},{dur:0});void el.offsetWidth;return sp;
}
function put(sp,t,o){
  o=o||{};for(var k in t)sp[k]=t[k];var el=sp.el,dur=(o.dur===undefined?170:o.dur)/S.speed;
  el.style.transition=dur?'transform '+dur+'ms '+(o.ease||'cubic-bezier(.2,1.3,.4,1)')+' '+(o.delay||0)/S.speed+'ms':'none';
  el.style.transform='translate('+sp.x+'px,'+sp.y+'px) rotate('+(sp.r||0)+'deg) scale('+(sp.s||1)+')';
  if(sp.z!==undefined)el.style.zIndex=sp.z;el.classList.toggle('down',!sp.up);
}
function kill(sp,fade){sprites.delete(sp.key);if(fade){sp.el.classList.add('gone');setTimeout(function(){sp.el.remove()},260)}else sp.el.remove()}
function clearAll(){maxDeck=0;sprites.forEach(function(sp){sp.el.remove()});sprites.clear();swapSel=null;busy=false}
function posOf(seat){if(seat===view.you)return{x:HAND.x,y:HAND.y};return OPP[oppSeats.indexOf(seat)]}
// a spectator watches from a seat's side of the table but is never that player
function isMe(seat){return !view.spectator&&seat===view.you}
// only the Assisted difficulty greys out and locks cards that cannot be played; Normal blocks the throw, Expert punishes it
function dims(){return R().difficulty==='assisted'}
function myTurn(){return view&&!view.spectator&&view.phase==='playing'&&view.current===view.you&&!view.pendingJoker}
function pileT(k,c){return{x:PILE.x-k*38+(k?jit(c.id,5):0),y:PILE.y-k*9,r:k?-8-k*3+jit(c.id,4):jit(c.id,6),s:1.3-k*.08,up:true}}

// loadout phase: hand on the left, reserve on the right of the same row, labelled
function at2(e,t,x,y){e.textContent=t;e.style.left=x+'px';e.style.top=y+'px';e.style.display='block'}
function swapLabels(v){
  var L=[$('#lbl1'),$('#lbl2'),$('#lbl3')];L.forEach(function(e){e.style.display='none'});
  if(v.spectator){at2(L[0],v.players[v.you].name.toUpperCase(),HAND.x,HAND.y+82);return}
  if(v.phase!=='swap')return; // stays up after READY, while the others finish their loadout
  function at(e,t,x,y){e.textContent=t;e.style.left=x+'px';e.style.top=y+'px';e.style.display='block'}
  at(L[0],'YOUR HAND',HANDX,HAND.y+82);at(L[1],'YOUR RESERVE',RESX,HAND.y+82);
}
function layout(o){
  o=o||{};var v=view,used=new Set(),ni=0,from=o.from||spawnFrom||DECK;
  function T(key,card,t,role,k,org){
    var sp=sprites.get(key);
    if(sp&&isHeld(key)){used.add(key);return sp}
    if(!sp){org=org||from;sp=mk(key,card,org.x,org.y,{s:.5});put(sp,t,{delay:(o.stagger||0)*ni++,dur:o.dur||260})}else put(sp,t,{dur:o.dur});
    sp.role=role;sp.k=k;used.add(key);sp.el.style.pointerEvents=(role==='opp'||role==='deck')?'none':'';sp.el.classList.remove('sel','ghost','eff','live','held','dead','t1','t2','t3','t4','t5');return sp;
  }
  var mineTurn=myTurn()&&v.phase==='playing',pl=v.playable||[];
  sel=sel.filter(function(id){return mineTurn&&zoneCards().some(function(c){return c.id===id})});
  var n=v.pile.length,effI=-1;for(var i=n-1;i>=0;i--)if(!(R().r3&&v.pile[i].rank===3)){effI=i;break}
  v.pile.forEach(function(c,i){
    var k=n-1-i,t=pileT(k,c);t.z=100+i;var sp=T('c'+c.id,c,t,'pile');
    if(k)sp.el.classList.add('t'+k);sp.el.classList.toggle('ghost',R().r3&&c.rank===3&&i>effI);sp.el.classList.toggle('eff',i===effI&&effI<n-1);
  });
  v.players.forEach(function(p){
    var me=p.seat===v.you&&!v.spectator,cam=p.seat===v.you&&v.spectator,k;
    if(me){
      var big=v.phase==='playing'&&v.zone!=='hand'&&v.zone!==null,act=myTurn()||v.phase==='swap',sw=v.phase==='swap';
      for(k=0;k<p.downCount;k++){
        var d=T('d0_'+k,null,sw?{x:RESX+(k-(p.downCount-1)/2)*118,y:HAND.y-22,s:1,r:-4,z:150+k,up:false}:big?{x:HAND.x+(k-(p.downCount-1)/2)*118,y:HAND.y+(p.up.length?16:0),s:1,r:-4,z:150+k,up:false}:{x:RES.x+k*54,y:RES.y+6,s:.5,r:-4,z:150+k,up:false},'down',k);
        if(big&&!p.up.length)d.el.classList.add('live');
      }
      p.up.forEach(function(c,k){
        var rz=sel.indexOf(c.id)>=0&&big;
        var u=T('c'+c.id,c,sw?{x:RESX+(k-(p.up.length-1)/2)*118,y:HAND.y-6,s:1,r:-4,z:160+k,up:true}:big?{x:HAND.x+(k-(p.up.length-1)/2)*118,y:HAND.y-(rz?38:0),s:1,r:-4,z:160+k,up:true}:{x:RES.x+k*54,y:RES.y-8,s:.5,r:-4,z:160+k,up:true},'up',k);
        if(v.zone==='up'||v.phase==='swap'){if(dims()&&mineTurn&&v.zone==='up'&&pl.indexOf(c.rank)<0)u.el.classList.add('dead');else u.el.classList.add('live')}
        if(rz||(sw&&swapSel===c.id))u.el.classList.add('sel');
      });
      var hn=v.hand.length,mid=(hn-1)/2,gap=Math.min(98,720/Math.max(1,hn-1));
      v.hand.forEach(function(c,i){
        var rz=sel.indexOf(c.id)>=0;
        var hx=sw?HANDX+(i-mid)*Math.min(98,300/Math.max(1,hn-1)):HAND.x+(i-mid)*gap;
        var h=T('c'+c.id,c,{x:hx,y:HAND.y+(act?-10:6)-(rz?38:0),r:-4,s:1,z:200+i,up:true},'hand',i);
        if(dims()&&mineTurn&&v.zone==='hand'&&pl.indexOf(c.rank)<0)h.el.classList.add('dead');else h.el.classList.add('live');
        if(swapSel===c.id||rz)h.el.classList.add('sel');
      });
    }else{
      var sl=oppSeats.indexOf(p.seat),P=cam?{x:HAND.x,y:HAND.y-20}:OPP[sl],rp=cam?{x:RES.x,y:RES.y}:resPos(P),bx=rp.x,by=rp.y,hs_=cam?.8:.5;
      var hn2=p.handCount,fcx=P.x,fcy=P.y+(cam?0:52),st=Math.min(cam?46:24,(cam?420:190)/Math.max(1,hn2-1)),ang=Math.min(5,60/Math.max(1,hn2-1)),half=(hn2-1)/2,arc=Math.min(.9,30/Math.max(1,half*half));
      for(k=0;k<hn2;k++){var dx=k-half;var hs=T('h'+p.seat+'_'+k,null,{x:fcx+dx*st,y:fcy+dx*dx*arc,r:dx*ang,s:hs_,z:10+k,up:false},'opp',k);hs.el.style.setProperty('--pc',COL[p.seat%6])}
      for(k=0;k<p.downCount;k++)T('d'+p.seat+'_'+k,null,{x:bx+k*(cam?54:44),y:by+6,s:cam?.5:.4,r:-4,z:20+k,up:false},'opp');
      p.up.forEach(function(c,k){T('c'+c.id,c,{x:bx+k*(cam?54:44),y:by-4,s:cam?.5:.4,r:-4,z:30+k,up:true},'opp')});
    }
  });
  maxDeck=Math.max(maxDeck,v.deckCount);var dn=v.deckCount,dl=dn<=0?0:dn<=3?dn:3+Math.min(5,Math.max(1,Math.round(5*(dn-3)/Math.max(1,maxDeck-3))));
  for(var di=0;di<dl;di++)T('k'+di,null,{x:DECK.x-di*2,y:DECK.y-di*2.5,s:.7,r:0,z:5+di,up:false},'deck',di,{x:DECK.x,y:DECK.y});
  sprites.forEach(function(sp){if(!used.has(sp.key))kill(sp,true)});
  spawnFrom=null;hud();
}

// ---------- HUD
function buildPanels(){
  var host=$('#panels');host.innerHTML='';panels={};var n=view.players.length;oppSeats=[];for(var k=1;k<n;k++)oppSeats.push((view.you+k)%n);
  var names=SLOTSETS[oppSeats.length]||SLOTSETS[5];
  OPP=names.map(function(nm){var P=Object.assign({},SLOT[nm]);if(nm==='top'&&names.length===5)P.res='under';return P});
  oppSeats.forEach(function(seat,i){
    var el=document.createElement('div');el.className='panel';el.style.left=OPP[i].x+'px';el.style.top=OPP[i].y+'px';el.style.setProperty('--pc',COL[seat%6]);
    var nm=view.players[seat].name.toUpperCase();
    el.innerHTML='<div class="in"><div class="av"></div><div><div class="nm"></div></div></div><div class="st"></div>';
    el.querySelector('.av').textContent=nm[0];el.querySelector('.nm').textContent=nm;
    el.addEventListener('click',function(){if(view.spectator)return sim.send({type:'cam',seat:seat});var pj=view.pendingJoker;if(pj&&!view.rules.randomJoker&&!pj.parry&&pj.by===view.you)sim.send({type:'joker',target:seat})});
    if(view.spectator)el.style.cursor='pointer';
    host.appendChild(el);panels[seat]=el;
  });
}
function shortRule(r){
  if(r.indexOf('Anything')===0)return'FREE HIT: ANYTHING GOES';
  if(r.indexOf('7 or lower')===0)return'LOW BLOW: 7 OR UNDER';
  if(r.indexOf('J (')===0)return'JACKS ONLY';
  return'BEAT IT: '+r.split(' ')[0]+' OR HIGHER';
}
var lastCount=-1;
function setCount(n){var e=$('#count');if(n===lastCount)return;lastCount=n;e.textContent=n;var h=Math.min(1,n/16);
  e.style.webkitTextStroke='5px '+(h<.35?'#ffffff':h<.7?'#ffe600':'#ff2e88');e.classList.remove('p');void e.offsetWidth;e.classList.add('p')}
function hud(){
  var v=view,mt=myTurn(),me=v.players[v.you];
  setCount(v.pileCount);$('#deckn').textContent=v.deckCount>0?v.deckCount:'';
  var pj=v.pendingJoker,choosing=!!(pj&&!v.spectator&&!v.rules.randomJoker&&!pj.parry&&pj.by===v.you),deciding=!!(pj&&!v.spectator&&pj.parry&&pj.parry.to===v.you);
  $('#rule span').textContent=v.phase==='swap'?'LOADOUT: SWAP HAND AND RESERVE':pj?(pj.parry?(deciding?'PARRY IT OR EAT IT':v.players[pj.parry.to].name.toUpperCase()+' MAY PARRY...'):choosing?'PICK YOUR VICTIM':(pj.by===v.you&&v.rules.randomJoker?'RANDOM VICTIM...':'JOKER...')):shortRule(v.restriction);
  $('#parry').style.display=deciding?'block':'none';$('#parrybtn').style.display=v.parryId!=null?'':'none';
  $('#ring').classList.toggle('ccw',v.direction===-1);
  var w=$('#wedge');
  if(v.phase==='playing'){var cs=v.pendingJoker?(v.pendingJoker.parry?v.pendingJoker.parry.to:v.pendingJoker.by):v.current;w.style.opacity=1;w.style.background=COL[cs%6];w.style.clipPath=cs===v.you?WME:OPP[oppSeats.indexOf(cs)].wedge}else w.style.opacity=v.phase==='swap'?.0:.2;
  v.players.forEach(function(p){
    var el=panels[p.seat];if(!el)return;var out=!p.active&&v.phase!=='swap';
    el.classList.toggle('cur',v.phase==='playing'&&!v.pendingJoker&&v.current===p.seat);el.classList.toggle('out',out);el.classList.toggle('ready',v.phase==='swap'&&p.ready);el.classList.toggle('offline',!!(v.seats[p.seat]&&!v.seats[p.seat].connected));
    el.querySelector('.st').textContent=out?'OUT':'READY';
  });
  document.body.classList.toggle('choosing',choosing);
  cardsL.classList.toggle('dim',v.phase==='playing'&&!mt);
  var tb=$('#throwbtn');tb.style.display=(sel.length&&mt)?'block':'none';tb.firstChild.nodeValue='THROW'+(sel.length>1?' \u00d7'+sel.length:'');
  $('#take').classList.toggle('pulse',!!(mt&&v.canPickup&&v.zone!=='down'&&!(v.playable&&v.playable.length)));
  $('#take').style.display=v.phase==='swap'?'none':'';$('#take').classList.toggle('off',!v.canPickup);
  $('#ready').style.display=!v.spectator&&v.phase==='swap'&&!me.ready?'block':'none';
  $('#actions').style.display=v.spectator?'none':'';
  $('#reslab').style.display=(v.phase==='playing'&&v.zone!=='hand')||v.phase==='swap'||!me.active||v.spectator?'none':'';
  swapLabels(v);document.body.classList.toggle('inswap',v.phase==='swap'&&!v.spectator);document.body.classList.toggle('watching',!!v.spectator);
}

// ---------- input: tap = throw, hold = charge same rank, drag/flick = aim yourself
var hold=null,xn=$('#xn'),sel=[],lastTap={id:0,t:0};
function pt(e){var r=fitEl.getBoundingClientRect();return{x:(e.clientX-r.left)/scale,y:(e.clientY-r.top)/scale}}
function zoneCards(){return view.zone==='hand'?view.hand:view.zone==='up'?view.players[view.you].up:[]}
function isHeld(key){return !!hold&&((hold.swap&&hold.sp.key===key)||(!!hold.ids&&hold.moved&&hold.ids.some(function(id){return 'c'+id===key})))}
function byId(id){return zoneCards().find(function(c){return c.id===id})}
function okRank(c){return !dims()||view.playable.indexOf(c.rank)>=0}
function selCards(){return sel.map(byId).filter(Boolean)}
// same rank, or 6s together with 7s (put in 6,7,6,7 order on the throw)
function canJoin(c,cur){
  var all=cur.concat([c]),rs=[];all.forEach(function(x){if(rs.indexOf(x.rank)<0)rs.push(x.rank)});
  if(rs.length===1)return true;
  if(R().combo&&rs.length===2&&rs.indexOf(6)>=0&&rs.indexOf(7)>=0)return true;
  return false;
}
function raise(c){var cur=selCards();if(cur.length&&!canJoin(c,cur))cur=[];sel=cur.concat([c]).map(function(x){return x.id})}
function raiseRank(c){
  var cs=zoneCards().filter(function(x){return x.rank===c.rank});sel=cs.map(function(x){return x.id});
  if(R().combo&&(c.rank===6||c.rank===7)){var o=zoneCards().filter(function(x){return x.rank===(c.rank===6?7:6)});if(o.length===cs.length)sel=comboOrder(sel.concat(o.map(function(x){return x.id})))}
}
// a 67 must go 6,7,6,7...: interleave the selected 6s and 7s, leftovers at the end (the server then refuses it)
function comboOrder(ids){
  var cs=ids.map(byId),six=[],sev=[],out=[];
  if(!cs.every(function(c){return c&&(c.rank===6||c.rank===7)}))return ids;
  cs.forEach(function(c){(c.rank===6?six:sev).push(c.id)});
  for(var i=0;i<Math.max(six.length,sev.length);i++){if(i<six.length)out.push(six[i]);if(i<sev.length)out.push(sev[i])}
  return out;
}
function lower(c){sel=sel.filter(function(id){return id!==c.id})}
function stackTo(x,y,dur){hold.ids.forEach(function(id,i){var sp=sprites.get('c'+id);if(sp)put(sp,{x:x-i*12,y:y-i*12,r:-4+i*5,s:1.12,z:900-i},{dur:dur})});xn.style.transform='translate('+(x+56)+'px,'+(y-110)+'px)'}
function doThrow(){if(!sel.length||busy||!myTurn())return;var ids=comboOrder(sel);sel=[];throwCards(ids)}
stage.addEventListener('pointerdown',function(e){
  if(!view||busy)return;if(e.target.closest&&e.target.closest('button,.panel'))return;
  var el=e.target.closest&&e.target.closest('.card'),p=pt(e);
  if(!el||el._sp.role==='pile'){if(sel.length&&view.phase==='playing'&&Math.hypot(p.x-PILE.x,p.y-PILE.y)<170)doThrow();return}
  var sp=el._sp;
  if(view.phase==='swap'){if((sp.role==='hand'||sp.role==='up')&&!view.players[view.you].ready){hold={swap:true,sp:sp,sx:p.x,sy:p.y,ox:sp.x,oy:sp.y,moved:false};try{stage.setPointerCapture(e.pointerId)}catch(_){}}return}
  if(view.phase!=='playing'||!(sp.role==='hand'||sp.role==='up'||sp.role==='down'))return;
  if(!myTurn()){nope(sp,view.pendingJoker?'PICK A TARGET':'NOT YOUR TURN');return}
  if(sp.role==='down'){if(view.zone!=='down'){nope(sp,'FACE-UP FIRST');return}lastDownK=sp.k;busy=true;sim.send({type:'play',ids:[view.downIds[sp.k]]});return}
  if(sp.role!==view.zone){nope(sp,'HAND FIRST');return}
  var c=sp.card;if(!okRank(c))return;
  var was=sel.indexOf(c.id)>=0;
  var tnow=performance.now(),dbl=lastTap.id===c.id&&tnow-lastTap.t<320;
  if(dbl){raiseRank(c);sfx.raise(2);lastTap={id:0,t:0}} // second press of a double-tap: grab the whole rank right away, so a drag carries it
  else if(!was){raise(c);sfx.raise(Math.max(0,sel.length-1))}
  hold={sp:sp,was:was,dbl:dbl,sx:p.x,sy:p.y,moved:false,hist:[{y:p.y,t:performance.now()}]};
  layout({dur:110});try{stage.setPointerCapture(e.pointerId)}catch(_){}
});
stage.addEventListener('pointermove',function(e){
  if(!hold)return;var p=pt(e),now=performance.now();
  if(!hold.moved){
    if(Math.hypot(p.x-hold.sx,p.y-hold.sy)<=9)return;
    hold.moved=true;document.body.classList.add('dragging');
    if(!hold.swap){hold.ids=sel.slice();if(hold.ids.length>1){xn.textContent='x'+hold.ids.length;xn.style.display='block'}hold.sp.el.classList.add('held');hold.first=true}
  }
  if(hold.swap){put(hold.sp,{x:hold.ox+p.x-hold.sx,y:hold.oy+p.y-hold.sy,s:1.1,z:900},{dur:0});return}
  hold.hist.push({y:p.y,t:now});while(hold.hist.length>2&&now-hold.hist[0].t>120)hold.hist.shift();
  stackTo(p.x,p.y-30,hold.first?90:0);hold.first=false;
});
function pairSwap(a,b){var hand=a.role==='hand'?a:b,up=a.role==='up'?a:b;sim.send({type:'swap',handId:hand.card.id,upId:up.card.id})}
function endHold(){document.body.classList.remove('dragging');xn.style.display='none'}
stage.addEventListener('pointercancel',function(){if(!hold)return;var h=hold;hold=null;endHold();if(h.sp.el)h.sp.el.classList.remove('held');layout()});
addEventListener('keydown',function(e){if(e.key==='Escape'){if($('#rules').classList.contains('open')){$('#rules').classList.remove('open');return}if($('#settings').classList.contains('open')){closeSettings();return}if(hold){var h=hold;hold=null;endHold();h.sp.el.classList.remove('held');layout()}else if(sel.length){sel=[];layout()}}});
stage.addEventListener('pointerup',function(e){
  if(!hold)return;var h=hold,p=pt(e);hold=null;endHold();
  if(h.swap){ // a hand card and a reserve card trade places; either one can be picked first, by tap or by drag onto the other
    var me=h.sp,other=me.role==='hand'?'up':'hand';
    if(h.moved){
      var best=null,bd=70;sprites.forEach(function(q){if(q.role===other){var d=Math.hypot(q.x-p.x,q.y-p.y);if(d<bd){bd=d;best=q}}});
      swapSel=null;if(best)return pairSwap(me,best);return layout(); // dropped on nothing: snap back
    }
    var first=swapSel!=null&&swapSel!==me.card.id?sprites.get('c'+swapSel):null;
    if(first&&first.role===other){swapSel=null;return pairSwap(first,me)}
    swapSel=swapSel===me.card.id?null:me.card.id;sfx.raise(0);return layout();
  }
  h.sp.el.classList.remove('held');
  var c=h.sp.card;
  if(!h.moved){ // tap: raise (done on press) or lower; double-tap raises the whole rank
    if(!h.dbl){lastTap={id:c.id,t:performance.now()};if(h.was){lower(c);sfx.lower()}}
    return layout({dur:110});
  }
  var dy=h.sy-p.y,o=h.hist[0],v=(p.y-o.y)/Math.max(1,performance.now()-o.t); // px/ms, negative = upward
  if(dy>90||(v<-.8&&dy>35))doThrow();else layout(); // dropped back near the hand: cancel, selection stays
});
async function throwCards(ids){
  if(busy)return;busy=true;sfx.whoosh();
  ids.forEach(function(id,i){var sp=sprites.get('c'+id);sp.role='fly';put(sp,{x:PILE.x+i*10,y:PILE.y+i*6,r:jit(id,14),s:1.3,z:800+i},{dur:105,ease:'cubic-bezier(.5,0,1,.6)'})});
  await wait(105);sim.send({type:'play',ids:ids});
}
function nope(sp,msg){sfx.block();trauma=Math.min(1,trauma+.3);stamp(msg,640,520,{fg:'#fff',bg:'#ff2e88',size:38,dur:800,r:-3})}
$('#take').addEventListener('click',function(){if(view.phase==='playing'&&!busy)sim.send({type:'pickup'})});
$('#ready').addEventListener('click',function(){sim.send({type:'ready'})});
addEventListener('keydown',function(e){
  if(e.target&&e.target.tagName==='INPUT')return;
  if(!view||$('#fit').style.display==='none'||$('#settings').classList.contains('open'))return;
  var pj=view.pendingJoker;
  if(pj&&!view.spectator&&pj.parry&&pj.parry.to===view.you){if(e.key===' '||e.key==='e'){e.preventDefault();$('#eatbtn').click()}else if((e.key==='p'||e.key==='Enter')&&view.parryId!=null)$('#parrybtn').click();return}
  if(e.key===' '){e.preventDefault();$('#take').click()}
  else if(e.key==='Enter'){if(view.phase==='swap')$('#ready').click();else doThrow()}
  else if(e.code&&e.code.indexOf('Digit')===0&&view.phase==='playing'&&myTurn()&&!busy){
    var i=+e.code.slice(5)-1;
    if(view.zone==='down'){if(view.downIds[i]!==undefined){lastDownK=i;busy=true;sim.send({type:'play',ids:[view.downIds[i]]})}return}
    var c=zoneCards()[i];if(!c||!okRank(c))return;
    if(e.shiftKey)raiseRank(c);else if(sel.indexOf(c.id)>=0)lower(c);else raise(c);
    sfx.raise(Math.max(0,sel.length-1));layout({dur:110});
  }
});

// ---------- sim wiring
var sim={send:function(m){window.Net.send(m)}};
sim.onError=async function(msg){
  var fl=[];sprites.forEach(function(sp){if(sp.role==='fly')fl.push(sp)});
  sfx.block();var r=$('#rule');r.classList.remove('bad');void r.offsetWidth;r.classList.add('bad');
  if(fl.length){
    spark(PILE.x,PILE.y,14,['#fff','#ff2e88'],18);await hitstop(70,false);trauma=.6;
    stamp('BLOCKED!',640,250,{fg:'#fff',bg:'#ff2e88',size:84,dur:750});
    stamp(msg.toUpperCase(),640,345,{fg:'#ff2e88',bg:'#000',size:24,dur:1300,r:-3});
    fl.forEach(function(sp){put(sp,{x:sp.x+jit(sp.card.id,160),y:sp.y+150,r:sp.r+540,s:1},{dur:230,ease:'ease-out'})});
    await wait(240);
  }else stamp(msg.toUpperCase(),640,520,{fg:'#fff',bg:'#ff2e88',size:34,dur:900,r:-3});
  busy=false;layout({dur:260});
};
var MULTI=['','','DOUBLE!','TRIPLE!','QUAD!'];
async function impact(ev){
  var n=ev.cards.length,r=ev.cards[n-1].rank,special=!!TAG(r)||r===15,bigHit=n>1||special,c=COL[ev.seat%6];
  setCount(ev.pileBefore+n);
  spark(PILE.x,PILE.y,8+n*6,['#fff',c],14+n*5);
  sfx.hit(n,ev.seat);sfx.sting(r,ev.seat);
  if(bigHit){await hitstop(70+n*35,true);flash(c,.35,200)}else{await hitstop(38,false)}
  trauma=Math.min(1,trauma+.28+n*.14);
  var combo=ev.cards.some(function(x){return x.rank===6})&&ev.cards.some(function(x){return x.rank===7});
  if(combo)stamp(n>2?'67 x'+n/2+'!':'67!',PILE.x-190,PILE.y-120,{fg:'#000',bg:c,size:80,dur:900,r:-10});
  else if(n>1)stamp(MULTI[n]||n+' HIT!',PILE.x-190,PILE.y-120,{fg:'#000',bg:c,size:60,dur:800,r:-10});
  if(r===2)stamp('RESET',PILE.x+190,PILE.y-135,{size:50,dur:800,r:6});
  if(r===3&&R().r3)stamp('GHOST: LOOK THROUGH IT',PILE.x+190,PILE.y-135,{size:30,dur:1000,r:5,fg:'#19e3ff'});
  if(r===7)stamp('LOW BLOW!',PILE.x+190,PILE.y-135,{size:50,dur:800,r:6,fg:'#19e3ff'});
  if(r===11)stamp('JACKS ONLY',PILE.x+190,PILE.y-135,{size:46,dur:800,r:6});
}
var A={
  deal:async function(){clearAll();$('#over').classList.remove('on');buildPanels();layout({stagger:30});sfx.reset();for(var i=0;i<10;i++)sfx.deal(i,i*.06);await wait(700);stamp('LOADOUT',640,300,{size:90,dur:900})},
  setup:async function(){clearAll();$('#over').classList.remove('on');buildPanels();layout({stagger:12});await wait(500)},
  swap:async function(){sfx.swap()},
  ready:async function(ev){sfx.ready()},
  begin:async function(ev){sfx.fight();await hitstop(120,true);await wait(380);stamp('FIGHT!',640,300,{size:150,dur:800,fg:'#000',bg:'#ffe600'});trauma=.7;await wait(650)},
  play:async function(ev){
    var mine=isMe(ev.seat),n=ev.cards.length,src=posOf(ev.seat),need=false;
    sprites.forEach(function(sp){if(sp.role==='pile'){var k=(sp._pk||0)+n;sp._pk=k;put(sp,{x:sp.x-38*n,y:sp.y-9*n,s:Math.max(.8,sp.s-.08*n)},{dur:90});sp.el.classList.add('t'+Math.min(5,k))}});
    for(var i=0;i<n;i++){
      var c=ev.cards[i],sp=sprites.get('c'+c.id);
      if(!sp){
        var o=src;if(!mine&&!ev.blind){var fk=-1,fs=null;sprites.forEach(function(q){if(q.key.indexOf('h'+ev.seat+'_')===0&&q.k>fk){fk=q.k;fs=q}});if(fs){o={x:fs.x,y:fs.y};kill(fs)}}if(ev.blind){var ds=sprites.get('d'+ev.seat+'_'+(mine?lastDownK:view.players[ev.seat].downCount-1));if(ds){o={x:ds.x,y:ds.y};kill(ds)}}
        sp=mk('c'+c.id,c,o.x,o.y,{s:mine?1:.5,z:800});
      }
      if(sp.role!=='fly'||ev.blind){
        need=true;sp.role='fly';sp.el.classList.remove('live','held');
        put(sp,{x:PILE.x+i*10,y:PILE.y+i*6,r:jit(c.id,14)+(ev.blind?360:0),s:1.3,up:true,z:800+i},{dur:ev.blind?520:120,ease:ev.blind?'cubic-bezier(.3,0,.6,1)':'cubic-bezier(.5,0,1,.6)'});
      }
    }
    if(need){sfx.whoosh(ev.seat);await wait(ev.blind?520:120)}
    await impact(ev);
    sprites.forEach(function(sp){if(sp.role==='fly'){sp.role='pile';sp._pk=0}});busy=false;await wait(n>1?200:70);
  },
  burn:async function(ev){
    sfx.burn();await hitstop(260,true);flash('#fff',1,500);trauma=1;
    stamp(ev.by==='four'?'FOUR OF A KIND':ev.by==='combo'?'TRIPLE 67':'TEN!',640,170,{size:50,dur:1000,fg:'#000',bg:'#ffe600',r:-4});
    stamp('BURN!!',640,300,{size:190,dur:1000,fg:'#fff',bg:'#ff2e88',r:-8});
    spark(PILE.x,PILE.y,46,['#fff','#ffe600','#ff2e88'],34);
    sprites.forEach(function(sp){if(sp.role==='pile'||sp.role==='fly'){put(sp,{x:BURN.x+jit(sp.card.id,80),y:BURN.y+jit(sp.card.id+3,200),r:700,s:.6},{dur:300,delay:Math.random()*120,ease:'cubic-bezier(.6,0,1,.4)'});(function(sp){setTimeout(function(){kill(sp)},430)})(sp)}});
    setCount(0);await wait(820);
    stamp(isMe(ev.seat)?'GO AGAIN!':view.players[ev.seat].name.toUpperCase()+' GOES AGAIN',640,440,{size:44,dur:800,r:-3});await wait(300);
  },
  pickup:async function(ev){if(ev.penalty){stamp('MISPLAY! TAKE IT',640,250,{fg:'#fff',bg:'#ff2e88',size:60,dur:900});sfx.block();trauma=Math.min(1,trauma+.4);await wait(300)}await eat(ev.seat,ev.count)},
  flipfail:async function(ev){
    var mine=isMe(ev.seat),ds=sprites.get('d'+ev.seat+'_'+(mine?lastDownK:view.players[ev.seat].downCount-1)),o=ds?{x:ds.x,y:ds.y}:posOf(ev.seat);
    if(ds)kill(ds);var sp=mk('c'+ev.card.id,ev.card,o.x,o.y,{s:mine?1:.5,z:800});sp.role='pile';
    sfx.whoosh();put(sp,{x:PILE.x+30,y:PILE.y+20,r:372,s:1.3,up:true},{dur:520,ease:'cubic-bezier(.3,0,.6,1)'});await wait(520);
    sfx.block();spark(PILE.x,PILE.y,16,['#fff','#ff2e88'],20);await hitstop(160,true);trauma=.8;
    stamp('BLOCKED!',640,250,{fg:'#fff',bg:'#ff2e88',size:90,dur:800});await wait(500);busy=false;
    await eat(ev.seat,ev.count);
  },
  joker:async function(ev){
    sfx.joker();await hitstop(240,true);trauma=1;flash('#ff2e88',.6,400);
    stamp('JOKER!',640,300,{size:170,dur:1000,fg:'#ffe600',bg:'#000',r:8});
    sprites.forEach(function(sp){if(sp.card&&sp.card.rank===15&&(sp.role==='pile'||sp.role==='fly')){put(sp,{x:BURN.x,y:BURN.y,r:900,s:.5},{dur:400,ease:'ease-in'});setTimeout(function(){kill(sp)},400)}});
    await wait(900);
  },
  give:async function(ev){if(ev.revived)stamp('DRAGGED BACK IN!',640,170,{size:48,dur:1100,fg:'#fff',bg:'#ff2e88'});await eat(ev.target,ev.count)},
  reverse:async function(ev){sfx.four(ev.seat);var r=$('#ring');r.classList.add('snap');r.classList.toggle('ccw',ev.direction===-1);setTimeout(function(){r.classList.remove('snap')},500);stamp('REVERSE!',PILE.x+190,PILE.y-135,{size:54,dur:800,r:6,fg:'#19e3ff'});await wait(420)},
  skip:async function(ev){sfx.eight(ev.seat);stamp(ev.n>1?'SKIP x'+ev.n+'!':'SKIP!',PILE.x+190,PILE.y-135,{size:60,dur:800,r:6,fg:'#ff7a1a'});await wait(420)},
  draw:async function(ev){sfx.draw(ev&&ev.seat)},
  out:async function(ev){var me=isMe(ev.seat),p=posOf(ev.seat);stamp(me?'YOU ARE OUT!':'OUT!',me?640:p.x,me?560:p.y,{size:me?90:60,dur:1200,fg:'#000',bg:COL[ev.seat%6]});sfx.out(me,ev.seat);spark(me?640:p.x,me?560:p.y,24,['#fff',COL[ev.seat%6]],22);await wait(600)},
  turn:async function(ev){if(isMe(ev.seat)&&!view.pendingJoker&&view.players[view.you].active){sfx.turn();stamp('YOUR HIT',640,520,{size:40,dur:600,fg:'#000',bg:'#ffe600',r:-3})}},
  end:async function(ev){
    await wait(400);var v=view,lost=isMe(ev.shithead);
    if(lost)sfx.lose();else sfx.win();await hitstop(350,true);trauma=1;
    $('#over').style.setProperty('--oc',lost?'#ff2e88':'#ffe600');$('#oh').textContent=lost?'SHITHEAD':'SURVIVED';
    $('#os').textContent=lost?'LAST ONE HOLDING CARDS. THAT IS YOU.':v.players[ev.shithead].name.toUpperCase()+' IS THE SHITHEAD';
    var pl=$('#places');pl.innerHTML='';
    v.finished.concat([ev.shithead]).forEach(function(s,i,a){var d=document.createElement('div');if(i===a.length-1)d.className='sh';d.innerHTML='<b>'+(i===a.length-1?'☠':'#'+(i+1))+'</b>'+(isMe(s)?'YOU':v.players[s].name.toUpperCase());pl.appendChild(d)});
    $('#again').textContent=v.host?'REMATCH':'WAITING FOR HOST';$('#again').disabled=!v.host;$('#tolobby').style.display=v.host?'':'none';$('#over').classList.add('on');
  }
};
async function eat(seat,count){
  var me=isMe(seat),p=posOf(seat),ps=[];sprites.forEach(function(sp){if(sp.role==='pile'||sp.role==='fly')ps.push(sp)});
  sfx.take(seat);await hitstop(90,false);trauma=Math.min(1,trauma+.6);flash(COL[seat%6],.3,300);
  stamp((me?'YOU EAT ':'EATS ')+count+'!',me?640:p.x,me?470:p.y+(p.y<100?90:-80),{fg:'#fff',bg:'#ff2e88',size:me?70:44,dur:1000});
  spawnFrom=PILE;if(me)return;
  ps.forEach(function(sp,i){put(sp,{x:p.x,y:p.y,s:.3,r:400},{dur:200,delay:i*25,ease:'ease-in'});setTimeout(function(){kill(sp)},200+i*25)});
  await wait(200+ps.length*25);var pe=panels[seat];if(pe){pe.classList.remove('hit');void pe.offsetWidth;pe.classList.add('hit')}spark(p.x,p.y,12,['#fff',COL[seat%6]],16);await wait(200);
}
sim.onState=async function(v,events){
  if(!view){view=v;buildPanels();if(S.speed!==1&&v.host)Net.send({type:'speed',v:S.speed})}else if(v.players.length!==view.players.length||v.spectator!==view.spectator||(v.spectator&&v.you!==view.you)){view=v;clearAll();buildPanels();layout()}
  for(var i=0;i<events.length;i++){
    var ev=events[i];
    if(ev.t==='deal'||ev.t==='setup'||ev.t==='turn'||ev.t==='end'||ev.t==='begin'||ev.t==='out'){view=v;if(ev.t==='turn'||ev.t==='begin'||ev.t==='out')layout(ev.t==='begin'?{dur:450}:undefined)}
    if(A[ev.t])await A[ev.t](ev);
  }
  view=v;busy=false;layout();
};

// ---------- parry (joker deflect) animations
async function flyJoker(seat){
  var me=isMe(seat),sp=null;
  if(me)sprites.forEach(function(q){if(!sp&&q.card&&q.card.rank===15&&q.role==='hand')sp=q});
  if(!sp){var p=posOf(seat);sp=mk('pj'+Date.now(),{id:-1,rank:15,suit:'X'},p.x,p.y,{s:me?1:.5,z:800,up:true})}
  sp.role='fly';sp.el.classList.remove('live','held','sel');sfx.whoosh(seat);
  put(sp,{x:PILE.x,y:PILE.y,r:360,s:1.3,up:true,z:850},{dur:140,ease:'cubic-bezier(.5,0,1,.6)'});await wait(150);
  sprites.delete(sp.key);sp.el.remove();
}
A.throw=async function(ev){
  var p=posOf(ev.target),me=isMe(ev.target);sfx.whoosh(ev.target);
  stamp('INCOMING!',me?640:p.x,me?470:p.y+(p.y<100?90:-80),{size:60,dur:900,fg:'#000',bg:COL[ev.by%6],r:-5});await wait(300);
};
A.parry=async function(ev){
  await flyJoker(ev.seat);sfx.joker();await hitstop(200,true);trauma=1;flash('#19e3ff',.5,300);
  stamp('PARRY!',640,300,{size:150,dur:900,fg:'#000',bg:'#19e3ff',r:-6});
  var pe=panels[ev.to];if(pe){pe.classList.remove('hit');void pe.offsetWidth;pe.classList.add('hit')}
  await wait(750);
};

// ---------- public interface for net.js
var queue=Promise.resolve();
window.Game={
  push:function(v,events){queue=queue.then(function(){return sim.onState(v,events)}).catch(function(e){console.error(e)})},
  error:function(msg){sim.onError(msg)},
  reset:function(){queue=Promise.resolve();clearAll();view=null;lastCount=-1;maxDeck=0;$('#over').classList.remove('on');$('#parry').style.display='none';hold=null;sel=[];busy=false},
  view:function(){return view},
  show:function(on){$('#fit').style.display=on?'block':'none'}
};
$('#parrybtn').addEventListener('click',function(){sim.send({type:'parry'})});
$('#eatbtn').addEventListener('click',function(){sim.send({type:'accept'})});
$('#throwbtn').addEventListener('click',doThrow);
$('#again').addEventListener('click',function(){if(view&&view.host)sim.send({type:'start'})});
$('#tolobby').addEventListener('click',function(){if(view&&view.host)sim.send({type:'lobby'})});
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button');if(b)sfx.button()});
var lastHov=0;stage.addEventListener('pointerover',function(e){var c=e.target.closest&&e.target.closest('.card.live');if(!c||hold||e.pointerType==='touch')return;var t=performance.now();if(t-lastHov>70){lastHov=t;sfx.hover()}});
document.addEventListener('pointerdown',initAudio,{once:true});
buildSettings();
})();
