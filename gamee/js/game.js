'use strict';
// Water Shoot — prototyp vodního děla pro Gamee.
// v02: first-person pohled — dělo před námi, stříkáme "do scény".
// Fake 3D: částice mají světové souřadnice (x,y,z) a promítají se perspektivně
// na 2D canvas. Účel = test vodní particle fyziky na mobilech (viz CLAUDE.md).
const WS_VERSION = 'v02';
const WS_CHECKSUM = 'water-shoot-v02';

// ---------------------------------------------------------------- util
function _safeGamee(fn){ try{ fn(); }catch(e){ console.warn('[gamee]', e); } }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function rand(a,b){ return a + Math.random()*(b-a); }

// ---------------------------------------------------------------- projekce
// Svět: x doprava, y nahoru (0 = úroveň kamery/oka), z od kamery do hloubky.
// Jednotky = design px (referenční výška 800); na obrazovku se násobí S.
const FOCAL = 600;
const WALL_Z = 1000;          // zadní stěna budky
const FLOOR_Y = -680;         // hladina bazénku pod terči
let VPX = 0, VPY = 0;         // úběžník na obrazovce (px)

function projS(z){ return FOCAL/(FOCAL+z); }
function projX(x,s){ return VPX + x*s*S; }
function projY(y,s){ return VPY - y*s*S; }
function unprojX(sx,s){ return (sx-VPX)/(s*S); }
function unprojY(sy,s){ return (VPY-sy)/(s*S); }

// ---------------------------------------------------------------- stav
let canvas, ctx, W=0, H=0, DPR=1, S=1;
let bgCanvas=null;
let duckSprite=null;
let running=false, paused=false, over=false;
let score=0, playTime=0, timeLeft=0;
const ROUND_TIME = 60;

// zásoba vody — druhý limit kola (končí čas NEBO voda)
const WATER_MAX = 100;
const WATER_PER_SEC = 3.2;    // spotřeba při stisku (≈31 s souvislého stříkání)
let water = WATER_MAX;
let waterBarEl = null;

// dělo (first-person, dole uprostřed)
const cannon = {
  spraying:false,
  aimSX:0, aimSY:0,           // cíl na obrazovce (pointer)
  muzzleSX:0, muzzleSY:0,     // ústí hlavně na obrazovce (dopočítává se)
  muzzle:{x:0,y:-540,z:70},   // ústí ve světě
};

// ---------------------------------------------------------------- particle pool
const POOL_HARD_MAX = 20000;
const pool = new Array(POOL_HARD_MAX);
for(let i=0;i<POOL_HARD_MAX;i++) pool[i] = {alive:false,x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,maxLife:0,size:1,type:0};
let poolCursor = 0, aliveCount = 0;

const tune = {
  maxParticles: 3000,
  emitRate: 400,
  size: 3,                    // world size ~ size*2.2
  splash: 7,
  collisions: true,
  additive: true,
};

