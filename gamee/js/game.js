'use strict';
// Water Shoot — prototyp vodního děla pro Gamee.
// Účel: test vodní particle fyziky na mobilech (viz CLAUDE.md).
const WS_VERSION = 'v01';
const WS_CHECKSUM = 'water-shoot-v01';

// ---------------------------------------------------------------- util
function _safeGamee(fn){ try{ fn(); }catch(e){ console.warn('[gamee]', e); } }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function rand(a,b){ return a + Math.random()*(b-a); }

// ---------------------------------------------------------------- stav
let canvas, ctx, W=0, H=0, DPR=1, S=1;        // S = scale faktor (design výška 800)
let bgCanvas=null;                            // prerenderované pozadí (střelnice)
let duckSprite=null, duckSpriteScale=1;       // prerenderovaná kachnička (míří doleva)
let running=false, paused=false, over=false;
let score=0, playTime=0, timeLeft=0;
const ROUND_TIME = 60;

// dělo
const cannon = { x:0, y:0, angle:-Math.PI/2, barrel:0, spraying:false, aimX:0, aimY:0 };

// ---------------------------------------------------------------- particle pool
// Prealokovaný pool, žádné alokace za běhu. type: 0 = proud (koliduje), 1 = splash.
const POOL_HARD_MAX = 20000;
const pool = new Array(POOL_HARD_MAX);
for(let i=0;i<POOL_HARD_MAX;i++) pool[i] = {alive:false,x:0,y:0,vx:0,vy:0,life:0,maxLife:0,size:1,type:0};
let poolCursor = 0, aliveCount = 0;

// laditelné parametry (perf HUD)
const tune = {
  maxParticles: 3000,
  emitRate: 400,        // částic/s při stisku
  size: 3,              // základní poloměr částice (design px)
  splash: 7,            // splash částic na zásah
  collisions: true,
  additive: true,       // 'lighter' blending
};