function spawnParticle(x,y,z,vx,vy,vz,life,size,type){
  if(aliveCount >= tune.maxParticles) return null;
  for(let n=0;n<POOL_HARD_MAX;n++){
    const i = (poolCursor+n) % POOL_HARD_MAX;
    const p = pool[i];
    if(!p.alive){
      poolCursor = i+1;
      p.alive=true; p.x=x; p.y=y; p.z=z; p.vx=vx; p.vy=vy; p.vz=vz;
      p.life=life; p.maxLife=life; p.size=size; p.type=type;
      aliveCount++;
      return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------- scéna: dráhy, kachničky, terče
// Dráhy = police se žlabem na zadní stěně v různé hloubce (spodní blíž).
const LANES = [
  { z:900, y:-240, dir: 1, speed:170, duckSize:165, count:3 },
  { z:800, y:-429, dir:-1, speed:130, duckSize:182, count:3 },
  { z:700, y:-589, dir: 1, speed:100, duckSize:200, count:2 },
];
const DUCK_HP = 8;
let ducks = [];               // world coords: {lane,x,knocked,knockT,respawnT,hp,wobble}

const POPUP_SLOTS = 3;
let popups = [];              // world: {x,y,z,r,state,t,ttl}
let popupTimer = 2;

const floaters = [];
for(let i=0;i<24;i++) floaters.push({alive:false,sx:0,sy:0,t:0,txt:''});

function laneRangeX(lane){
  // světová půl-šířka viditelné plochy v hloubce dráhy + rezerva na sprite
  const s = projS(LANES[lane].z);
  return (W/2)/(s*S) + LANES[lane].duckSize;
}

function resetEntities(){
  ducks = [];
  for(let l=0;l<LANES.length;l++){
    const L = LANES[l], range = laneRangeX(l);
    for(let i=0;i<L.count;i++){
      ducks.push({
        lane:l,
        x: -range + (2*range/L.count)*i + rand(0, range/L.count),
        knocked:false, knockT:0, respawnT:0, hp:DUCK_HP,
        wobble: rand(0, Math.PI*2),
      });
    }
  }
  popups = [];
  const ps = projS(WALL_Z);
  for(let i=0;i<POPUP_SLOTS;i++){
    popups.push({
      x: unprojX(W*(0.22+i*0.28), ps),
      y: -117, z: WALL_Z, r: 80,
      state:'hidden', t:0, ttl:0,
    });
  }
  popupTimer = 2;
}

function addFloater(sx,sy,txt){
  for(const f of floaters){
    if(!f.alive){ f.alive=true; f.sx=sx; f.sy=sy; f.t=0; f.txt=txt; return; }
  }
}

// ---------------------------------------------------------------- skóre + voda
let scoreEl=null, timeEl=null;
function addScore(n, sx, sy){
  score += n;
  if(scoreEl) scoreEl.textContent = score;
  if(sx!==undefined) addFloater(sx, sy, '+'+n);
  _safeGamee(()=>gamee.updateScore(score, playTime, WS_CHECKSUM));
}
function updateWaterBar(){
  if(waterBarEl) waterBarEl.style.width = Math.max(0, water/WATER_MAX*100).toFixed(1)+'%';
}

// ---------------------------------------------------------------- resize + prerender
function resize(){
  DPR = Math.min(window.devicePixelRatio||1, 2);
  W = window.innerWidth; H = window.innerHeight;
  S = H/800;
  canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  VPX = W/2; VPY = H*0.30;
  cannon.aimSX = W/2; cannon.aimSY = H*0.45;
  prerenderBackground();
  prerenderDuck();
  if(running) resetEntities();
}

// Tmavá pouťová vodní střelnice v podhledu — statická, jednou do offscreen.
function prerenderBackground(){
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = Math.round(W*DPR); bgCanvas.height = Math.round(H*DPR);
  const g = bgCanvas.getContext('2d');
  g.setTransform(DPR,0,0,DPR,0,0);

  const floorTopY = projY(FLOOR_Y, projS(WALL_Z));   // kde stěna potkává bazének

  // zadní stěna
  const wall = g.createLinearGradient(0,0,0,floorTopY);
  wall.addColorStop(0,'#101830'); wall.addColorStop(0.6,'#16224a'); wall.addColorStop(1,'#0d1430');
  g.fillStyle = wall; g.fillRect(0,0,W,floorTopY+2);

  // svislá prkna stěny (hustší = působí vzdáleněji)
  g.fillStyle = 'rgba(0,0,0,0.16)';
  const plankW = 20*S;
  for(let x=plankW; x<W; x+=plankW) g.fillRect(x,0,1.5,floorTopY);

  // bazének / voda dole (podlaha scény) s perspektivními liniemi k úběžníku
  const pool = g.createLinearGradient(0,floorTopY,0,H);
  pool.addColorStop(0,'#173a63'); pool.addColorStop(1,'#0a1c36');
  g.fillStyle = pool; g.fillRect(0,floorTopY,W,H-floorTopY);
  g.strokeStyle = 'rgba(120,190,255,0.12)'; g.lineWidth = 2*S;
  for(let k=-6;k<=6;k++){
    g.beginPath();
    g.moveTo(VPX + k*90*S*projS(WALL_Z), floorTopY);
    g.lineTo(VPX + k*90*S*2.4, H);
    g.stroke();
  }
  // vlnky v bazénku
  g.strokeStyle = 'rgba(140,205,255,0.18)';
  for(let i=1;i<=4;i++){
    const y = floorTopY + (H-floorTopY)*i/5;
    g.beginPath();
    for(let x=0;x<=W;x+=26*S){
      g.moveTo(x,y); g.quadraticCurveTo(x+13*S, y-4*S, x+26*S, y);
    }
    g.stroke();
  }

  // markýza / cedule nahoře
  const signH = H*0.115;
  const sg = g.createLinearGradient(0,0,0,signH);
  sg.addColorStop(0,'#7a1220'); sg.addColorStop(1,'#a41c2c');
  g.fillStyle = sg; g.fillRect(0,0,W,signH);
  g.fillStyle = '#e8c34a';
  const teeth = 12, tw = W/teeth;
  for(let i=0;i<teeth;i++){
    g.beginPath();
    g.moveTo(i*tw, signH); g.lineTo(i*tw+tw/2, signH+13*S); g.lineTo((i+1)*tw, signH);
    g.closePath(); g.fill();
  }
  g.fillStyle = '#fdf3d0';
  g.font = '700 '+Math.round(32*S)+'px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('WATER SHOOT', W/2, signH*0.52);

  // žárovky: řada pod cedulí + svislé okraje
  const bulbCols = ['#ffd54a','#ff6b6b','#5ad1ff','#7dff8a','#ff9ff3'];
  function bulb(x,y,i,r){
    g.fillStyle = bulbCols[i%bulbCols.length];
    g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(x-r*0.3,y-r*0.3,r*0.35,0,Math.PI*2); g.fill();
  }
  const br = 5*S; let bi=0;
  for(let x=br*3; x<W-br; x+=br*5.2){ bulb(x, signH+22*S, bi++, br); }
  for(let y=signH+44*S; y<H*0.88; y+=br*6){ bulb(br*2.2, y, bi++, br); bulb(W-br*2.2, y, bi+3, br); bi++; }

  // police/žlaby drah — tloušťka podle hloubky (perspektiva)
  for(let l=0;l<LANES.length;l++){
    const L = LANES[l], s = projS(L.z);
    const y = projY(L.y, s);
    const shelfH = 62*s*S;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y+shelfH*0.5, W, 5*S);
    const wg = g.createLinearGradient(0,y-4*S,0,y+shelfH);
    wg.addColorStop(0,'#2e6fb2'); wg.addColorStop(1,'#173a63');
    g.fillStyle = wg;
    g.fillRect(0, y-3*S, W, shelfH);
    g.strokeStyle = 'rgba(160,220,255,0.5)'; g.lineWidth = 2*s*S;
    g.beginPath();
    for(let x=0;x<=W;x+=44*s*S){
      g.moveTo(x, y);
      g.quadraticCurveTo(x+22*s*S, y-10*s*S, x+44*s*S, y);
    }
    g.stroke();
  }
}

// Kachnička (míří doleva) — prerender, za běhu jen drawImage.
function prerenderDuck(){
  const base = 90;
  const sz = Math.ceil(base*S*DPR);
  duckSprite = document.createElement('canvas');
  duckSprite.width = sz; duckSprite.height = sz;
  const g = duckSprite.getContext('2d');
  g.scale(sz/base, sz/base);
  g.fillStyle = '#ffd21f';
  g.beginPath(); g.ellipse(48, 58, 30, 22, 0, 0, Math.PI*2); g.fill();
  g.beginPath(); g.moveTo(74,52); g.quadraticCurveTo(86,42,80,58); g.quadraticCurveTo(78,62,72,60); g.fill();
  g.beginPath(); g.arc(30, 34, 17, 0, Math.PI*2); g.fill();
  g.fillStyle = '#ff8c1a';
  g.beginPath(); g.ellipse(13, 38, 9, 5, -0.15, 0, Math.PI*2); g.fill();
  g.fillStyle = '#1c1c1c';
  g.beginPath(); g.arc(25, 29, 3.2, 0, Math.PI*2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.arc(24, 28, 1.2, 0, Math.PI*2); g.fill();
  g.fillStyle = '#f0b400';
  g.beginPath(); g.ellipse(52, 58, 13, 8, -0.35, 0, Math.PI*2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath(); g.ellipse(40, 48, 10, 5, -0.4, 0, Math.PI*2); g.fill();
}

// ---------------------------------------------------------------- vstup
function setupInput(){
  const aim = (e)=>{
    const r = canvas.getBoundingClientRect();
    cannon.aimSX = e.clientX - r.left;
    cannon.aimSY = clamp(e.clientY - r.top, H*0.12, H*0.78);
  };
  canvas.addEventListener('pointerdown', e=>{ e.preventDefault(); aim(e); cannon.spraying=true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e=>{ aim(e); });
  canvas.addEventListener('pointerup',   ()=>{ cannon.spraying=false; });
  canvas.addEventListener('pointercancel', ()=>{ cannon.spraying=false; });
}

// ---------------------------------------------------------------- update
let emitAccum = 0;
const GRAV = 1400;            // world px/s²
const JET_SPEED = 1500;       // world px/s

function update(dt){
  playTime += dt;
  timeLeft -= dt;
  if(timeEl) timeEl.textContent = Math.ceil(timeLeft);
  if(timeLeft <= 0){ timeLeft = 0; endRound('Čas vypršel!'); }

  // emise proudu — spotřebovává vodu
  if(cannon.spraying && !over && water > 0){
    water -= WATER_PER_SEC * dt;
    updateWaterBar();
    if(water <= 0){ water = 0; cannon.spraying = false; endRound('Došla voda!'); }

    // cíl ve světě: pointer promítnutý na zadní stěnu
    const ws = projS(WALL_Z);
    const tx = unprojX(cannon.aimSX, ws);
    const ty = unprojY(cannon.aimSY, ws);
    const m = cannon.muzzle;
    m.x = tx*0.08;            // ústí lehce uhýbá za cílem
    const dx = tx-m.x, dy = ty-m.y, dz = WALL_Z-m.z;
    const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
    const tFly = dist/JET_SPEED;
    // kompenzace gravitace, aby proud dopadal ~na pointer
    const vx = dx/tFly, vy = dy/tFly + 0.5*GRAV*tFly, vz = dz/tFly;

    emitAccum += tune.emitRate * dt;
    while(emitAccum >= 1){
      emitAccum -= 1;
      spawnParticle(
        m.x, m.y, m.z,
        vx + rand(-55,55), vy + rand(-55,55), vz + rand(-45,45),
        1.4, tune.size*2.2*rand(0.8,1.3), 0
      );
    }
  } else emitAccum = 0;

  // kachničky (světové x)
  for(const d of ducks){
    const L = LANES[d.lane];
    const range = laneRangeX(d.lane);
    if(d.knocked){
      d.knockT += dt;
      if(d.knockT > 0.6 && d.respawnT <= 0) d.respawnT = rand(1.5, 3);
      if(d.respawnT > 0){
        d.respawnT -= dt;
        if(d.respawnT <= 0){
          d.knocked=false; d.knockT=0; d.hp=DUCK_HP;
          d.x = L.dir>0 ? -range : range;
        }
      }
    } else {
      d.x += L.dir * L.speed * dt;
      d.wobble += dt*3;
      if(L.dir>0 && d.x > range) d.x = -range;
      if(L.dir<0 && d.x < -range) d.x = range;
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

  // částice: integrace + kolize + dopady
  for(let i=0;i<POOL_HARD_MAX;i++){
    const p = pool[i];
    if(!p.alive) continue;
    p.life -= dt;
    p.vy -= GRAV*dt;
    p.x += p.vx*dt; p.y += p.vy*dt; p.z += p.vz*dt;

    if(p.life<=0){ p.alive=false; aliveCount--; continue; }

    if(p.type===0){
      let dead = false;
      if(tune.collisions){
        // kolize s kachničkami — jen v hloubkovém pásmu dráhy
        for(const d of ducks){
          const L = LANES[d.lane];
          if(d.knocked || Math.abs(p.z - L.z) > 60) continue;
          const r = L.duckSize*0.42;
          const cy = L.y + L.duckSize*0.45;
          const ddx = p.x-d.x, ddy = p.y-cy;
          if(ddx*ddx+ddy*ddy < r*r){ hitDuck(d, p); dead=true; break; }
        }
        if(!dead){
          for(const t of popups){
            if(t.state!=='up' || p.z < t.z-70) continue;
            const ddx = p.x-t.x, ddy = p.y-t.y;
            if(ddx*ddx+ddy*ddy < t.r*t.r){ hitPopup(t, p); dead=true; break; }
          }
        }
      }
      // dopad na zadní stěnu → splash stékající po stěně
      if(!dead && p.z >= WALL_Z){
        splashAt(p.x, p.y, WALL_Z, Math.min(2, tune.splash), 0);
        dead = true;
      }
      // dopad do bazénku
      if(!dead && p.y <= FLOOR_Y && p.vy < 0){
        splashAt(p.x, FLOOR_Y, p.z, 2, 1);
        dead = true;
      }
      if(dead){ p.alive=false; aliveCount--; }
    } else {
      // splash: zánik pod podlahou
      if(p.y < FLOOR_Y-60){ p.alive=false; aliveCount--; }
    }
  }

  for(const f of floaters){
    if(!f.alive) continue;
    f.t += dt; f.sy -= 40*S*dt;
    if(f.t>0.9) f.alive=false;
  }
}

// splash burst; mode 0 = na stěně (z fixní), 1 = na hladině (odskok nahoru)
function splashAt(x,y,z,n,mode){
  for(let i=0;i<n;i++){
    const a = rand(0, Math.PI*2);
    const sp = rand(60,240);
    spawnParticle(
      x, y, z,
      Math.cos(a)*sp,
      mode===1 ? rand(120,320) : rand(20,200),
      mode===1 ? rand(-60,-10) : rand(-40,0),
      rand(0.25,0.5), tune.size*2.2*rand(0.5,0.9), 1
    );
  }
}

function hitDuck(d, p){
  const L = LANES[d.lane];
  splashAt(p.x, p.y, p.z, tune.splash, 0);
  d.hp--;
  if(d.hp<=0){
    d.knocked=true; d.knockT=0; d.respawnT=0;
    const s = projS(L.z);
    addScore(50 + Math.round(L.speed/10)*5, projX(d.x,s), projY(L.y+L.duckSize,s));
    splashAt(d.x, L.y+L.duckSize*0.4, L.z, tune.splash*2, 0);
  }
}

function hitPopup(t, p){
  splashAt(p.x, p.y, t.z, tune.splash, 0);
  const bonus = Math.round((1 - Math.min(t.t,t.ttl)/t.ttl) * 100);
  t.state='out'; t.t=0;
  const s = projS(t.z);
  addScore(100 + bonus, projX(t.x,s), projY(t.y+t.r,s));
}

// ---------------------------------------------------------------- draw
function draw(){
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  // pop-up terče (na stěně)
  for(const t of popups){
    if(t.state==='hidden') continue;
    let sc = 1;
    if(t.state==='in') sc = t.t/0.25;
    else if(t.state==='out') sc = 1 - t.t/0.25;
    const s = projS(t.z);
    const r = t.r*sc*s*S;
    if(r<1) continue;
    const sx = projX(t.x,s), sy = projY(t.y,s);
    ctx.save(); ctx.translate(sx, sy);
    const rings = ['#e33', '#fff', '#e33', '#fff'];
    for(let i=0;i<rings.length;i++){
      ctx.fillStyle = rings[i];
      ctx.beginPath(); ctx.arc(0, 0, r*(1-i*0.24), 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = '#e33';
    ctx.beginPath(); ctx.arc(0, 0, r*0.14, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // kachničky — od nejvzdálenější dráhy; po každé dráze přední hrana žlabu
  for(let l=0;l<LANES.length;l++){
    const L = LANES[l], s = projS(L.z);
    const spriteSz = L.duckSize*1.1*s*S;
    for(const d of ducks){
      if(d.lane!==l) continue;
      if(d.knocked && d.knockT>0.6) continue;
      const sx = projX(d.x,s);
      const sy = projY(L.y + (d.knocked?0:Math.sin(d.wobble)*8) + 14, s);
      ctx.save();
      ctx.translate(sx, sy);
      // sprite míří doleva → při jízdě doprava zrcadlit (zobák dopředu)
      if(L.dir>0) ctx.scale(-1,1);
      if(d.knocked){
        const k = Math.min(d.knockT/0.6, 1);
        ctx.rotate((L.dir>0?1:-1) * k * Math.PI/2);
        ctx.globalAlpha = 1-k*0.8;
      }
      ctx.drawImage(duckSprite, -spriteSz*0.53, -spriteSz*0.75, spriteSz, spriteSz);
      ctx.restore();
    }
    // přední hrana žlabu přes nožičky
    const ly = projY(L.y, s);
    ctx.fillStyle = 'rgba(23,58,99,0.9)';
    ctx.fillRect(0, ly, W, 30*s*S);
    ctx.fillStyle = 'rgba(160,220,255,0.25)';
    ctx.fillRect(0, ly, W, 2.5*S);
  }

  // částice vody (perspektivně)
  ctx.save();
  if(tune.additive) ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(110,190,255,0.55)';
  ctx.beginPath();
  for(let i=0;i<POOL_HARD_MAX;i++){
    const p = pool[i];
    if(!p.alive) continue;
    const s = projS(p.z);
    const base = p.type===1 ? p.size*(p.life/p.maxLife) : p.size;
    const sz = Math.max(0.6, base*s*S);
    const sx = projX(p.x,s), sy = projY(p.y,s);
    ctx.moveTo(sx+sz, sy);
    ctx.arc(sx, sy, sz, 0, Math.PI*2);
  }
  ctx.fill();
  ctx.restore();

  // dělo v podhledu — základna dole, hlaveň se naklání za pointerem
  const baseX = W/2, baseY = H + 30*S;
  const mx = baseX + (cannon.aimSX - baseX)*0.22;
  const my = H*0.84 + (cannon.aimSY - H*0.45)*0.06;
  cannon.muzzleSX = mx; cannon.muzzleSY = my;
  const ang = Math.atan2(my-baseY, mx-baseX);
  const nx = Math.cos(ang+Math.PI/2), ny = Math.sin(ang+Math.PI/2);
  const wBase = 74*S, wMuz = 34*S;
  const grad = ctx.createLinearGradient(baseX-wBase, baseY, baseX+wBase, baseY);
  grad.addColorStop(0,'#123468'); grad.addColorStop(0.5,'#3d7edb'); grad.addColorStop(1,'#123468');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(baseX+nx*wBase, baseY+ny*wBase);
  ctx.lineTo(mx+nx*wMuz, my+ny*wMuz);
  ctx.lineTo(mx-nx*wMuz, my-ny*wMuz);
  ctx.lineTo(baseX-nx*wBase, baseY-ny*wBase);
  ctx.closePath(); ctx.fill();
  // zlatý prstenec + ústí
  ctx.strokeStyle = '#e8a33a'; ctx.lineWidth = 7*S;
  ctx.beginPath();
  ctx.moveTo(baseX+nx*wBase*0.82 + (mx-baseX)*0.3, baseY+ny*wBase*0.82 + (my-baseY)*0.3);
  ctx.lineTo(baseX-nx*wBase*0.82 + (mx-baseX)*0.3, baseY-ny*wBase*0.82 + (my-baseY)*0.3);
  ctx.stroke();
  ctx.fillStyle = '#0c1a36';
  ctx.beginPath(); ctx.ellipse(mx, my, wMuz*0.82, wMuz*0.6, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#e8a33a'; ctx.lineWidth = 4*S;
  ctx.beginPath(); ctx.ellipse(mx, my, wMuz*0.82, wMuz*0.6, 0, 0, Math.PI*2); ctx.stroke();

  // zaměřovač
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2*S;
  ctx.beginPath(); ctx.arc(cannon.aimSX, cannon.aimSY, 14*S, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cannon.aimSX-22*S, cannon.aimSY); ctx.lineTo(cannon.aimSX-8*S, cannon.aimSY);
  ctx.moveTo(cannon.aimSX+8*S, cannon.aimSY);  ctx.lineTo(cannon.aimSX+22*S, cannon.aimSY);
  ctx.moveTo(cannon.aimSX, cannon.aimSY-22*S); ctx.lineTo(cannon.aimSX, cannon.aimSY-8*S);
  ctx.moveTo(cannon.aimSX, cannon.aimSY+8*S);  ctx.lineTo(cannon.aimSX, cannon.aimSY+22*S);
  ctx.stroke();

  // plovoucí skóre
  ctx.fillStyle = '#ffe98a';
  ctx.font = '700 '+Math.round(20*S)+'px Arial, sans-serif';
  ctx.textAlign = 'center';
  for(const f of floaters){
    if(!f.alive) continue;
    ctx.globalAlpha = 1 - f.t/0.9;
    ctx.fillText(f.txt, f.sx, f.sy);
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
  waterBarEl = document.getElementById('water-fill');
  const panel = document.getElementById('perf-hud');
  perfEls = {
    panel,
    fps: document.getElementById('pf-fps'),
    fpsMin: document.getElementById('pf-fpsmin'),
    ms: document.getElementById('pf-ms'),
    parts: document.getElementById('pf-parts'),
  };
  document.getElementById('hud-toggle').addEventListener('click', ()=>{ panel.hidden = !panel.hidden; });

  function bindSlider(id, key){
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
  water = WATER_MAX;
  updateWaterBar();
  if(scoreEl) scoreEl.textContent = '0';
  for(const p of pool) p.alive = false;
  aliveCount = 0;
  for(const f of floaters) f.alive = false;
  resetEntities();
  document.getElementById('overlay').hidden = true;
  running = true;
  _safeGamee(()=>gamee.gameStart());
}

function endRound(reason){
  if(over) return;
  over = true;
  cannon.spraying = false;
  _safeGamee(()=>gamee.updateScore(score, playTime, WS_CHECKSUM));
  _safeGamee(()=>gamee.gameOver(undefined, JSON.stringify({score:score}), undefined));
  const ov = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = reason || 'Konec kola';
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