function spawnParticle(x,y,vx,vy,life,size,type){
  if(aliveCount >= tune.maxParticles) return null;
  // najdi mrtvý slot od kurzoru
  for(let n=0;n<POOL_HARD_MAX;n++){
    const i = (poolCursor+n) % POOL_HARD_MAX;
    const p = pool[i];
    if(!p.alive){
      poolCursor = i+1;
      p.alive=true; p.x=x; p.y=y; p.vx=vx; p.vy=vy;
      p.life=life; p.maxLife=life; p.size=size; p.type=type;
      aliveCount++;
      return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------- kachničky + terče
// 3 dráhy (police s vodním žlabem), hloubka = menší/rychlejší nahoře.
const LANES = [
  { yFrac:0.335, dir: 1, speed:110, scale:0.62, count:3 },
  { yFrac:0.445, dir:-1, speed: 85, scale:0.78, count:3 },
  { yFrac:0.565, dir: 1, speed: 65, scale:0.95, count:2 },
];
const DUCK_HP = 8;            // počet zásahů proudem na sestřelení
let ducks = [];               // {lane,x,knocked,knockT,respawnT,hp,wobble}

// pop-up terče (kruhové, objeví se na čas)
const POPUP_SLOTS = 3;
let popups = [];              // {x,y,state:'hidden'|'in'|'up'|'out',t,ttl}
let popupTimer = 2;

// plovoucí skóre texty (malý pool)
const floaters = [];
for(let i=0;i<24;i++) floaters.push({alive:false,x:0,y:0,t:0,txt:''});

function laneY(lane){ return H * LANES[lane].yFrac; }
function duckRadius(lane){ return 34 * LANES[lane].scale * S; }

function resetEntities(){
  ducks = [];
  for(let l=0;l<LANES.length;l++){
    const L = LANES[l];
    for(let i=0;i<L.count;i++){
      ducks.push({
        lane:l,
        x: (W/L.count)*i + rand(0, W/L.count*0.5),
        knocked:false, knockT:0, respawnT:0, hp:DUCK_HP,
        wobble: rand(0, Math.PI*2),
      });
    }
  }
  popups = [];
  for(let i=0;i<POPUP_SLOTS;i++){
    popups.push({ x: W*(0.22 + i*0.28), y: H*0.235, state:'hidden', t:0, ttl:0, r: 30*S });
  }
  popupTimer = 2;
}

function addFloater(x,y,txt){
  for(const f of floaters){
    if(!f.alive){ f.alive=true; f.x=x; f.y=y; f.t=0; f.txt=txt; return; }
  }
}

// ---------------------------------------------------------------- skóre
let scoreEl=null, timeEl=null;
function addScore(n, x, y){
  score += n;
  if(scoreEl) scoreEl.textContent = score;
  if(x!==undefined) addFloater(x, y, '+'+n);
  _safeGamee(()=>gamee.updateScore(score, playTime, WS_CHECKSUM));
}

// ---------------------------------------------------------------- resize + prerender pozadí
function resize(){
  DPR = Math.min(window.devicePixelRatio||1, 2);   // cap kvůli mobilnímu fill-rate
  W = window.innerWidth; H = window.innerHeight;
  S = H/800;
  canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  cannon.x = W/2; cannon.y = H*0.94; cannon.barrel = 70*S;
  cannon.aimX = W/2; cannon.aimY = H*0.4;
  prerenderBackground();
  prerenderDuck();
  if(running) resetEntities();
}

// Tmavá pouťová vodní střelnice — statická, kreslí se jednou do offscreen canvasu.
function prerenderBackground(){
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = Math.round(W*DPR); bgCanvas.height = Math.round(H*DPR);
  const g = bgCanvas.getContext('2d');
  g.setTransform(DPR,0,0,DPR,0,0);

  // zadní stěna budky — tmavě modrý gradient
  const wall = g.createLinearGradient(0,0,0,H);
  wall.addColorStop(0,'#101830'); wall.addColorStop(0.55,'#16224a'); wall.addColorStop(1,'#0c1226');
  g.fillStyle = wall; g.fillRect(0,0,W,H);

  // svislá tmavá prkna (jemná textura stěny)
  g.fillStyle = 'rgba(0,0,0,0.14)';
  const plankW = 46*S;
  for(let x=plankW; x<W; x+=plankW) g.fillRect(x,0,2,H);

  // markýza / cedule nahoře
  const signH = H*0.13;
  const sg = g.createLinearGradient(0,0,0,signH);
  sg.addColorStop(0,'#7a1220'); sg.addColorStop(1,'#a41c2c');
  g.fillStyle = sg; g.fillRect(0,0,W,signH);
  // zubaté lemování markýzy
  g.fillStyle = '#e8c34a';
  const teeth = 12, tw = W/teeth;
  for(let i=0;i<teeth;i++){
    g.beginPath();
    g.moveTo(i*tw, signH); g.lineTo(i*tw+tw/2, signH+14*S); g.lineTo((i+1)*tw, signH);
    g.closePath(); g.fill();
  }
  // nápis
  g.fillStyle = '#fdf3d0';
  g.font = '700 '+Math.round(34*S)+'px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('WATER SHOOT', W/2, signH*0.52);

  // barevné žárovky po obvodu (okraj obrazovky + pod cedulí)
  const bulbCols = ['#ffd54a','#ff6b6b','#5ad1ff','#7dff8a','#ff9ff3'];
  function bulb(x,y,i,r){
    g.fillStyle = bulbCols[i%bulbCols.length];
    g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(x-r*0.3,y-r*0.3,r*0.35,0,Math.PI*2); g.fill();
  }
  const br = 5*S; let bi=0;
  for(let x=br*3; x<W-br; x+=br*5.2){ bulb(x, signH+22*S, bi++, br); }        // pod markýzou
  for(let y=signH+44*S; y<H*0.86; y+=br*6){ bulb(br*2.2, y, bi++, br); bulb(W-br*2.2, y, bi+3, br); bi++; } // boky

  // police / vodní žlaby pro dráhy kachniček
  for(let l=0;l<LANES.length;l++){
    const y = H*LANES[l].yFrac, sc = LANES[l].scale;
    const shelfH = 26*sc*S;
    // stín pod žlabem
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y+shelfH*0.4, W, 6*S);
    // žlab s vodou
    const wg = g.createLinearGradient(0,y-4*S,0,y+shelfH);
    wg.addColorStop(0,'#2e6fb2'); wg.addColorStop(1,'#173a63');
    g.fillStyle = wg;
    g.fillRect(0, y-4*S, W, shelfH);
    // vlnky na hladině
    g.strokeStyle = 'rgba(160,220,255,0.5)'; g.lineWidth = 2*S;
    g.beginPath();
    for(let x=0;x<=W;x+=18*sc*S){
      g.moveTo(x, y);
      g.quadraticCurveTo(x+9*sc*S, y-5*sc*S, x+18*sc*S, y);
    }
    g.stroke();
  }

  // pult dole (za dělem)
  const counterY = H*0.86;
  const cg = g.createLinearGradient(0,counterY,0,H);
  cg.addColorStop(0,'#5a3a1e'); cg.addColorStop(1,'#3a2412');
  g.fillStyle = cg; g.fillRect(0,counterY,W,H-counterY);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0,counterY,W,4*S);
}

// Kachnička (gumová, míří doleva) — prerender do sprite, za běhu jen drawImage.
function prerenderDuck(){
  const base = 90;                       // design velikost spritu
  duckSpriteScale = S*DPR;
  const sz = Math.ceil(base*duckSpriteScale);
  duckSprite = document.createElement('canvas');
  duckSprite.width = sz; duckSprite.height = sz;
  const g = duckSprite.getContext('2d');
  g.scale(sz/base, sz/base);
  // tělo
  g.fillStyle = '#ffd21f';
  g.beginPath(); g.ellipse(48, 58, 30, 22, 0, 0, Math.PI*2); g.fill();
  // ocásek
  g.beginPath(); g.moveTo(74,52); g.quadraticCurveTo(86,42,80,58); g.quadraticCurveTo(78,62,72,60); g.fill();
  // hlava
  g.beginPath(); g.arc(30, 34, 17, 0, Math.PI*2); g.fill();
  // zobák
  g.fillStyle = '#ff8c1a';
  g.beginPath(); g.ellipse(13, 38, 9, 5, -0.15, 0, Math.PI*2); g.fill();
  // oko
  g.fillStyle = '#1c1c1c';
  g.beginPath(); g.arc(25, 29, 3.2, 0, Math.PI*2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.arc(24, 28, 1.2, 0, Math.PI*2); g.fill();
  // křídlo
  g.fillStyle = '#f0b400';
  g.beginPath(); g.ellipse(52, 58, 13, 8, -0.35, 0, Math.PI*2); g.fill();
  // lesk na těle
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath(); g.ellipse(40, 48, 10, 5, -0.4, 0, Math.PI*2); g.fill();
}

// ---------------------------------------------------------------- vstup
function setupInput(){
  const aim = (e)=>{
    const r = canvas.getBoundingClientRect();
    cannon.aimX = e.clientX - r.left;
    cannon.aimY = e.clientY - r.top;
  };
  canvas.addEventListener('pointerdown', e=>{ e.preventDefault(); aim(e); cannon.spraying=true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e=>{ aim(e); });
  canvas.addEventListener('pointerup',   e=>{ cannon.spraying=false; });
  canvas.addEventListener('pointercancel', ()=>{ cannon.spraying=false; });
}

// ---------------------------------------------------------------- update
let emitAccum = 0;

function update(dt){
  playTime += dt;
  timeLeft -= dt;
  if(timeLeft <= 0){ timeLeft = 0; endRound(); }
  if(timeEl) timeEl.textContent = Math.ceil(timeLeft);

  // úhel děla za cílem (jen nahoru)
  const dx = cannon.aimX - cannon.x, dy = cannon.aimY - cannon.y;
  cannon.angle = clamp(Math.atan2(dy,dx), -Math.PI+0.18, -0.18);

  // emise proudu
  if(cannon.spraying && !over){
    emitAccum += tune.emitRate * dt;
    const mx = cannon.x + Math.cos(cannon.angle)*cannon.barrel;
    const my = cannon.y + Math.sin(cannon.angle)*cannon.barrel;
    const speed = 950*S;
    while(emitAccum >= 1){
      emitAccum -= 1;
      const a = cannon.angle + rand(-0.045, 0.045);
      const sp = speed * rand(0.92, 1.08);
      spawnParticle(mx, my, Math.cos(a)*sp, Math.sin(a)*sp, 1.6, tune.size*S*rand(0.8,1.3), 0);
    }
  } else emitAccum = 0;

  // kachničky
  for(const d of ducks){
    const L = LANES[d.lane];
    if(d.knocked){
      d.knockT += dt;
      if(d.knockT > 0.6 && d.respawnT <= 0) d.respawnT = rand(1.5, 3);
      if(d.respawnT > 0){
        d.respawnT -= dt;
        if(d.respawnT <= 0){
          d.knocked=false; d.knockT=0; d.hp=DUCK_HP;
          d.x = L.dir>0 ? -duckRadius(d.lane)*2 : W+duckRadius(d.lane)*2;
        }
      }
    } else {
      d.x += L.dir * L.speed * S * dt;
      d.wobble += dt*3;
      const r = duckRadius(d.lane)*1.6;
      if(L.dir>0 && d.x > W+r) d.x = -r;
      if(L.dir<0 && d.x < -r) d.x = W+r;
    }
  }

  // pop-up terče
  popupTimer -= dt;
  if(popupTimer <= 0){
    popupTimer = rand(2.5, 4.5);
    const hidden = popups.filter(p=>p.state==='hidden');
    if(hidden.length){
      const p = hidden[(Math.random()*hidden.length)|0];
      p.state='in'; p.t=0; p.ttl=2.5;
    }
  }
  for(const p of popups){
    if(p.state==='hidden') continue;
    p.t += dt;
    if(p.state==='in' && p.t>0.25){ p.state='up'; p.t=0; }
    else if(p.state==='up' && p.t>p.ttl){ p.state='out'; p.t=0; }
    else if(p.state==='out' && p.t>0.25){ p.state='hidden'; }
  }

  // částice + kolize
  const grav = 640*S;
  for(let i=0;i<POOL_HARD_MAX;i++){
    const p = pool[i];
    if(!p.alive) continue;
    p.life -= dt;
    p.vy += grav*dt;
    p.x += p.vx*dt; p.y += p.vy*dt;
    if(p.life<=0 || p.x<-60 || p.x>W+60 || p.y>H+60 || p.y<-120){ p.alive=false; aliveCount--; continue; }

    if(p.type===0 && tune.collisions){
      // kolize s kachničkami
      let hit = false;
      for(const d of ducks){
        if(d.knocked) continue;
        const r = duckRadius(d.lane);
        const ddx = p.x-d.x, ddy = p.y-(laneY(d.lane)-r*0.55);
        if(ddx*ddx+ddy*ddy < r*r){
          hitDuck(d, p);
          hit = true; break;
        }
      }
      if(!hit){
        for(const t of popups){
          if(t.state!=='up') continue;
          const ddx = p.x-t.x, ddy = p.y-t.y;
          if(ddx*ddx+ddy*ddy < t.r*t.r){
            hitPopup(t, p);
            hit = true; break;
          }
        }
      }
      if(hit){ p.alive=false; aliveCount--; }
    }
  }

  // plovoucí texty
  for(const f of floaters){
    if(!f.alive) continue;
    f.t += dt; f.y -= 40*S*dt;
    if(f.t>0.9) f.alive=false;
  }
}

function splashAt(x,y,n){
  for(let i=0;i<n;i++){
    const a = rand(-Math.PI*0.9, -Math.PI*0.1);
    const sp = rand(60,260)*S;
    spawnParticle(x, y, Math.cos(a)*sp, Math.sin(a)*sp, rand(0.25,0.5), tune.size*S*rand(0.5,0.9), 1);
  }
}

function hitDuck(d, p){
  splashAt(p.x, p.y, tune.splash);
  d.hp--;
  if(d.hp<=0){
    d.knocked=true; d.knockT=0; d.respawnT=0;
    addScore(50 + Math.round(LANES[d.lane].speed/10)*5, d.x, laneY(d.lane)-60*S);
    splashAt(d.x, laneY(d.lane)-20*S, tune.splash*2);
  }
}

function hitPopup(t, p){
  splashAt(p.x, p.y, tune.splash);
  const bonus = Math.round((1 - Math.min(t.t,t.ttl)/t.ttl) * 100);  // rychlejší zásah = víc
  t.state='out'; t.t=0;
  addScore(100 + bonus, t.x, t.y - 40*S);
}

// ---------------------------------------------------------------- draw
function draw(){
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  // pop-up terče
  for(const t of popups){
    if(t.state==='hidden') continue;
    let sc = 1;
    if(t.state==='in') sc = t.t/0.25;
    else if(t.state==='out') sc = 1 - t.t/0.25;
    const r = t.r * sc;
    if(r<1) continue;
    ctx.save(); ctx.translate(t.x, t.y);
    const rings = ['#e33', '#fff', '#e33', '#fff'];
    for(let i=0;i<rings.length;i++){
      ctx.fillStyle = rings[i];
      ctx.beginPath(); ctx.arc(0, 0, r*(1-i*0.24), 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = '#e33';
    ctx.beginPath(); ctx.arc(0, 0, r*0.14, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // kachničky
  const base = 90*S;
  for(const d of ducks){
    if(d.knocked && d.knockT>0.6) continue;
    const L = LANES[d.lane];
    const sc = L.scale;
    const y = laneY(d.lane);
    ctx.save();
    ctx.translate(d.x, y - 8*sc*S + (d.knocked?0:Math.sin(d.wobble)*3*sc*S));
    // sprite míří doleva → při jízdě doprava zrcadlit (zobák vždy dopředu)
    if(L.dir>0) ctx.scale(-1,1);
    if(d.knocked){
      const k = Math.min(d.knockT/0.6, 1);
      ctx.rotate((L.dir>0?1:-1) * k * Math.PI/2);
      ctx.globalAlpha = 1-k*0.8;
    }
    ctx.drawImage(duckSprite, -base*sc*0.53, -base*sc*0.75, base*sc, base*sc);
    ctx.restore();
  }
  // přední hrana žlabu přes nožičky kachniček
  for(let l=0;l<LANES.length;l++){
    const y = laneY(l), sc = LANES[l].scale;
    ctx.fillStyle = 'rgba(23,58,99,0.85)';
    ctx.fillRect(0, y, W, 14*sc*S);
    ctx.fillStyle = 'rgba(160,220,255,0.25)';
    ctx.fillRect(0, y, W, 2.5*S);
  }

  // částice vody
  ctx.save();
  if(tune.additive) ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(110,190,255,0.55)';
  ctx.beginPath();
  for(let i=0;i<POOL_HARD_MAX;i++){
    const p = pool[i];
    if(!p.alive) continue;
    const sz = p.type===1 ? p.size*(p.life/p.maxLife) : p.size;
    ctx.moveTo(p.x+sz, p.y);
    ctx.arc(p.x, p.y, sz, 0, Math.PI*2);
  }
  ctx.fill();
  ctx.restore();

  // dělo
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  // podstavec
  ctx.fillStyle = '#3a2412';
  ctx.beginPath(); ctx.ellipse(0, 16*S, 56*S, 18*S, 0, 0, Math.PI*2); ctx.fill();
  ctx.rotate(cannon.angle);
  // hlaveň
  const bl = cannon.barrel, bw = 26*S;
  const bg2 = ctx.createLinearGradient(0,-bw,0,bw);
  bg2.addColorStop(0,'#3d7edb'); bg2.addColorStop(0.5,'#1d4e9e'); bg2.addColorStop(1,'#123468');
  ctx.fillStyle = bg2;
  ctx.beginPath();
  ctx.moveTo(-10*S, -bw*0.7); ctx.lineTo(bl, -bw*0.55);
  ctx.lineTo(bl, bw*0.55); ctx.lineTo(-10*S, bw*0.7);
  ctx.closePath(); ctx.fill();
  // zlaté ústí + prstenec
  ctx.fillStyle = '#e8a33a';
  ctx.fillRect(bl-6*S, -bw*0.62, 8*S, bw*1.24);
  ctx.fillRect(bl*0.35, -bw*0.68, 6*S, bw*1.36);
  ctx.restore();
  // koule děla (pivot)
  ctx.fillStyle = '#1d4e9e';
  ctx.beginPath(); ctx.arc(cannon.x, cannon.y, 20*S, 0, Math.PI*2); ctx.fill();

  // plovoucí skóre
  ctx.fillStyle = '#ffe98a';
  ctx.font = '700 '+Math.round(20*S)+'px Arial, sans-serif';
  ctx.textAlign = 'center';
  for(const f of floaters){
    if(!f.alive) continue;
    ctx.globalAlpha = 1 - f.t/0.9;
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- perf HUD
const perf = { fps:0, fpsMin:999, ms:0, frames:0, tAcc:0, msAcc:0, minWin:[] };
let perfEls = null;

function perfTick(dt, frameMs){
  perf.frames++; perf.tAcc += dt; perf.msAcc += frameMs;
  if(perf.tAcc >= 0.5){
    perf.fps = Math.round(perf.frames/perf.tAcc);
    perf.ms = perf.msAcc/perf.frames;
    perf.minWin.push(perf.fps);
    if(perf.minWin.length>10) perf.minWin.shift();
    perf.fpsMin = Math.min.apply(null, perf.minWin);
    perf.frames=0; perf.tAcc=0; perf.msAcc=0;
    if(perfEls && !perfEls.panel.hidden){
      perfEls.fps.textContent = perf.fps;
      perfEls.fpsMin.textContent = perf.fpsMin;
      perfEls.ms.textContent = perf.ms.toFixed(1);
      perfEls.parts.textContent = aliveCount;
    }
  }
}

function setupHUD(){
  scoreEl = document.getElementById('score-val');
  timeEl = document.getElementById('time-val');
  const panel = document.getElementById('perf-hud');
  perfEls = {
    panel,
    fps: document.getElementById('pf-fps'),
    fpsMin: document.getElementById('pf-fpsmin'),
    ms: document.getElementById('pf-ms'),
    parts: document.getElementById('pf-parts'),
  };
  document.getElementById('hud-toggle').addEventListener('click', ()=>{ panel.hidden = !panel.hidden; });

  function bindSlider(id, key, fmt){
    const el = document.getElementById(id), out = document.getElementById(id+'-val');
    el.value = tune[key];
    out.textContent = tune[key];
    el.addEventListener('input', ()=>{ tune[key] = +el.value; out.textContent = el.value; });
  }
  bindSlider('sl-max','maxParticles');
  bindSlider('sl-rate','emitRate');
  bindSlider('sl-size','size');
  bindSlider('sl-splash','splash');
  const cb = document.getElementById('cb-coll');
  cb.checked = tune.collisions;
  cb.addEventListener('change', ()=>{ tune.collisions = cb.checked; });
  const cba = document.getElementById('cb-add');
  cba.checked = tune.additive;
  cba.addEventListener('change', ()=>{ tune.additive = cba.checked; });
}

// ---------------------------------------------------------------- smyčka
let lastT = 0, rafId = 0;
function loop(t){
  rafId = requestAnimationFrame(loop);
  if(paused){ lastT = t; return; }
  const dt = Math.min((t-lastT)/1000 || 0, 0.033);
  lastT = t;
  const t0 = performance.now();
  if(running && !over) update(dt);
  draw();
  perfTick(dt, performance.now()-t0);
}

// ---------------------------------------------------------------- kolo
function startRound(){
  score = 0; playTime = 0; timeLeft = ROUND_TIME; over = false;
  if(scoreEl) scoreEl.textContent = '0';
  for(const p of pool) p.alive = false;
  aliveCount = 0;
  for(const f of floaters) f.alive = false;
  resetEntities();
  document.getElementById('overlay').hidden = true;
  running = true;
  _safeGamee(()=>gamee.gameStart());
}

function endRound(){
  if(over) return;
  over = true;
  cannon.spraying = false;
  _safeGamee(()=>gamee.updateScore(score, playTime, WS_CHECKSUM));
  _safeGamee(()=>gamee.gameOver(undefined, JSON.stringify({score:score}), undefined));
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-msg').textContent = 'Skóre: ' + score;
  ov.hidden = false;
}

// ---------------------------------------------------------------- init + Gamee lifecycle
function initGame(){
  console.log('[WS] Water Shoot '+WS_VERSION);
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  resize();
  setupInput();
  setupHUD();
  document.getElementById('restart-btn').addEventListener('click', startRound);

  gamee.gameInit('FullScreen', {}, ['saveState'], function(error, data){
    if(error) console.warn('[gamee] init error', error);

    gamee.emitter.addEventListener('start', function(ev){
      startRound();
      if(ev && ev.detail && ev.detail.callback) ev.detail.callback();
    });
    gamee.emitter.addEventListener('pause', function(ev){
      paused = true;
      if(ev && ev.detail && ev.detail.callback) ev.detail.callback();
    });
    gamee.emitter.addEventListener('resume', function(ev){
      paused = false;
      if(ev && ev.detail && ev.detail.callback) ev.detail.callback();
    });
    gamee.emitter.addEventListener('mute', function(ev){
      if(ev && ev.detail && ev.detail.callback) ev.detail.callback();
    });
    gamee.emitter.addEventListener('unmute', function(ev){
      if(ev && ev.detail && ev.detail.callback) ev.detail.callback();
    });
    gamee.emitter.addEventListener('submit', function(ev){
      _safeGamee(()=>gamee.updateScore(score, playTime, WS_CHECKSUM));
      if(ev && ev.detail && ev.detail.callback) ev.detail.callback();
    });

    gamee.gameReady();
  });

  rafId = requestAnimationFrame(loop);
}
