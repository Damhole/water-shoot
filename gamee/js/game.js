'use strict';
// Golden Ducks — prototyp vodního děla pro Gamee.
// v02: first-person pohled — dělo před námi, stříkáme "do scény".
// Fake 3D: částice mají světové souřadnice (x,y,z) a promítají se perspektivně
// na 2D canvas. Účel = test vodní particle fyziky na mobilech (viz CLAUDE.md).
const WS_VERSION = 'v51';
const WS_CHECKSUM = 'water-shoot-v51';

// Stress mód: ?stress=1&max=20000&rate=3000 — auto-stříkání s krouživým mířením,
// nekonečná voda/čas, perf HUD otevřený. Pro měření stropu na telefonech.
const WS_PARAMS = new URLSearchParams(location.search);
const STRESS = WS_PARAMS.get('stress') === '1';
// Mód hry: 'ducks' = střelnice (dosavadní), 'puzzle' = osvobozování kachniček.
// Přepíná se přes ?mode= nebo tlačítkem na overlay konce kola.
const MODE = (WS_PARAMS.get('mode') === 'puzzle') ? 'puzzle' : 'ducks';
const isPuzzle = () => MODE === 'puzzle';

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
let duckSprite=null, duckCrownSprite=null;
let running=false, paused=false, over=false;
let score=0, playTime=0, timeLeft=0;
const ROUND_TIME = 60;

// zásoba vody — druhý limit kola (končí čas NEBO voda)
const WATER_MAX = 100;
const WATER_PER_SEC = 3.2;    // spotřeba při stisku (≈31 s souvislého stříkání)
const DRY_T = 2.8;            // jak dlouho proud ztrácí tlak, než úplně ustane
const DRY_END_T = 3.9;        // kdy teprve končí kolo — poslední kapky mají doznít
let dryT = -1;                // -1 = nádrž má vodu; >=0 = běží dokapávání
let water = WATER_MAX;
let waterBarEl = null;

// dělo (first-person, dole uprostřed)
const cannon = {
  spraying:false,
  aimSX:0, aimSY:0,           // cíl na obrazovce (pointer)
  muzzleSX:0, muzzleSY:0,     // ústí hlavně na obrazovce (dopočítává se)
  muzzle:{x:0,y:-540,z:70},   // ústí ve světě
};

// ---------------------------------------------------------------- opona
// Divadelní opona: na startu kola se rozhrne, na konci (čas / voda) zatáhne.
// Overlay se skóre čeká, až je zatažená — jinak by přebil efekt.
const CURTAIN_OPEN_T = 1.15;
const CURTAIN_CLOSE_T = 0.85;
let curtain = 0;                 // 0 = zatažená, 1 = rozhrnutá
let curtainState = 'closed';     // 'closed' | 'opening' | 'open' | 'closing'
let curtainT = 0;
let pendingEndReason = null;     // důvod konce — ukáže se po zatažení

function updateCurtain(dt){
  if(curtainState === 'opening'){
    curtainT += dt;
    const t = Math.min(curtainT/CURTAIN_OPEN_T, 1);
    curtain = 1 - Math.pow(1-t, 3);              // ease-out: trhne a doplyne
    if(t >= 1){ curtain = 1; curtainState = 'open'; }
  } else if(curtainState === 'closing'){
    curtainT += dt;
    const t = Math.min(curtainT/CURTAIN_CLOSE_T, 1);
    curtain = 1 - (t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2);   // ease-in-out
    if(t >= 1){
      curtain = 0; curtainState = 'closed';
      showEndOverlay(pendingEndReason);
      pendingEndReason = null;
    }
  }
}

// ---------------------------------------------------------------- particle pool
const POOL_HARD_MAX = 20000;
const pool = new Array(POOL_HARD_MAX);
for(let i=0;i<POOL_HARD_MAX;i++) pool[i] = {alive:false,x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,maxLife:0,size:1,type:0,armZ:0,hue:-1};
let poolCursor = 0, aliveCount = 0;

const tune = {
  maxParticles: 3000,
  emitRate: 400,
  size: 3,                    // world size ~ size*2.2
  splash: 7,
  collisions: true,
  additive: false,            // jen pro basic mód
  cartoon: true,              // kreslený proud (stuha + dvoubarevné kapky + kroužky)
  autoSpray: STRESS,          // demo/stress: samo stříká, krouží, nekonečná voda/čas
  relativeAim: true,          // dotyk = trackpad (prst nezakrývá cíl); myš zůstává absolutní
  aimGain: 1.8,               // základní citlivost relativního míření
  // Náběh trysky: po každém stisku chvíli trvá, než je proud v plném tlaku.
  // Budoucí upgrady děla/pistole tuhle dobu budou zkracovat.
  // Musí být delší než doba letu vody k terči (~0,6 s), jinak se náběh schová
  // za dolet a hráč ho vůbec nezaregistruje.
  jetRampT: 0.7,
  specialMode: true,          // sběr královských kachen → duhový režim
  fluidMax: 700,              // strop částic kapaliny v puzzlu (test výkonu na mobilu)
};
let rampT = 0;                // jak dlouho už tryska nabíhá

// ---------------------------------------------------------------- mince
// Měna pro budoucí odemykání obsahu a upgrady vodního děla. Sbírá se napříč
// koly (reset kola je nemaže); persistence půjde později přes gamee saveState.
let coins = 0;
const COIN_DUCK_CHANCE = 0.14;   // část kachniček nese minci
const COIN_DUCK = 3;
const COIN_ROYAL = 10;
const COIN_CHEST = 15;

// Letící mince: z místa zásahu se po oblouku snesou k ikoně v HUD a teprve
// tam se připíšou — hráč vidí, odkud mu peníze přiletěly.
const FLY_MAX = 48;
const flyCoins = new Array(FLY_MAX);
for(let i=0;i<FLY_MAX;i++) flyCoins[i] = {alive:false,x0:0,y0:0,cx:0,cy:0,t:0,dur:0.7,val:0};
let flyCursor = 0;
let coinPop = 0;              // pružné cuknutí HUD ikony při dopadu

function coinHudPos(){ return { x: 20*S + 11*S, y: H*0.215 }; }

function addCoins(n, sx, sy){
  if(sx === undefined){ coins += n; return; }
  const pieces = Math.max(1, Math.min(6, n));
  const base = Math.floor(n/pieces);
  for(let i=0;i<pieces;i++){
    const f = flyCoins[flyCursor];
    flyCursor = (flyCursor+1) % FLY_MAX;
    const dst = coinHudPos();
    f.alive = true;
    f.x0 = sx + rand(-18*S, 18*S); f.y0 = sy + rand(-14*S, 14*S);
    // řídicí bod nad spojnicí = mince letí obloukem, ne po přímce
    f.cx = (f.x0 + dst.x)/2 + rand(-60*S, 60*S);
    f.cy = Math.min(f.y0, dst.y) - rand(60*S, 130*S);
    f.t = -i*0.07;            // drobné rozestupy, ať neletí v chuchvalci
    f.dur = rand(0.55, 0.8);
    f.val = base + (i < n - base*pieces ? 1 : 0);
  }
}

function updateFlyCoins(dt){
  if(coinPop > 0) coinPop = Math.max(0, coinPop - dt*4);
  for(const f of flyCoins){
    if(!f.alive) continue;
    f.t += dt;
    if(f.t >= f.dur){
      f.alive = false;
      coins += f.val;         // připsat až při dopadu do HUD
      coinPop = 1;
    }
  }
}

function drawFlyCoins(){
  const dst = coinHudPos();
  for(const f of flyCoins){
    if(!f.alive || f.t < 0) continue;
    const k = f.t/f.dur, ik = 1-k;
    // kvadratická bezier: start → řídicí bod → ikona v HUD
    const x = ik*ik*f.x0 + 2*ik*k*f.cx + k*k*dst.x;
    const y = ik*ik*f.y0 + 2*ik*k*f.cy + k*k*dst.y;
    drawCoin(x, y, (12 - 4*k)*S);
  }
}

// zlatá mince — používá se v HUD, nad kachničkami i v truhle
function drawCoin(x, y, r){
  ctx.fillStyle = '#c98a12';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ffd700';
  ctx.beginPath(); ctx.arc(x, y, r*0.82, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#c98a12';
  ctx.font = '800 '+Math.max(7, Math.round(r*1.15))+'px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('C', x, y + r*0.06);
  ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------- duhový režim
// Sejmi tři královské kachničky → na 10 s se rozjede duhový režim: dvě rotující
// trysky, dvojnásobné poškození a nespotřebovává se čas ani voda.
const ROYAL_NEEDED = 3;
const RAINBOW_T = 10;
const RAINBOW_DMG_MUL = 3;
const RAINBOW_HIT_CD = 0.045;   // duhové dělo bije i rychleji, ne jen silněji
let royalCollected = 0;
let rainbowT = -1;            // -1 = neaktivní
function rainbowOn(){ return rainbowT > 0; }
function dmgMul(){ return rainbowOn() ? RAINBOW_DMG_MUL : 1; }
function hitCd(){ return rainbowOn() ? RAINBOW_HIT_CD : HIT_CD; }

function collectRoyal(){
  if(!tune.specialMode) return;
  // Během duhy se korunky nesbírají. Bez téhle pojistky by sestřel královské
  // znovu nastavil rainbowT na plných 10 s a přisypal další porci kachniček —
  // hra by v duhovém režimu uvázla donekonečna.
  if(rainbowOn()) return;
  royalCollected++;
  if(royalCollected >= ROYAL_NEEDED){
    rainbowT = RAINBOW_T;     // ikony zůstanou plné, dokud režim běží
    addRainbowDucks();
    chestTimer = 0.3;         // truhly ať naskočí hned, ne až doběhne starý časovač
    // královská, která je zrovna na scéně, se odklidí — v duze nemá co dělat
    if(special && special.state!=='sink'){ special.state='sink'; special.t=0; }
  }
}

// V duhovém režimu se scéna zaplní — do každé dráhy přibudou dvě kachničky
// mezi každé původní (3× hustota), pořád v pravidelných rozestupech.
function addRainbowDucks(){
  for(let l=0;l<LANES.length;l++){
    const L = LANES[l];
    const anchor = ducks.find(d=>d.lane===l);
    if(!anchor) continue;
    const trackLen = 2*laneRangeX(l);
    const slots = L.count*3;
    const step = trackLen/slots;
    for(let i=0;i<slots;i++){
      if(i % 3 === 0) continue;            // tyhle sloty drží původní kachničky
      ducks.push({
        lane:l, bonus:true,
        pos: (anchor.pos + i*step) % trackLen,
        x: 0,
        knocked:false, knockT:0, respawnT:0, dmg:0, ageT: rand(0,4), riseT:0, hitCd:0,
        focus:0, focusT:0, coin: Math.random() < COIN_DUCK_CHANCE,
        wobble: rand(0, Math.PI*2),
      });
    }
  }
}

// ---- páteř proudu (spine) — uzly pro kreslenou vodní stuhu ----
// Uzly letí stejnou balistikou jako částice; stuha se přes ně natahuje
// v screen-space s šířkou podle hloubky. Kosmetika — nedávají damage.
const SPINE_MAX = 56;
const spine = new Array(SPINE_MAX);
for(let i=0;i<SPINE_MAX;i++) spine[i] = {alive:false,x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,gen:0,armZ:0};
let spineHead = 0;
let spineGen = 0;             // generace stříkání — stuha se mezi generacemi nespojuje
let prevSpraying = false;
// pracovní buffery pro stuhu (žádné alokace za běhu)
const ribX=new Float32Array(SPINE_MAX), ribY=new Float32Array(SPINE_MAX), ribW=new Float32Array(SPINE_MAX);
const ribLX=new Float32Array(SPINE_MAX), ribLY=new Float32Array(SPINE_MAX);
const ribRX=new Float32Array(SPINE_MAX), ribRY=new Float32Array(SPINE_MAX);

// ---- pírka ----
// Sestřelená kachnička se rozletí v peří: pírka mají vlastní malý pool,
// protože se každé kreslí zvlášť (rotace) a padají pomalu s třepotáním.
const FEATHER_MAX = 160;
const feathers = new Array(FEATHER_MAX);
for(let i=0;i<FEATHER_MAX;i++) feathers[i] = {alive:false,x:0,y:0,z:0,vx:0,vy:0,vz:0,rot:0,rotV:0,life:0,maxLife:1,size:1,tone:0,seed:0};
let featherCursor = 0;

function spawnFeathers(x, y, z, n, power){
  for(let i=0;i<n;i++){
    const f = feathers[featherCursor];
    featherCursor = (featherCursor+1) % FEATHER_MAX;
    const a = rand(0, Math.PI*2);
    const sp = rand(120, 420) * (power || 1);
    f.alive = true;
    f.x = x + rand(-25,25); f.y = y + rand(-25,25); f.z = z + rand(-30,30);
    f.vx = Math.cos(a)*sp;
    f.vy = Math.abs(Math.sin(a))*sp*rand(0.6,1.4) + 120*(power||1);   // nahoru
    f.vz = rand(-90,90);
    f.rot = rand(0, Math.PI*2);
    f.rotV = rand(-7, 7);
    f.life = f.maxLife = rand(1.1, 2.0);
    f.size = rand(11, 20);
    f.tone = (Math.random()*3)|0;      // 0 žlutá, 1 oranžová, 2 bílá
    f.seed = rand(0, Math.PI*2);
  }
}

function updateFeathers(dt){
  for(const f of feathers){
    if(!f.alive) continue;
    f.life -= dt;
    if(f.life <= 0 || f.y < FLOOR_Y - 80){ f.alive = false; continue; }
    f.vy -= GRAV*0.16*dt;                       // pírko padá pomalu
    f.vx *= (1 - 2.2*dt); f.vz *= (1 - 2.2*dt); // odpor vzduchu
    f.vy *= (1 - 1.1*dt);
    // třepotání do stran
    f.x += (f.vx + Math.sin(ribbonTime*7 + f.seed)*110) * dt;
    f.y += f.vy*dt;
    f.z += f.vz*dt;
    f.rot += f.rotV*dt;
  }
}

function drawFeathers(){
  const TONES = ['#ffd21f', '#ff9c1a', '#fff6d5'];
  for(const f of feathers){
    if(!f.alive) continue;
    const s = projS(f.z);
    const sx = projX(f.x, s), sy = projY(f.y, s);
    const r = f.size * s * S;
    if(r < 0.5) continue;
    const fade = Math.min(1, f.life/0.45);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(sx, sy);
    ctx.rotate(f.rot);
    ctx.fillStyle = TONES[f.tone];
    ctx.beginPath();
    ctx.ellipse(0, 0, r*0.42, r, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = Math.max(0.6, r*0.09);
    ctx.beginPath(); ctx.moveTo(0, -r*0.85); ctx.lineTo(0, r*0.85); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---- rozstřikové kroužky ----
const RING_MAX = 24;
const rings = new Array(RING_MAX);
for(let i=0;i<RING_MAX;i++) rings[i] = {alive:false,x:0,y:0,z:0,t:0,dur:0.4,mode:0};
let lastRingAt = -1;
function spawnRing(x,y,z,mode){
  // throttle — proud generuje dopady 60×/s, kroužek stačí ~10×/s
  if(ribbonTime - lastRingAt < 0.09) return;
  lastRingAt = ribbonTime;
  for(const r of rings){
    if(!r.alive){ r.alive=true; r.x=x; r.y=y; r.z=z; r.t=0; r.mode=mode; return; }
  }
}

function spawnParticle(x,y,z,vx,vy,vz,life,size,type){
  if(aliveCount >= tune.maxParticles) return null;
  for(let n=0;n<POOL_HARD_MAX;n++){
    const i = (poolCursor+n) % POOL_HARD_MAX;
    const p = pool[i];
    if(!p.alive){
      poolCursor = i+1;
      p.alive=true; p.x=x; p.y=y; p.z=z; p.vx=vx; p.vy=vy; p.vz=vz;
      p.life=life; p.maxLife=life; p.size=size; p.type=type;
      p.hue = rainbowOn() ? (ribbonTime*220 + z*0.4) % 360 : -1;
      aliveCount++;
      return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------- scéna: dráhy, kachničky, terče
// Dráhy = police se žlabem na zadní stěně v různé hloubce (spodní blíž).
// hp = kolik zásahů proudem je potřeba — víc hodnotná kachnička spolkne víc vody
const LANES = [
  { z:900, y:-240, dir: 1, speed:170, duckSize:165, count:3 },
  { z:800, y:-429, dir:-1, speed:130, duckSize:182, count:3 },
  { z:700, y:-589, dir: 1, speed:100, duckSize:200, count:2 },
];
// Hodnotové tiery ROTUJÍ mezi drahami (po TIER_ROTATE_T sekundách), aby se
// hráč nezakempil na jedné řadě — nejvyšší hodnota není vždy nahoře.
const VALUE_TIERS = [ {val:150}, {val:110}, {val:80} ];
const TIER_ROTATE_T = 15;
let laneTier = [0,1,2];       // laneTier[lane] = index do VALUE_TIERS
let tierRotateT = TIER_ROTATE_T;
// Damage cooldown: kachnička ztratí max 1 HP za HIT_CD sekund (≈12 HP/s),
// jinak by hustý proud (stovky částic/s) sestřelil cokoli za pár setin.
const HIT_CD = 0.08;
// „Držení linie": každý další zásah do středu (kolečka s body) v řadě zvyšuje
// poškození exponenciálně. Jakmile proud ze středu sjede na víc než FOCUS_GRACE,
// série se vynuluje a začíná se od základu.
const FOCUS_GRACE = 0.3;
const FOCUS_GROWTH = 1.32;
const FOCUS_MAX_MUL = 5;
const CENTER_DMG = 1.2;       // přímý zásah do středu
const BODY_DMG = 0.4;         // okraj tělíčka / truhly — jen „udržovací" poškození
function focusMul(focus){ return Math.min(Math.pow(FOCUS_GROWTH, focus), FOCUS_MAX_MUL); }
// hodnota kachničky klesá s časem bez zásahu: baseVal → 25 % za VALUE_DECAY_T sekund
const VALUE_DECAY_T = 12;
let ducks = [];               // {lane,pos,x,knocked,knockT,respawnT,hp,ageT,wobble}

function duckValue(d){
  const b = VALUE_TIERS[laneTier[d.lane]].val;
  const v = b * (1 - 0.75*Math.min(d.ageT, VALUE_DECAY_T)/VALUE_DECAY_T);
  return Math.max(5, Math.round(v/5)*5);
}

// Výdrž se odvíjí PŘÍMO od aktuální hodnoty: levnou dvacítku stačí obšplíchnout
// (2 zásahy do středu), čím dražší kachnička, tím víc vody spolkne.
const HP_PER_VALUE = 12;
function duckHpNeeded(d){
  return Math.max(1, Math.round(duckValue(d)/HP_PER_VALUE));
}

// ---- speciální korunková kachnička ----
// Občas vyplave, má korunku a velký zisk; ve hře je jen krátce a spolkne
// víc vody než ostatní. Pluje v mezeře mezi sloty vybrané dráhy.
const SPECIAL_VAL = 300;
const SPECIAL_HP = 22;        // ~1,8 s přesného kropení (krity) / ~3,7 s po tělíčku
// Královská jako jediná NEZMIZÍ sama od sebe — pluje, dokud nedojede na konec řádku.
let special = null;           // {lane,pos,x,hp,state:'rise'|'up'|'sink',t}
let specialTimer = 7;
const SPECIAL_KILL_CUT = 3.0;   // o kolik sestřel zkrátí čekání na královskou
const SPECIAL_MIN_WAIT = 0.6;   // pod tohle odpočet neklesne, ať nechodí v hejnu

function spawnSpecial(){
  // Královská se dřív odvozovala od pozice sousední kachničky, takže často
  // vznikla až u výjezdu a hráč ji nestihl. Teď vjíždí z náhodného místa
  // VSTUPNÍ části dráhy — vždycky jí zbývá aspoň 65 % průjezdu obrazovkou.
  // Dráhy zkusíme v náhodném pořadí a v každé nasamplujeme několik míst ve
  // vstupní části. Vybere se to, kde je největší odstup od kachniček — jinak
  // by královská vyplavala rovnou přes někoho. Rozestup pak drží napořád,
  // protože královská pluje stejnou rychlostí jako řada.
  // Fisher-Yates: sort() s náhodným komparátorem nemíchá rovnoměrně
  // a dráhy by nevycházely stejně často.
  const lanes = [0,1,2];
  for(let i=lanes.length-1;i>0;i--){
    const j = (Math.random()*(i+1))|0;
    const tmp = lanes[i]; lanes[i] = lanes[j]; lanes[j] = tmp;
  }
  let best = null;
  for(const lane of lanes){
    const L = LANES[lane];
    const trackLen = 2*laneRangeX(lane);
    const s = projS(L.z);
    const visHalf = (W/2)/(s*S);
    const margin = L.duckSize*0.6;
    const span = 2*(visHalf + margin);          // celý průjezd obrazovkou
    const need = L.duckSize*1.05;               // poloměr královské + kachničky
    let laneBest = null;
    for(let i=0;i<24;i++){
      const consumed = rand(0, 0.45);           // kolik z průjezdu už má za sebou
      const x = -L.dir*(visHalf + margin) + L.dir*consumed*span;
      const pos = L.dir>0 ? x + trackLen/2 : trackLen/2 - x;
      let clear = 1e9;
      for(const d of ducks){
        if(d.lane !== lane) continue;
        let dd = Math.abs(d.pos - pos) % trackLen;
        clear = Math.min(clear, Math.min(dd, trackLen - dd));
      }
      if(!laneBest || clear > laneBest.clear) laneBest = { lane, pos, x, clear };
      if(clear >= need) break;
    }
    if(!best || laneBest.clear > best.clear) best = laneBest;
    if(laneBest.clear >= need) { best = laneBest; break; }
  }
  special = { lane:best.lane, pos:best.pos, x:best.x, hp:SPECIAL_HP, state:'rise', t:0, hitCd:0, focus:0, focusT:0 };
}

const POPUP_SLOTS = 3;
let popups = [];              // world: {x,y,z,r,state,t,ttl}
let popupTimer = 2;

// ---- truhlička s odměnou ----
// Objeví se na stěně, pár zásahů ji otevře a vyjede z ní výhra:
// hodiny (+čas) nebo kapka (+voda). Neotevřená po chvíli zmizí.
const CHEST_HP = 6;
const CHEST_UP_T = 5;         // okno na otevření
const CHEST_TIME_BONUS = 8;   // s
const CHEST_WATER_BONUS = 25; // jednotek nádržky
const CHEST_SINK_T = 0.75;    // jak dlouho se truhla potápí, než zmizí
const CHEST_R = 85;           // world kolizní poloměr
const CHEST_CY = 55;          // world střed truhly nad linkou žlabu
let chests = [];              // {lane,pos,x,wobble,hp,reward,state:'in'|'closed'|'open'|'out',t,hitCd}
let chestTimer = 9;
// v duhovém režimu smí být na scéně víc truhel naráz a chodí častěji
function maxChests(){ return rainbowOn() ? 3 : 1; }
function nextChestDelay(){ return rainbowOn() ? rand(0.8, 2.2) : rand(10, 16); }

function spawnChest(){
  // Truhla pluje v dráze mezi kachničkami a houpe se na vodě jako ony.
  // Safe zone: vyplouvá na návětrné straně viditelné plochy, takže má před
  // sebou celý průjezd obrazovkou — nikdy jen nevykoukne u kraje a nezmizí.
  // přednostně dráha, kde ještě žádná truhla není — ať se nepřekrývají
  const free = [0,1,2].filter(l => !chests.some(c => c.lane === l));
  const lane = free.length ? free[(Math.random()*free.length)|0]
                           : (Math.random()*LANES.length)|0;
  const L = LANES[lane];
  const range = laneRangeX(lane);
  const trackLen = 2*range;
  const s = projS(L.z);
  const visHalf = (W/2)/(s*S);              // viditelná půlka dráhy ve world
  // Truhla pluje stejnou rychlostí jako kachničky, takže rozestup zůstává —
  // stačí ji usadit doprostřed mezery a už se s nimi nikdy nepotká.
  const laneDucks = ducks.filter(d => d.lane === lane).map(d => d.pos).sort((a,b)=>a-b);
  const cands = [];
  for(let i=0;i<laneDucks.length;i++){
    const a = laneDucks[i];
    const b = (i+1 < laneDucks.length) ? laneDucks[i+1] : laneDucks[0] + trackLen;
    cands.push({ pos: ((a+b)/2) % trackLen, gap: b-a });
  }
  if(!cands.length) cands.push({ pos: rand(0, trackLen), gap: trackLen });
  // Z mezer vybrat tu, kde má truhla před sebou nejdelší cestu po obrazovce.
  // Priorita: dost místa kolem sebe > delší cesta. Nikdy nesmí skončit
  // na kachničce, takže fallback je vždycky největší mezera, ne okraj dráhy.
  const clearance = CHEST_R + L.duckSize*0.42;
  let best = null, widest = null;
  for(const c of cands){
    const x = L.dir>0 ? c.pos - trackLen/2 : trackLen/2 - c.pos;
    if(!widest || c.gap > widest.gap) widest = { pos:c.pos, x, gap:c.gap };
    if(c.gap/2 < clearance) continue;                         // úzká mezera
    if(Math.abs(x) > visHalf) continue;                       // mimo obraz
    const remaining = L.dir>0 ? (visHalf - x) : (x + visHalf);
    if(!best || remaining > best.remaining) best = { pos:c.pos, x, remaining };
  }
  if(!best) best = widest;
  const pos = best.pos, xStart = best.x;
  chests.push({
    lane, pos, x: xStart, wobble: rand(0, Math.PI*2),
    hp: CHEST_HP,
    reward: ['time','water','coins'][(Math.random()*3)|0],
    state: 'in', t: 0, hitCd: 0, focus: 0, focusT: 0,
  });
}

const floaters = [];
for(let i=0;i<24;i++) floaters.push({alive:false,sx:0,sy:0,t:0,txt:'',coin:false});

function laneRangeX(lane){
  // světová půl-šířka viditelné plochy v hloubce dráhy + rezerva na sprite
  const s = projS(LANES[lane].z);
  return (W/2)/(s*S) + LANES[lane].duckSize;
}

function resetEntities(){
  ducks = [];
  for(let l=0;l<LANES.length;l++){
    const L = LANES[l], range = laneRangeX(l);
    const trackLen = 2*range;
    const laneOffset = rand(0, trackLen);
    for(let i=0;i<L.count;i++){
      // kolotoč: pevné sloty po trackLen/count → kachničky se nikdy nepřekryjí
      ducks.push({
        lane:l,
        pos: (laneOffset + i*(trackLen/L.count)) % trackLen,
        x: 0,
        knocked:false, knockT:0, respawnT:0, dmg:0, ageT: rand(0,3), riseT:1, hitCd:0,
        focus:0, focusT:0, coin: Math.random() < COIN_DUCK_CHANCE,
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
  special = null;
  specialTimer = rand(5, 9);
  chests = [];
  chestTimer = rand(6, 10);
  // náhodné počáteční rozdělení tierů (nejvyšší hodnota ne vždy nahoře)
  laneTier = [0,1,2];
  const rot = (Math.random()*3)|0;
  for(let i=0;i<rot;i++) laneTier.unshift(laneTier.pop());
  tierRotateT = TIER_ROTATE_T;
}

function addFloater(sx,sy,txt,coin){
  for(const f of floaters){
    if(!f.alive){ f.alive=true; f.sx=sx; f.sy=sy; f.t=0; f.txt=txt; f.coin=!!coin; return; }
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
  prerenderDuck();
  if(isPuzzle()) PUZZLE.prerenderBackground(); else prerenderBackground();
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
  const title = 'GOLDEN DUCKS';
  let titleSize = 32*S;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  do {
    g.font = '700 '+Math.round(titleSize)+'px "Arial Black", Arial, sans-serif';
    if(g.measureText(title).width <= W*0.86) break;
    titleSize -= 1;
  } while(titleSize > 10);
  g.fillText(title, W/2, signH*0.52);

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
  duckSprite = makeDuckSprite(false);
  duckCrownSprite = makeDuckSprite(true);
}

function makeDuckSprite(crown){
  const base = 90;
  const sz = Math.ceil(base*S*DPR);
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const g = cv.getContext('2d');
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
  if(crown){
    // zlatá korunka na hlavě
    g.fillStyle = '#ffd700'; g.strokeStyle = '#c9930a'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(18,21); g.lineTo(21,7); g.lineTo(27,15); g.lineTo(31,4);
    g.lineTo(35,15); g.lineTo(41,7); g.lineTo(44,21); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#ff5a7a';
    g.beginPath(); g.arc(31, 15, 2.4, 0, Math.PI*2); g.fill();
  }
  return cv;
}

// ---------------------------------------------------------------- vstup
function setupInput(){
  // Dva režimy míření:
  //  - myš (PC): absolutní — kurzor JE zaměřovač
  //  - dotyk (mobil): relativní jako trackpad — prst jen táhne, zaměřovač se
  //    pohybuje zrychleně podle rychlosti tahu, takže prst nikdy nezakrývá cíl
  let lastX = 0, lastY = 0, lastT = 0;
  const relative = (e)=> tune.relativeAim && (e.pointerType === 'touch' || e.pointerType === 'pen');

  const aimAbs = (e)=>{
    const r = canvas.getBoundingClientRect();
    cannon.aimSX = clamp(e.clientX - r.left, 10*S, W - 10*S);
    cannon.aimSY = clamp(e.clientY - r.top, H*0.12, H*0.78);
  };
  const aimRel = (e)=>{
    const now = performance.now();
    const dt = Math.max(4, now - lastT)/1000;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; lastT = now;
    // akcelerace: pomalý tah = jemné doladění, švih = rychlý přejezd přes scénu
    const speed = Math.hypot(dx, dy)/dt;
    const g = tune.aimGain * (1 + 1.5*Math.pow(Math.min(speed/2500, 1), 1.5));
    cannon.aimSX = clamp(cannon.aimSX + dx*g, 10*S, W - 10*S);
    cannon.aimSY = clamp(cannon.aimSY + dy*g, H*0.12, H*0.78);
  };

  canvas.addEventListener('pointerdown', e=>{
    e.preventDefault();
    if(relative(e)){ lastX = e.clientX; lastY = e.clientY; lastT = performance.now(); }
    else aimAbs(e);
    cannon.spraying = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e=>{
    if(relative(e)){ if(cannon.spraying) aimRel(e); }
    else aimAbs(e);
  });
  canvas.addEventListener('pointerup',   ()=>{ cannon.spraying=false; });
  canvas.addEventListener('pointercancel', ()=>{ cannon.spraying=false; });
}

// ---------------------------------------------------------------- update
let emitAccum = 0;
const GRAV = 1400;            // world px/s²
const JET_SPEED = 1500;       // world px/s

// Na co hráč míří? Raycast zaměřovače po drahách od nejbližší — vrací hloubku
// cíle. Částice smí ubližovat až od ní: damage dává jen KONEC proudu, ne voda
// letící obloukem nad bližšími kachničkami.
function computeAimZ(){
  if(isPuzzle()) return PUZZLE.aimZ(cannon.aimSX, cannon.aimSY);
  const order = [2,1,0];               // dráhy od nejbližší (z 700 → 900)
  for(const l of order){
    const L = LANES[l], s = projS(L.z);
    const wx = unprojX(cannon.aimSX,s), wy = unprojY(cannon.aimSY,s);
    const cy = L.y + L.duckSize*0.45;
    const r = L.duckSize*0.55;
    for(const d of ducks){
      if(d.lane!==l || d.knocked) continue;
      const dx=wx-d.x, dy=wy-cy;
      if(dx*dx+dy*dy < r*r) return L.z;
    }
    if(special && special.lane===l && special.state!=='sink'){
      const rr=L.duckSize*0.62, dx=wx-special.x, dy=wy-cy;
      if(dx*dx+dy*dy < rr*rr) return L.z;
    }
    for(const ch of chests){
      if(ch.lane!==l || ch.state!=='closed') continue;
      const dx=wx-ch.x, dy=wy-(L.y+CHEST_CY);
      const rr=CHEST_R*1.15;
      if(dx*dx+dy*dy < rr*rr) return L.z;
    }
  }
  return WALL_Z;
}

function update(dt){
  // dokud se opona rozhrnuje, kolo ještě „neběží" — čas stojí, dělo nestříká
  const curtainBusy = curtainState === 'opening';
  playTime += dt;
  // duhový režim: čas kola stojí
  if(rainbowT > 0){
    rainbowT -= dt;
    if(rainbowT <= 0){
      rainbowT = -1; royalCollected = 0;                      // bar se resetuje
      // kachničky navíc se potopí a zmizí ze scény
      for(const d of ducks) if(d.bonus && !d.knocked){ d.knocked = true; d.knockT = 0; d.respawnT = 1e9; }
    }
  }
  if(!rainbowOn() && ducks.some(d=>d.bonus && d.knockT > 0.9)){
    ducks = ducks.filter(d=>!(d.bonus && d.knockT > 0.9));
  }
  if(!curtainBusy && !rainbowOn()) timeLeft -= dt;
  if(tune.autoSpray){
    // auto-spray: míření krouží přes dráhy, zdroje se nevyčerpávají
    cannon.spraying = true;
    cannon.aimSX = W*(0.5 + 0.4*Math.sin(playTime*0.7));
    cannon.aimSY = H*(0.45 + 0.18*Math.sin(playTime*1.13));
    water = WATER_MAX;
    timeLeft = ROUND_TIME;
  }
  if(timeEl) timeEl.textContent = Math.ceil(timeLeft);
  if(timeLeft <= 0){ timeLeft = 0; endRound('Čas vypršel!'); }

  // Docházející voda: nádrž se nevypne rázem — proud ztrácí tlak, zakuckává se,
  // spadne k dělu, dokape a teprve pak je konec kola.
  if(water <= 0 && dryT < 0 && !over){ water = 0; dryT = 0; }
  let pressure = 1;
  if(dryT >= 0){
    dryT += dt;
    const k = Math.min(dryT/DRY_T, 1);
    pressure = Math.max(0, 1 - k) * (1 - k);            // pozvolný propad tlaku
    pressure *= 0.55 + 0.45*Math.sin(dryT*15);          // zakuckávání
    pressure = Math.max(0, pressure);
    if(dryT >= DRY_END_T) endRound('Došla voda!');
  }

  // emise proudu — spotřebovává vodu; při dokapávání jede i bez držení prstu
  const sprayingNow = !over && !curtainBusy && ((cannon.spraying && water > 0) || dryT >= 0);
  // nový proud = nová generace stuhy + tryska začíná nabíhat od nuly
  if(sprayingNow && !prevSpraying){ spineGen++; rampT = 0; }
  prevSpraying = sprayingNow;
  if(!sprayingNow) rampT = 0;
  if(sprayingNow){
    rampT += dt;
    if(water > 0 && !rainbowOn()){     // duhová voda je zadarmo
      water -= WATER_PER_SEC * dt;
      if(water < 0) water = 0;
      updateWaterBar();
    }

    // Cíl ve světě: pointer promítnutý do hloubky, na kterou hráč míří.
    // Dřív se počítalo vždy na zadní stěnu, takže voda bližší předměty
    // podlétala — u drah blízko stěny to nevadilo, u válce v puzzlu ano.
    const targetZ = computeAimZ();
    const ws = projS(targetZ);
    const tx = unprojX(cannon.aimSX, ws);
    const ty = unprojY(cannon.aimSY, ws);
    const m = cannon.muzzle;
    m.x = tx*0.08;            // ústí lehce uhýbá za cílem
    const dx = tx-m.x, dy = ty-m.y, dz = targetZ-m.z;
    const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
    const tFly = dist/JET_SPEED;
    // kompenzace gravitace, aby proud dopadal ~na pointer
    let vx = dx/tFly, vy = dy/tFly + 0.5*GRAV*tFly, vz = dz/tFly;
    // Náběh trysky: slabý tlak = kratší dostřel, proud padá pod zaměřovač
    // a jak tlak roste, zvedá se k němu. Dolet ~ druhá mocnina rychlosti,
    // takže q=0.5 znamená zhruba čtvrtinovou vzdálenost.
    // duhové dělo je natlakované hned — žádné zdlouhavé roztáčení
    const rampDur = Math.max(0.01, tune.jetRampT * (rainbowOn() ? 0.18 : 1));
    const spin = Math.min(rampT/rampDur, 1);
    const spinP = 0.15 + 0.85*Math.pow(spin, 1.5);
    if(spinP < 1){ const q = 0.45 + 0.55*spinP; vx *= q; vy *= q; vz *= q; }
    if(dryT >= 0){
      // slábnoucí tlak = proud nedoletí a padá čím dál blíž k dělu
      const p = 0.25 + 0.75*pressure;
      vx *= p; vy *= p; vz *= p;
    }

    const armZ = targetZ - 80;         // odjištění až u cílové hloubky
    // úzký proud = kam míříš, tam voda dopadne (bez toho se rozstřik rozlije
    // po celém tělíčku a přesnost přestane rozhodovat)
    // při náběhu je proud i o něco rozstřikovanější, než se srovná do linie
    const spread = (dryT >= 0 ? 26 + 110*(1-pressure) : 26) + 26*(1-spinP);

    emitAccum += tune.emitRate * (dryT >= 0 ? pressure : 1) * spinP * dt;
    // duhový režim: dvě trysky rotující kolem sebe
    const twinAng = ribbonTime*7.5;
    const twinR = 34;
    let twinIdx = 0;
    while(emitAccum >= 1){
      emitAccum -= 1;
      let ox = 0, oy = 0, evx = vx, evy = vy;
      if(rainbowOn()){
        const a = twinAng + (twinIdx++ % 2) * Math.PI;
        ox = Math.cos(a)*twinR; oy = Math.sin(a)*twinR;
        // obě trysky musí konvergovat do cíle, jinak stříkají vedle středu
        evx = vx - ox/tFly; evy = vy - oy/tFly;
      }
      const pp = spawnParticle(
        m.x + ox, m.y + oy, m.z,
        evx + rand(-spread,spread), evy + rand(-spread,spread), vz + rand(-22,22),
        1.4, tune.size*2.2*rand(0.8,1.3), 0
      );
      if(pp){ pp.armZ = armZ; pp.hue = rainbowOn() ? (ribbonTime*220 + pp.z*0.4) % 360 : -1; }
    }

    // poslední kapky stékající z ústí — postupně řídnou a ještě před koncem ustanou
    if(dryT >= 0 && pressure < 0.2 && dryT < DRY_END_T - 0.6 && Math.random() < 0.16){
      spawnParticle(m.x + rand(-8,8), m.y, m.z, rand(-25,25), rand(-40,10), rand(10,60),
                    1.1, tune.size*2.6*rand(0.9,1.4), 1);
    }

    // uzel páteře proudu — 1× za frame, bez rozptylu
    if(tune.cartoon && (dryT < 0 || pressure > 0.06)){
      const nd = spine[spineHead];
      spineHead = (spineHead+1)%SPINE_MAX;
      nd.alive=true; nd.x=m.x; nd.y=m.y; nd.z=m.z;
      nd.vx=vx; nd.vy=vy; nd.vz=vz; nd.life=1.4; nd.gen=spineGen; nd.armZ=armZ;
    }
  } else emitAccum = 0;

  // fyzika uzlů páteře (kosmetika — kolize je zhasnou, ale nedávají damage)
  for(const nd of spine){
    if(!nd.alive) continue;
    nd.life -= dt;
    nd.vy -= GRAV*dt;
    nd.x += nd.vx*dt; nd.y += nd.vy*dt; nd.z += nd.vz*dt;
    if(nd.life<=0){ nd.alive=false; continue; }
    if(nd.z >= WALL_Z){ spawnRing(nd.x, nd.y, WALL_Z, 0); nd.alive=false; continue; }
    if(nd.y <= FLOOR_Y){ spawnRing(nd.x, FLOOR_Y, nd.z, 1); splashAt(nd.x, FLOOR_Y, nd.z, 3, 1); nd.alive=false; continue; }
    if(tune.collisions && nd.z >= nd.armZ){
      for(const d of ducks){
        const L = LANES[d.lane];
        if(d.knocked || Math.abs(nd.z - L.z) > 60) continue;
        const r = L.duckSize*0.42;
        const cy = L.y + L.duckSize*0.45;
        const ddx = nd.x-d.x, ddy = nd.y-cy;
        if(ddx*ddx+ddy*ddy < r*r){ nd.alive=false; break; }
      }
      if(nd.alive && special && special.state!=='sink'){
        const L = LANES[special.lane];
        if(Math.abs(nd.z - L.z) <= 60){
          const r = L.duckSize*0.48;
          const cy = L.y + L.duckSize*0.45;
          const ddx = nd.x-special.x, ddy = nd.y-cy;
          if(ddx*ddx+ddy*ddy < r*r) nd.alive=false;
        }
      }
    }
  }

  updateFeathers(dt);

  // rozstřikové kroužky
  for(const r of rings){
    if(!r.alive) continue;
    r.t += dt;
    if(r.t >= r.dur) r.alive=false;
  }

  // kachničky — kolotoč: slot jede pořád (i u sestřelené), takže rozestupy drží
  for(const d of ducks){
    const L = LANES[d.lane];
    const range = laneRangeX(d.lane);
    const trackLen = 2*range;
    d.pos = (d.pos + L.speed*dt) % trackLen;
    d.x = L.dir>0 ? d.pos - range : range - d.pos;
    if(d.knocked){
      // kachnička NEMIZÍ — leží převrhnutá ve svém slotu, pak se zase postaví
      d.knockT += dt;
      // řada se doplňuje svižně, ať scéna nezůstává prázdná
      if(d.knockT > 0.8 && d.respawnT <= 0) d.respawnT = rand(0.5, 1.1);
      if(d.respawnT > 0){
        d.respawnT -= dt;
        if(d.respawnT <= 0){
          d.knocked=false; d.knockT=0; d.dmg=0; d.ageT=0; d.riseT=0; d.focus=0; d.focusT=0;
          d.coin = Math.random() < COIN_DUCK_CHANCE;
        }
      }
    } else {
      if(d.riseT < 1) d.riseT += dt;
      if(d.hitCd > 0) d.hitCd -= dt;
      // linie drží jen dokud chodí zásahy do středu
      if(d.focusT > 0){ d.focusT -= dt; if(d.focusT <= 0) d.focus = 0; }
      d.ageT += dt;
      d.wobble += dt*3;
    }
  }

  if(isPuzzle()){
    PUZZLE.update(dt);
    if(PUZZLE.isWon()) endRound('Kachnička osvobozena!');
  }

  // rotace hodnotových tierů mezi drahami — jen ve střelnici
  if(!isPuzzle()){
  tierRotateT -= dt;
  if(tierRotateT <= 0){
    tierRotateT = TIER_ROTATE_T;
    laneTier.unshift(laneTier.pop());
  }

  // speciální korunková kachnička
  if(!special){
    // v duhovém režimu královské nepřijíždějí (viz collectRoyal)
    if(!rainbowOn()){
      specialTimer -= dt;
      if(specialTimer <= 0) spawnSpecial();
    }
  } else {
    const L = LANES[special.lane];
    const trackLen = 2*laneRangeX(special.lane);
    special.pos += L.speed*dt;             // bez wrapu — dojede na konec řádku a odpluje
    special.x = L.dir>0 ? special.pos - trackLen/2 : trackLen/2 - special.pos;
    special.t += dt;
    if(special.hitCd > 0) special.hitCd -= dt;
    if(special.focusT > 0){ special.focusT -= dt; if(special.focusT <= 0) special.focus = 0; }
    if(special.state==='rise' && special.t>0.4){ special.state='up'; special.t=0; }
    else if(special.state==='sink' && special.t>0.75){ special=null; specialTimer=rand(8,14); }
    if(special && special.pos > trackLen + L.duckSize){ special=null; specialTimer=rand(8,14); }
  }

  // truhlička
  if(chests.length < maxChests()){
    chestTimer -= dt;
    if(chestTimer <= 0){ spawnChest(); chestTimer = nextChestDelay(); }
  }
  for(let i=chests.length-1; i>=0; i--){
    const ch = chests[i];
    const L = LANES[ch.lane];
    const trackLen = 2*laneRangeX(ch.lane);
    ch.pos = (ch.pos + L.speed*dt) % trackLen;
    ch.x = L.dir>0 ? ch.pos - trackLen/2 : trackLen/2 - ch.pos;
    ch.wobble += dt*2.5;
    ch.t += dt;
    if(ch.hitCd > 0) ch.hitCd -= dt;
    if(ch.focusT > 0){ ch.focusT -= dt; if(ch.focusT <= 0) ch.focus = 0; }
    if(ch.state==='in' && ch.t>0.25){ ch.state='closed'; ch.t=0; }
    else if(ch.state==='closed' && ch.t>CHEST_UP_T){ ch.state='sink'; ch.t=0; }
    else if(ch.state==='open' && ch.t>1.4){ ch.state='sink'; ch.t=0; }
    else if(ch.state==='sink' && ch.t>CHEST_SINK_T){ chests.splice(i,1); chestTimer=nextChestDelay(); }
  }

  // pop-up terče
  popupTimer -= dt;
  if(popupTimer <= 0){
    popupTimer = rand(2.5, 4.5);
    const hidden = popups.filter(p=>p.state==='hidden');
    if(hidden.length){
      const p = hidden[(Math.random()*hidden.length)|0];
      p.state='in'; p.t=0; p.ttl=rand(1.5, 2.2);   // jen krátké okno na zásah
    }
  }
  for(const p of popups){
    if(p.state==='hidden') continue;
    p.t += dt;
    if(p.state==='in' && p.t>0.25){ p.state='up'; p.t=0; }
    else if(p.state==='up' && p.t>p.ttl){ p.state='out'; p.t=0; }
    else if(p.state==='out' && p.t>0.25){ p.state='hidden'; }
  }

  }  // konec sekcí jen pro střelnici

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
      if(isPuzzle()){
        if(tune.collisions && p.z >= p.armZ && PUZZLE.onParticle(p)) dead = true;
      } else if(tune.collisions){
        // damage jen odjištěnou částicí (konec proudu) — voda letící obloukem
        // nad bližšími kachničkami jim neubližuje
        const armed = p.z >= p.armZ;
        if(armed) for(const d of ducks){
          const L = LANES[d.lane];
          if(d.knocked || Math.abs(p.z - L.z) > 60) continue;
          const r = L.duckSize*0.42;
          const cy = L.y + L.duckSize*0.45;
          const ddx = p.x-d.x, ddy = p.y-cy;
          const d2 = ddx*ddx+ddy*ddy;
          if(d2 < r*r){
            // přímý zásah do kolečka s body = plný bod, zbytek tělíčka půl
            hitDuck(d, p, d2 < r*r*0.25);
            dead=true; break;
          }
        }
        if(armed && !dead && special && special.state!=='sink'){
          const L = LANES[special.lane];
          if(Math.abs(p.z - L.z) <= 60){
            const r = L.duckSize*0.48;
            const cy = L.y + L.duckSize*0.45;
            const ddx = p.x-special.x, ddy = p.y-cy;
            const d2 = ddx*ddx+ddy*ddy;
            if(d2 < r*r){ hitSpecial(p, d2 < r*r*0.25); dead=true; }
          }
        }
        if(!dead){
          for(const t of popups){
            if(t.state!=='up' || p.z < t.z-70) continue;
            const ddx = p.x-t.x, ddy = p.y-t.y;
            const d2 = ddx*ddx+ddy*ddy;
            // střed terče (červený bod) = bullseye bonus
            if(d2 < t.r*t.r){ hitPopup(t, p, d2 < t.r*t.r*0.16); dead=true; break; }
          }
        }
        if(armed && !dead) for(const ch of chests){
          if(ch.state!=='closed') continue;
          const Lc = LANES[ch.lane];
          if(Math.abs(p.z - Lc.z) > 60) continue;
          const ddx = p.x-ch.x, ddy = p.y-(Lc.y+CHEST_CY);
          const d2 = ddx*ddx+ddy*ddy;
          if(d2 < CHEST_R*CHEST_R){ hitChest(ch, p, d2 < CHEST_R*CHEST_R*0.25); dead=true; break; }
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

function hitDuck(d, p, direct){
  const L = LANES[d.lane];
  splashAt(p.x, p.y, p.z, direct ? tune.splash+3 : tune.splash, 0);
  if(direct) spawnRing(p.x, p.y, p.z, 0);   // feedback kritu (throttled)
  if(d.hitCd > 0) return;      // šplíchá to, ale HP ubývá max 1× za HIT_CD
  d.hitCd = hitCd();
  if(direct){
    d.dmg += CENTER_DMG * focusMul(d.focus) * dmgMul();   // držená linie = exponenciální nárůst
    d.focus++;
    d.focusT = FOCUS_GRACE;
  } else {
    d.dmg += BODY_DMG * dmgMul();              // tělíčko ubírá, ale sérii nedrží
  }
  if(d.dmg >= duckHpNeeded(d)){
    d.knocked=true; d.knockT=0; d.respawnT=0;
    // Aktivní hráč si královskou přivolá dřív — každý sestřel ukrojí z odpočtu.
    // Podmínka je nutná: bez ní by Math.max odpočet, který už klesl pod
    // minimum, naopak zvedal zpátky a královská by nikdy nepřijela.
    if(specialTimer > SPECIAL_MIN_WAIT){
      specialTimer = Math.max(SPECIAL_MIN_WAIT, specialTimer - SPECIAL_KILL_CUT);
    }
    const s = projS(L.z);
    addFloater(projX(d.x,s), projY(L.y+L.duckSize*0.45,s), 'KVÁK!');
    spawnFeathers(d.x, L.y + L.duckSize*0.5, L.z, rainbowOn()?26:16, rainbowOn()?1.7:1);
    if(d.coin) addCoins(COIN_DUCK, projX(d.x,s), projY(L.y+L.duckSize*0.75,s));
    addScore(duckValue(d), projX(d.x,s), projY(L.y+L.duckSize,s));
    splashAt(d.x, L.y+L.duckSize*0.4, L.z, tune.splash*2, 0);
    spawnRing(d.x, L.y+L.duckSize*0.4, L.z, 0);
  }
}

function hitSpecial(p, direct){
  const L = LANES[special.lane];
  splashAt(p.x, p.y, p.z, direct ? tune.splash+3 : tune.splash, 0);
  if(direct) spawnRing(p.x, p.y, p.z, 0);
  if(special.hitCd > 0) return;
  special.hitCd = hitCd();
  if(direct){
    special.hp -= CENTER_DMG * focusMul(special.focus) * dmgMul();
    special.focus++;
    special.focusT = FOCUS_GRACE;
  } else {
    special.hp -= BODY_DMG * dmgMul();
  }
  if(special.hp<=0){
    const s = projS(L.z);
    addFloater(projX(special.x,s), projY(L.y+L.duckSize*0.45,s), 'KVÁÁK!');
    spawnFeathers(special.x, L.y + L.duckSize*0.5, L.z, rainbowOn()?38:28, rainbowOn()?2:1.4);
    addCoins(COIN_ROYAL, projX(special.x,s), projY(L.y+L.duckSize*0.75,s));
    addScore(SPECIAL_VAL, projX(special.x,s), projY(L.y+L.duckSize,s));
    collectRoyal();
    splashAt(special.x, L.y+L.duckSize*0.4, L.z, tune.splash*3, 0);
    spawnRing(special.x, L.y+L.duckSize*0.4, L.z, 0);
    special.state='sink'; special.t=0;
  }
}

function hitChest(chest, p, direct){
  splashAt(p.x, p.y, p.z, direct ? tune.splash+3 : tune.splash, 0);
  if(direct) spawnRing(p.x, p.y, p.z, 0);
  if(chest.hitCd > 0) return;
  chest.hitCd = hitCd();
  if(direct){
    chest.hp -= CENTER_DMG * focusMul(chest.focus) * dmgMul();   // zámek uprostřed povolí rychleji
    chest.focus++;
    chest.focusT = FOCUS_GRACE;
  } else {
    chest.hp -= BODY_DMG * dmgMul();
  }
  if(chest.hp<=0){
    chest.state='open'; chest.t=0; chest.opened=true;
    const L = LANES[chest.lane];
    const s = projS(L.z);
    const sx = projX(chest.x,s), sy = projY(L.y+CHEST_CY,s);
    if(chest.reward==='coins'){
      addCoins(COIN_CHEST, sx, sy - 70*s*S);
    } else if(chest.reward==='time'){
      timeLeft += CHEST_TIME_BONUS;
      addFloater(sx, sy - 70*s*S, '+'+CHEST_TIME_BONUS+' s');
    } else {
      water = Math.min(WATER_MAX, water + CHEST_WATER_BONUS);
      dryT = -1;                    // kapka na poslední chvíli zachrání dokapávající proud
      updateWaterBar();
      addFloater(sx, sy - 70*s*S, '+voda');
    }
    splashAt(chest.x, L.y+CHEST_CY, L.z, tune.splash*2, 0);
    spawnRing(chest.x, L.y+CHEST_CY, L.z, 0);
  }
}

function hitPopup(t, p, bull){
  splashAt(p.x, p.y, t.z, tune.splash, 0);
  const bonus = Math.round((1 - Math.min(t.t,t.ttl)/t.ttl) * 100);
  t.state='out'; t.t=0;
  const s = projS(t.z);
  // trefa doprostřed (červený střed) = bullseye bonus navrch
  if(bull){
    splashAt(t.x, t.y, t.z, tune.splash*2, 0);
    addFloater(projX(t.x,s), projY(t.y,s), 'TREFA!');
  }
  addScore(100 + bonus + (bull ? 150 : 0), projX(t.x,s), projY(t.y+t.r,s));
  spawnRing(t.x, t.y, t.z, 0);
}

// ---------------------------------------------------------------- draw
function draw(){
  if(isPuzzle()){ PUZZLE.drawBackground(); PUZZLE.drawScene(); }
  else ctx.drawImage(bgCanvas, 0, 0, W, H);

  // pop-up terče (na stěně) — jen ve střelnici
  if(!isPuzzle()) for(const t of popups){
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

  // kachničky — od nejvzdálenější dráhy; po každé dráze přední hrana žlabu.
  // Zasažená kachnička se POTÁPÍ pod hladinu — clip na linii žlabu ji ořízne.
  if(!isPuzzle()) for(let l=0;l<LANES.length;l++){
    const L = LANES[l], s = projS(L.z);
    const spriteSz = L.duckSize*1.1*s*S;
    const ly = projY(L.y, s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, ly + 4*S);   // vše pod hladinou žlabu je skryté
    ctx.clip();
    drawChest(l);          // truhla patří ZA kachničky, ať je nikdy nepřekryje
    for(const d of ducks){
      if(d.lane!==l) continue;
      // smrtelný zásah: nejdřív squash&stretch hop (je poznat, že jsme trefili),
      // teprve pak potopení pod hladinu; vynoření = zvednutí zpět
      let sink = 0, sqX = 1, sqY = 1, hop = 0;
      if(d.knocked){
        const k = Math.min(d.knockT/0.35, 1);
        const sq = Math.sin(k*Math.PI);
        sqX = 1 + 0.45*sq;
        sqY = 1 - 0.4*sq;
        hop = -12*S*sq;
        sink = clamp((d.knockT-0.35)/0.45, 0, 1);
      }
      else if(d.riseT < 0.35) sink = 1 - d.riseT/0.35;
      if(sink >= 1) continue;
      const sx = projX(d.x,s);
      const sy = projY(L.y + Math.sin(d.wobble)*8 + 14, s) + sink*spriteSz*1.05 + hop;
      ctx.save();
      ctx.translate(sx, sy);
      // sprite míří doleva → při jízdě doprava zrcadlit (zobák dopředu)
      ctx.scale((L.dir>0 ? -1 : 1)*sqX, sqY);
      ctx.drawImage(duckSprite, -spriteSz*0.53, -spriteSz*0.75, spriteSz, spriteSz);
      ctx.restore();

      // kulatý bar na těle: plní se zásahy, uvnitř aktuální hodnota kachničky
      if(!d.knocked && sink <= 0){
        const heat = d.focusT > 0 ? Math.min(d.focus/4, 1) : 0;
        drawDuckBadge(sx, sy - spriteSz*0.12, spriteSz*0.19, d.dmg/duckHpNeeded(d), duckValue(d), false, heat);
      }
    }
    // speciální korunková kachnička ve své dráze
    if(special && special.lane===l){
      let sink = 0, sqX = 1, sqY = 1, hop = 0;
      if(special.state==='rise') sink = 1 - special.t/0.4;
      else if(special.state==='sink'){
        const k = Math.min(special.t/0.35, 1);
        const sq = Math.sin(k*Math.PI);
        sqX = 1 + 0.45*sq; sqY = 1 - 0.4*sq; hop = -12*S*sq;
        sink = clamp((special.t-0.35)/0.4, 0, 1);
      }
      if(sink < 1){
        const spSz = L.duckSize*1.15*1.1*s*S;
        const sx = projX(special.x,s);
        const sy = projY(L.y + 14, s) + sink*spSz*1.05 + hop;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale((L.dir>0 ? -1 : 1)*sqX, sqY);
        ctx.drawImage(duckCrownSprite, -spSz*0.53, -spSz*0.75, spSz, spSz);
        ctx.restore();
        if(special.state==='up'){
          const heat = special.focusT > 0 ? Math.min(special.focus/4, 1) : 0;
          drawDuckBadge(sx, sy - spSz*0.12, spSz*0.19, 1 - special.hp/SPECIAL_HP, SPECIAL_VAL, true, heat);
        }
      }
    }
    ctx.restore();
    // přední hrana žlabu přes nožičky
    ctx.fillStyle = 'rgba(23,58,99,0.9)';
    ctx.fillRect(0, ly, W, 30*s*S);
    ctx.fillStyle = 'rgba(160,220,255,0.25)';
    ctx.fillRect(0, ly, W, 2.5*S);
  }

  drawFeathers();

  // voda
  if(tune.cartoon){
    drawJetRibbon();
    drawDropletsCartoon();
    drawRings();
  } else {
    // basic mód (perf baseline): jednobarevná kolečka v jednom passu
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
  }

  // dělo v podhledu — základna dole, hlaveň se naklání za pointerem
  const baseX = W/2, baseY = H + 30*S;
  const mx = baseX + (cannon.aimSX - baseX)*0.22;
  const my = H*0.84 + (cannon.aimSY - H*0.45)*0.06;
  cannon.muzzleSX = mx; cannon.muzzleSY = my;
  const ang = Math.atan2(my-baseY, mx-baseX);
  drawCannonBarrel(baseX, baseY, mx, my, ang);
  const wMuz = 34*S;
  // pěna u výstupu vody — malé chomáčky kousek nad koncem hlavně
  if(cannon.spraying && !over && water > 0){
    const foam = 1 + 0.2*Math.sin(ribbonTime*22);
    ctx.fillStyle = 'rgba(235,250,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(mx, my - wMuz*0.9, wMuz*0.34*foam, wMuz*0.2*foam, 0, 0, Math.PI*2);
    ctx.ellipse(mx - wMuz*0.35, my - wMuz*0.72, wMuz*0.16*foam, wMuz*0.11*foam, 0, 0, Math.PI*2);
    ctx.ellipse(mx + wMuz*0.36, my - wMuz*0.7, wMuz*0.14*foam, wMuz*0.1*foam, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // zaměřovač — na mobilu je jediným vodítkem (prst je jinde), takže výrazný:
  // tmavý obrys pod bílou kresbou, ať je čitelný na jakémkoli pozadí
  const ax = cannon.aimSX, ay = cannon.aimSY;
  const cross = (color, lw)=>{
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(ax, ay, 15*S, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax-24*S, ay); ctx.lineTo(ax-9*S, ay);
    ctx.moveTo(ax+9*S, ay);  ctx.lineTo(ax+24*S, ay);
    ctx.moveTo(ax, ay-24*S); ctx.lineTo(ax, ay-9*S);
    ctx.moveTo(ax, ay+9*S);  ctx.lineTo(ax, ay+24*S);
    ctx.stroke();
  };
  cross('rgba(0,0,0,0.45)', 5.5*S);
  cross(cannon.spraying ? 'rgba(190,235,255,0.95)' : 'rgba(255,255,255,0.7)', 2.2*S);
  ctx.fillStyle = cannon.spraying ? 'rgba(190,235,255,0.95)' : 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(ax, ay, 2.4*S, 0, Math.PI*2); ctx.fill();

  // plovoucí skóre
  ctx.fillStyle = '#ffe98a';
  ctx.font = '700 '+Math.round(20*S)+'px Arial, sans-serif';
  ctx.textAlign = 'center';
  for(const f of floaters){
    if(!f.alive) continue;
    ctx.globalAlpha = 1 - f.t/0.9;
    if(f.coin){
      ctx.fillStyle = '#ffd700';
      ctx.fillText(f.txt, f.sx - 9*S, f.sy);
      drawCoin(f.sx + 14*S, f.sy - 5*S, 8*S);
      ctx.fillStyle = '#ffe98a';
      ctx.font = '700 '+Math.round(20*S)+'px Arial, sans-serif';
      ctx.textAlign = 'center';
    } else {
      ctx.fillText(f.txt, f.sx, f.sy);
    }
  }
  ctx.globalAlpha = 1;

  // ---- herní HUD na plátně ----
  // skóre: velké, uprostřed modré pasáže nad terči
  const hudY = H*0.215;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '800 '+Math.round(46*S)+'px "Arial Black", Arial, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(score, W/2 + 2.5*S, hudY + 2.5*S);
  ctx.fillStyle = '#ffe98a';
  ctx.fillText(score, W/2, hudY);
  // čas: menší, vpravo ve stejné lince
  ctx.font = '700 '+Math.round(22*S)+'px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(Math.ceil(timeLeft)+' s', W - 18*S + 1.5*S, hudY + 1.5*S);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(Math.ceil(timeLeft)+' s', W - 18*S, hudY);
  // mince vlevo — zrcadlí čas vpravo
  const coinR = 11*S * (1 + 0.35*coinPop), coinX = 20*S + 11*S;
  drawCoin(coinX, hudY, coinR);
  ctx.font = '700 '+Math.round(22*S)+'px Arial, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(coins, coinX + coinR + 7*S + 1.5*S, hudY + 1.5*S);
  ctx.fillStyle = '#ffd700';
  ctx.fillText(coins, coinX + coinR + 7*S, hudY);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  drawWaterTank();
  if(isPuzzle()) PUZZLE.drawHud();
  else if(tune.specialMode) drawRoyalTracker();
  drawFlyCoins();
  drawCurtain();
  drawFps();          // nad vším včetně opony — kvůli měření na mobilech
}

// FPS v levém horním rohu (vpravo je version badge). Barva hlásí kondici:
// zelená plynule, žlutá znát, červená trhá.
function drawFps(){
  const f = perf.fps;
  if(!f) return;
  const x = 12*S, y = 10*S;
  ctx.font = '700 '+Math.round(15*S)+'px "SF Mono", Menlo, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const txt = f + ' FPS';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(txt, x + 1.5*S, y + 1.5*S);
  ctx.fillStyle = f >= 55 ? '#7dff8a' : (f >= 30 ? '#ffd54a' : '#ff6b6b');
  ctx.fillText(txt, x, y);
  ctx.textBaseline = 'alphabetic';
}

// Tři korunky pod skóre: každá sejmutá královská kachnička jednu odškrtne.
// Když jsou všechny tři, rozjede se duhový režim a ukazuje se jeho odpočet.
function drawRoyalTracker(){
  const y = H*0.215 + 42*S;
  const r = 15*S, gap = 42*S;
  const x0 = W/2 - gap;

  if(rainbowOn()){
    // odpočet duhového režimu místo ikon
    const bw = 150*S, bh = 9*S, bx = W/2 - bw/2, by = y - bh/2;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx, by, bw, bh);
    const g = ctx.createLinearGradient(bx, 0, bx+bw, 0);
    for(let i=0;i<=6;i++) g.addColorStop(i/6, 'hsl('+((ribbonTime*220 + i*60)%360)+',95%,62%)');
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw*(rainbowT/RAINBOW_T), bh);
    ctx.font = '800 '+Math.round(15*S)+'px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('DUHOVÝ REŽIM ' + Math.ceil(rainbowT) + ' s', W/2, by - 13*S);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    return;
  }

  for(let i=0;i<ROYAL_NEEDED;i++){
    const cx = x0 + i*gap, got = i < royalCollected;
    ctx.fillStyle = got ? 'rgba(232,195,74,0.9)' : 'rgba(8,16,36,0.5)';
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = got ? '#fff3c4' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2*S;
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI*2); ctx.stroke();
    // korunka uvnitř
    ctx.fillStyle = got ? '#5a3a06' : 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(cx-r*0.55, y+r*0.35);
    ctx.lineTo(cx-r*0.55, y-r*0.15);
    ctx.lineTo(cx-r*0.2,  y+r*0.1);
    ctx.lineTo(cx,        y-r*0.5);
    ctx.lineTo(cx+r*0.2,  y+r*0.1);
    ctx.lineTo(cx+r*0.55, y-r*0.15);
    ctx.lineTo(cx+r*0.55, y+r*0.35);
    ctx.closePath(); ctx.fill();
    if(got){
      // odškrtnutí
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3*S; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx-r*0.45, y+r*0.05); ctx.lineTo(cx-r*0.1, y+r*0.45);
      ctx.lineTo(cx+r*0.5, y-r*0.4);
      ctx.stroke(); ctx.lineCap = 'butt';
    }
  }
}

// Pouťové vodní dělo. Kreslí se v lokální soustavě (hlaveň míří po -Y),
// takže pásy, válcové stínování i zubatý vzor jdou popsat přímočaře.
function drawCannonBarrel(baseX, baseY, mx, my, ang){
  const len = Math.hypot(mx-baseX, my-baseY);
  const wBase = 78*S, wMuz = 40*S;
  const widthAt = t => wBase + (wMuz-wBase)*t;

  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.rotate(ang + Math.PI/2);          // lokální -Y = směr hlavně

  // válcové stínování: tmavé okraje, světlý pruh mírně vlevo od osy
  const body = ctx.createLinearGradient(-wBase, 0, wBase, 0);
  body.addColorStop(0.00,'#0a2a60');
  body.addColorStop(0.20,'#1d5db4');
  body.addColorStop(0.40,'#5aa8f0');
  body.addColorStop(0.62,'#2472cf');
  body.addColorStop(1.00,'#0a2a60');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-wBase, 0); ctx.lineTo(-wMuz, -len);
  ctx.lineTo(wMuz, -len); ctx.lineTo(wBase, 0);
  ctx.closePath(); ctx.fill();

  // zubatý vzor pod ústím (tmavé trojúhelníky vzhůru)
  const patT0 = 0.52, patT1 = 0.74;
  const yTop = -len*patT1, yBot = -len*patT0;
  const wTop = widthAt(patT1), wBot = widthAt(patT0);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-wBot, yBot); ctx.lineTo(-wTop, yTop);
  ctx.lineTo(wTop, yTop); ctx.lineTo(wBot, yBot);
  ctx.closePath(); ctx.clip();
  ctx.fillStyle = '#123a7a';
  const teeth = 5;
  for(let i=0;i<teeth;i++){
    const x0 = -wBot + (2*wBot)*(i/teeth);
    const x1 = -wBot + (2*wBot)*((i+1)/teeth);
    ctx.beginPath();
    ctx.moveTo(x0, yBot); ctx.lineTo((x0+x1)/2, yTop - 4*S); ctx.lineTo(x1, yBot);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // Zlaté obruče: hrany se prohýbají k divákovi, protože válec vidíme
  // shora — obruč tedy není rovný pásek, ale kus elipsy.
  const goldGrad = (w) => {
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0.00,'#8a5410');
    g.addColorStop(0.22,'#e8a33a');
    g.addColorStop(0.42,'#ffdd94');
    g.addColorStop(0.65,'#e0952c');
    g.addColorStop(1.00,'#8a5410');
    return g;
  };
  const band = (t, h, over) => {
    const w = widthAt(t)*over;
    const y = -len*t;
    const bow = w*0.2;                       // prohnutí k divákovi
    ctx.fillStyle = goldGrad(w);
    ctx.beginPath();
    ctx.moveTo(-w, y-h/2);
    ctx.quadraticCurveTo(0, y-h/2 + bow*2, w, y-h/2);   // horní hrana
    ctx.lineTo(w, y+h/2);
    ctx.quadraticCurveTo(0, y+h/2 + bow*2, -w, y+h/2);  // spodní hrana
    ctx.closePath(); ctx.fill();
  };
  band(0.30, 18*S, 1.10);      // spodní obruč
  band(0.78, 20*S, 1.14);      // obruč pod ústím

  // Ústí: z nadhledu koukáme na okraj hlavně skoro z boku, takže žádná díra —
  // vidíme jen silně zkrácený prstenec, a to hlavně jeho vnější horní plochu.
  const rimW = wMuz*1.3, rimH = wMuz*0.34;
  const bowR = rimW*0.2;
  ctx.fillStyle = goldGrad(rimW);
  ctx.beginPath();
  ctx.moveTo(-rimW, -len);
  ctx.quadraticCurveTo(0, -len - rimH*1.5, rimW, -len);          // vnější hrana ústí
  ctx.lineTo(rimW*0.98, -len + rimH);
  ctx.quadraticCurveTo(0, -len + rimH + bowR*1.6, -rimW*0.98, -len + rimH);
  ctx.closePath(); ctx.fill();
  // lesk na horní (přivrácené) hraně
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2.5*S;
  ctx.beginPath();
  ctx.moveTo(-rimW*0.9, -len - rimH*0.15);
  ctx.quadraticCurveTo(0, -len - rimH*1.5, rimW*0.9, -len - rimH*0.15);
  ctx.stroke();

  ctx.restore();
}

// Truhlička pluje ve žlabu dráhy: houpe se a kolébá jako kachničky.
function drawChest(l){
  for(const ch of chests) if(ch.lane===l) drawChestOne(ch, l);
}

function drawChestOne(chest, l){
  const L = LANES[l], s = projS(L.z);
  let sc = 1;
  if(chest.state==='in') sc = chest.t/0.25;
  if(sc <= 0) return;
  const sinkK = chest.state==='sink' ? Math.min(chest.t/CHEST_SINK_T, 1) : 0;
  const cx = projX(chest.x,s);
  const cy = projY(L.y + CHEST_CY + Math.sin(chest.wobble)*16, s) + sinkK*190*s*S;
  const rock = Math.sin(chest.wobble*0.8 + 1)*0.1;    // kolébání na vlnkách
  const w = 200*s*S*sc, h = 135*s*S*sc;
  // otevřená truhla si víko drží i cestou pod hladinu
  const open = chest.state==='open' || (chest.state==='sink' && chest.opened);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rock);
  ctx.translate(-cx, -cy);
  const rr = (x,y,ww,hh,r)=>{
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x,y,ww,hh,r);
    else ctx.rect(x,y,ww,hh);
  };

  // zlatá záře za otevřenou truhlou
  if(open){
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, w);
    glow.addColorStop(0,'rgba(255,215,80,0.5)'); glow.addColorStop(1,'rgba(255,215,80,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, w, 0, Math.PI*2); ctx.fill();
  }

  // víko: zavřené sedí na těle, otevřené odklopené nahoru
  ctx.save();
  ctx.translate(cx, cy - h*0.18);
  if(open) { ctx.translate(0, -h*0.42); ctx.rotate(-0.5); }
  const lidG = ctx.createLinearGradient(0,-h*0.35,0,0);
  lidG.addColorStop(0,'#8a5f2e'); lidG.addColorStop(1,'#6b4a24');
  ctx.fillStyle = lidG;
  rr(-w/2, -h*0.35, w, h*0.38, 6*S); ctx.fill();
  ctx.strokeStyle = '#e8a33a'; ctx.lineWidth = 2.5*S;
  rr(-w/2, -h*0.35, w, h*0.38, 6*S); ctx.stroke();
  ctx.restore();

  // tělo
  const bodyG = ctx.createLinearGradient(cx,cy-h*0.2,cx,cy+h*0.55);
  bodyG.addColorStop(0,'#7a5228'); bodyG.addColorStop(1,'#553a1c');
  ctx.fillStyle = bodyG;
  rr(cx-w/2, cy-h*0.18, w, h*0.7, 6*S); ctx.fill();
  ctx.strokeStyle = '#e8a33a'; ctx.lineWidth = 2.5*S;
  rr(cx-w/2, cy-h*0.18, w, h*0.7, 6*S); ctx.stroke();
  // zlaté pásy + zámek
  ctx.fillStyle = '#e8a33a';
  ctx.fillRect(cx-w*0.32, cy-h*0.18, 5*S, h*0.7);
  ctx.fillRect(cx+w*0.32-5*S, cy-h*0.18, 5*S, h*0.7);
  if(!open){
    ctx.beginPath(); ctx.arc(cx, cy+h*0.05, 8*s*S*sc*2.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#553a1c';
    ctx.fillRect(cx-2.5*S, cy+h*0.05, 5*S, 9*s*S*sc*2);
  }

  // odměna vyjíždí z truhly
  if(open){
    const k = Math.min(chest.t/1.1, 1);
    const iy = cy - h*0.3 - k*90*s*S;
    ctx.save();
    ctx.globalAlpha = 1 - Math.max(0, (chest.t-0.9)/0.5);
    if(chest.reward==='coins'){
      drawCoin(cx, iy, 32*s*S);
    } else if(chest.reward==='time'){
      // hodiny
      const r = 34*s*S;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(cx, iy, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath(); ctx.arc(cx, iy, r*0.78, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#553a1c'; ctx.lineWidth = Math.max(2, r*0.12);
      ctx.beginPath();
      ctx.moveTo(cx, iy); ctx.lineTo(cx, iy-r*0.55);
      ctx.moveTo(cx, iy); ctx.lineTo(cx+r*0.4, iy+r*0.15);
      ctx.stroke();
    } else {
      // kapka
      const r = 30*s*S;
      ctx.fillStyle = '#5ad1ff';
      ctx.beginPath();
      ctx.moveTo(cx, iy-r*1.2);
      ctx.bezierCurveTo(cx+r, iy-r*0.1, cx+r*0.85, iy+r*0.8, cx, iy+r*0.8);
      ctx.bezierCurveTo(cx-r*0.85, iy+r*0.8, cx-r, iy-r*0.1, cx, iy-r*1.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(cx-r*0.3, iy+r*0.15, r*0.22, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // otazník + progress prstenec dokud je zavřená
  if(chest.state==='closed'){
    const heat = chest.focusT > 0 ? Math.min(chest.focus/4, 1) : 0;
    drawDuckBadge(cx, cy + h*0.12, 34*s*S, 1 - chest.hp/CHEST_HP, '?', true, heat);
  }
  ctx.restore();
}

// Sametová opona — dvě půlky se rozjíždějí do stran. Kreslí se nad vším,
// takže při zatažení schová celou scénu i HUD.
function drawCurtain(){
  if(curtain >= 1) return;
  const halfW = (W/2) * (1 - curtain);
  if(halfW < 0.5) return;
  drawCurtainHalf(0, halfW, 1);
  drawCurtainHalf(W - halfW, halfW, -1);
}

function drawCurtainHalf(x0, w, dir){
  const folds = 7;
  // samet: střídavé svislé pruhy = záhyby
  const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  for(let i=0;i<=folds;i++){
    g.addColorStop(i/folds, i%2 ? '#a81c2e' : '#67101d');
  }
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, w, H);
  // hloubka: tmavší nahoře a dole
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, 'rgba(0,0,0,0.35)');
  vg.addColorStop(0.35, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(x0, 0, w, H);
  // vnitřní hrana: zlatý lem + stín do scény
  const ix = dir > 0 ? x0 + w : x0;          // hrana směrem doprostřed
  const lemW = 9*S;
  ctx.fillStyle = '#e8c34a';
  ctx.fillRect(dir > 0 ? ix - lemW : ix, 0, lemW, H);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(dir > 0 ? ix - lemW : ix + lemW - 2.5*S, 0, 2.5*S, H);
  const sg = ctx.createLinearGradient(ix, 0, ix + dir*26*S, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0.45)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(dir > 0 ? ix : ix - 26*S, 0, 26*S, H);
}

// Kulatý bar kachničky: prstenec plnění zásahy + hodnota uvnitř.
function drawDuckBadge(x, y, r, prog, value, gold, heat){
  ctx.fillStyle = gold ? 'rgba(80,60,4,0.6)' : 'rgba(8,16,36,0.55)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  // držená linie: ze středu pulzují rozpínající se kruhy („trefuješ správně")
  // + prstenec se rozžhaví z ledové modré do zlatooranžové
  const h = heat || 0;
  if(h > 0){
    const PULSES = 3;
    const speed = 1.2 + 1.1*h;                 // delší série = rychlejší tep
    for(let i=0;i<PULSES;i++){
      const ph = ((ribbonTime*speed) + i/PULSES) % 1;
      const a = (1-ph)*(0.35+0.5*h);
      if(a <= 0.02) continue;
      ctx.strokeStyle = 'rgba(255,214,90,'+a.toFixed(3)+')';
      ctx.lineWidth = Math.max(1, r*0.16*(1-ph*0.6));
      ctx.beginPath();
      ctx.arc(x, y, r*(0.75 + ph*1.7), 0, Math.PI*2);
      ctx.stroke();
    }
  }
  if(prog > 0){
    ctx.strokeStyle = gold ? '#ffd700'
      : 'rgb('+Math.round(90+165*h)+','+Math.round(209-6*h)+','+Math.round(255-255*h)+')';
    ctx.lineWidth = Math.max(2, r*(0.3+0.12*h));
    ctx.beginPath();
    ctx.arc(x, y, r*0.78, -Math.PI/2, -Math.PI/2 + prog*Math.PI*2);
    ctx.stroke();
  }
  ctx.fillStyle = gold ? '#ffe98a' : '#fff';
  ctx.font = '700 '+Math.max(8, Math.round(r*0.8))+'px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
  ctx.textBaseline = 'alphabetic';
}

// Nádržka s vodou u děla — stav munice přímo v zorném poli hráče.
function drawWaterTank(){
  const tw = 44*S, th = 100*S;
  const tx = W/2 - 108*S - tw, ty = H - th - 20*S;   // levá strana obrazu
  const frac = water/WATER_MAX;
  const rr = (x,y,w,h,r)=>{
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x,y,w,h,r);
    else ctx.rect(x,y,w,h);
  };
  // sklo
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  rr(tx,ty,tw,th,8*S); ctx.fill();
  // voda
  if(frac > 0.02){
    const wh = (th-6*S)*frac;
    const wg = ctx.createLinearGradient(tx,0,tx+tw,0);
    wg.addColorStop(0,'#3d9be0'); wg.addColorStop(0.5,'#7fd4ff'); wg.addColorStop(1,'#3d9be0');
    ctx.fillStyle = wg;
    rr(tx+3*S, ty+th-3*S-wh, tw-6*S, wh, 4*S); ctx.fill();
    // hladina
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(tx+3*S, ty+th-3*S-wh, tw-6*S, 2*S);
  }
  // obrys skla — při docházející vodě bliká červeně
  const low = frac < 0.25 && Math.sin(ribbonTime*9) > 0;
  ctx.strokeStyle = low ? 'rgba(255,90,90,0.95)' : 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2.5*S;
  rr(tx,ty,tw,th,8*S); ctx.stroke();
  // zlaté objímky (ladí s prstenci děla)
  ctx.fillStyle = '#e8a33a';
  ctx.fillRect(tx-3*S, ty+th*0.16, tw+6*S, 5*S);
  ctx.fillRect(tx-3*S, ty+th*0.74, tw+6*S, 5*S);
}

// ---------------------------------------------------------------- kreslená voda
// Stuha proudu: postavena přes živé uzly páteře (od nejnovějšího k nejstaršímu),
// šířka podle hloubky + zúžení ke konci + jemné vlnění. Tři vrstvy = obrys,
// tělo, světlé jádro. Mrtvý uzel řetěz přeruší (mezeru zakryjí kapky).
let ribbonTime = 0;

function ribbonLayer(n, wMul, ox, oy, color){
  for(let i=0;i<n;i++){
    const i0 = Math.max(i-1,0), i1 = Math.min(i+1,n-1);
    const dx = ribX[i1]-ribX[i0], dy = ribY[i1]-ribY[i0];
    const len = Math.hypot(dx,dy) || 1;
    const nx = -dy/len, ny = dx/len, w = ribW[i]*wMul;
    ribLX[i]=ribX[i]+nx*w+ox; ribLY[i]=ribY[i]+ny*w+oy;
    ribRX[i]=ribX[i]-nx*w+ox; ribRY[i]=ribY[i]-ny*w+oy;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ribLX[0], ribLY[0]);
  for(let i=1;i<n;i++) ctx.lineTo(ribLX[i], ribLY[i]);
  for(let i=n-1;i>=0;i--) ctx.lineTo(ribRX[i], ribRY[i]);
  ctx.closePath();
  // kulaté konce
  ctx.moveTo(ribX[0]+ribW[0]*wMul, ribY[0]);
  ctx.arc(ribX[0]+ox, ribY[0]+oy, ribW[0]*wMul, 0, Math.PI*2);
  ctx.moveTo(ribX[n-1]+ribW[n-1]*wMul, ribY[n-1]);
  ctx.arc(ribX[n-1]+ox, ribY[n-1]+oy, ribW[n-1]*wMul, 0, Math.PI*2);
  ctx.fill();
}

function fillRibbon(n){
  if(n<2) return;
  if(rainbowOn()){
    // duhový proud: gradient podél stuhy, posouvá se v čase
    const g = ctx.createLinearGradient(ribX[0], ribY[0], ribX[n-1], ribY[n-1]);
    for(let i=0;i<=6;i++){
      g.addColorStop(i/6, 'hsl('+((ribbonTime*220 + i*60) % 360)+',95%,62%)');
    }
    ribbonLayer(n, 1.3, 0, 0, 'rgba(40,20,80,0.7)');
    ribbonLayer(n, 1.0, 0, 0, g);
    ribbonLayer(n, 0.4, -2.2*S, -2.2*S, 'rgba(255,255,255,0.85)');
    return;
  }
  ribbonLayer(n, 1.3, 0, 0, 'rgba(16,58,104,0.85)');   // obrys
  ribbonLayer(n, 1.0, 0, 0, '#3f9be6');                 // tělo
  ribbonLayer(n, 0.45, -2.2*S, -2.2*S, 'rgba(155,217,255,0.9)'); // jádro/lesk
}

function drawJetRibbon(){
  // v duhovém režimu se stuha kreslí dvakrát s rotujícím odsazením = dvě trysky
  if(rainbowOn()){
    const a = ribbonTime*7.5, off = 11*S;
    for(let k=0;k<2;k++){
      ctx.save();
      ctx.translate(Math.cos(a + k*Math.PI)*off, Math.sin(a + k*Math.PI)*off);
      drawJetRibbonPass();
      ctx.restore();
    }
    return;
  }
  drawJetRibbonPass();
}

function drawJetRibbonPass(){
  let n = 0, chainGen = -1;
  for(let k=0;k<SPINE_MAX;k++){
    const nd = spine[(spineHead-1-k+SPINE_MAX)%SPINE_MAX];
    if(nd.alive){
      // hranice generací = konec stuhy; starý proud doletí jako samostatný kus
      if(n>0 && nd.gen!==chainGen){ if(n>=2) fillRibbon(n); n=0; }
      chainGen = nd.gen;
      const s = projS(nd.z);
      ribX[n] = projX(nd.x,s);
      ribY[n] = projY(nd.y,s);
      const taper = 1 - 0.45*(k/SPINE_MAX);
      const pulse = 0.88 + 0.12*Math.sin(ribbonTime*14 + k*0.7);
      ribW[n] = Math.max(1.4, 15*s*S*taper*pulse);
      n++;
    } else {
      if(n>=2) fillRibbon(n);
      n = 0;
    }
  }
  if(n>=2) fillRibbon(n);
}

// kapky: hlavní pass + bílé odlesky na každé čtvrté
function drawDropletsCartoon(){
  // duhové kapky se kreslí po skupinách odstínů (6 průchodů), obyčejné v jednom
  const buckets = rainbowOn() ? 6 : 1;
  for(let b=0;b<buckets;b++){
    ctx.fillStyle = rainbowOn() ? 'hsla('+(b*60+30)+',95%,62%,0.85)' : 'rgba(90,175,235,0.8)';
    ctx.beginPath();
    for(let i=0;i<POOL_HARD_MAX;i++){
      const p = pool[i];
      if(!p.alive) continue;
      if(rainbowOn()){
        const bi = p.hue >= 0 ? ((p.hue/60)|0) % 6 : 0;
        if(bi !== b) continue;
      }
      const s = projS(p.z);
      const base = p.type===1 ? p.size*(p.life/p.maxLife) : p.size;
      const sz = Math.max(0.6, base*s*S);
      const sx = projX(p.x,s), sy = projY(p.y,s);
      ctx.moveTo(sx+sz, sy);
      ctx.arc(sx, sy, sz, 0, Math.PI*2);
    }
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(235,250,255,0.8)';
  ctx.beginPath();
  for(let i=0;i<POOL_HARD_MAX;i+=4){
    const p = pool[i];
    if(!p.alive) continue;
    const s = projS(p.z);
    const base = p.type===1 ? p.size*(p.life/p.maxLife) : p.size;
    const sz = Math.max(0.6, base*s*S)*0.4;
    const sx = projX(p.x,s)-sz*0.9, sy = projY(p.y,s)-sz*0.9;
    ctx.moveTo(sx+sz, sy);
    ctx.arc(sx, sy, sz, 0, Math.PI*2);
  }
  ctx.fill();
}

function drawRings(){
  ctx.strokeStyle = '#bfe6ff';
  for(const r of rings){
    if(!r.alive) continue;
    const k = r.t/r.dur;
    const s = projS(r.z);
    const rad = (26 + 120*k)*s*S;
    ctx.globalAlpha = (1-k)*0.65;
    ctx.lineWidth = Math.max(1, 3.5*S*(1-k));
    ctx.beginPath();
    if(r.mode===1) ctx.ellipse(projX(r.x,s), projY(r.y,s), rad, rad*0.32, 0, 0, Math.PI*2);
    else ctx.arc(projX(r.x,s), projY(r.y,s), rad, 0, Math.PI*2);
    ctx.stroke();
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
  if(STRESS){
    if(WS_PARAMS.get('max'))  tune.maxParticles = +WS_PARAMS.get('max');
    if(WS_PARAMS.get('rate')) tune.emitRate = +WS_PARAMS.get('rate');
    if(WS_PARAMS.get('size')) tune.size = +WS_PARAMS.get('size');
    document.getElementById('perf-hud').hidden = false;
  }
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
  bindSlider('sl-gain','aimGain');
  bindSlider('sl-ramp','jetRampT');
  const slF = document.getElementById('sl-fluid');
  if(slF){
    const out = document.getElementById('sl-fluid-val');
    slF.value = tune.fluidMax; out.textContent = tune.fluidMax;
    slF.addEventListener('input', ()=>{ tune.fluidMax = +slF.value; out.textContent = slF.value;
      if(isPuzzle()) FLUID.reset(tune.fluidMax); });
  }
  const cb = document.getElementById('cb-coll');
  cb.checked = tune.collisions;
  cb.addEventListener('change', ()=>{ tune.collisions = cb.checked; });
  const cba = document.getElementById('cb-add');
  cba.checked = tune.additive;
  cba.addEventListener('change', ()=>{ tune.additive = cba.checked; });
  const cbc = document.getElementById('cb-cartoon');
  cbc.checked = tune.cartoon;
  cbc.addEventListener('change', ()=>{ tune.cartoon = cbc.checked; });
  const cbm = document.getElementById('cb-special');
  cbm.checked = tune.specialMode;
  cbm.addEventListener('change', ()=>{
    tune.specialMode = cbm.checked;
    if(!tune.specialMode){ royalCollected = 0; rainbowT = -1; }
  });
  const cbr = document.getElementById('cb-rel');
  cbr.checked = tune.relativeAim;
  cbr.addEventListener('change', ()=>{ tune.relativeAim = cbr.checked; });
  const cbs = document.getElementById('cb-auto');
  cbs.checked = tune.autoSpray;
  cbs.addEventListener('change', ()=>{
    tune.autoSpray = cbs.checked;
    if(!tune.autoSpray) cannon.spraying = false;   // po vypnutí hned přestat
  });
}

// ---------------------------------------------------------------- smyčka
let lastT = 0, rafId = 0;
function loop(t){
  rafId = requestAnimationFrame(loop);
  if(paused){ lastT = t; return; }
  const dt = Math.min((t-lastT)/1000 || 0, 0.033);
  lastT = t;
  ribbonTime += dt;
  updateCurtain(dt);            // běží i po konci kola (zatahování)
  updateFlyCoins(dt);
  const t0 = performance.now();
  if(running && !over) update(dt);
  draw();
  perfTick(dt, performance.now()-t0);
}

// ---------------------------------------------------------------- kolo
function startRound(){
  score = 0; playTime = 0; timeLeft = ROUND_TIME; over = false;
  water = WATER_MAX; dryT = -1;
  royalCollected = 0; rainbowT = -1;
  ducks = ducks.filter(d=>!d.bonus);
  updateWaterBar();
  if(scoreEl) scoreEl.textContent = '0';
  for(const p of pool) p.alive = false;
  aliveCount = 0;
  for(const f of floaters) f.alive = false;
  for(const nd of spine) nd.alive = false;
  for(const r of rings) r.alive = false;
  for(const f of feathers) f.alive = false;
  for(const f of flyCoins) f.alive = false;
  coinPop = 0;
  resetEntities();
  if(isPuzzle()) PUZZLE.init();
  document.getElementById('overlay').hidden = true;
  // opona se rozhrne; dokud jede, čas neběží a dělo nestříká
  curtain = 0; curtainState = 'opening'; curtainT = 0;
  pendingEndReason = null;
  running = true;
  _safeGamee(()=>gamee.gameStart());
}

function endRound(reason){
  if(over) return;
  over = true;
  cannon.spraying = false;
  _safeGamee(()=>gamee.updateScore(score, playTime, WS_CHECKSUM));
  _safeGamee(()=>gamee.gameOver(undefined, JSON.stringify({score:score}), undefined));
  // nejdřív zatáhnout oponu, overlay se skóre přijde až po ní
  pendingEndReason = reason || 'Konec kola';
  curtainState = 'closing'; curtainT = 0;
}

function showEndOverlay(reason){
  // Chybějící element nesmí shodit zbytek funkce (dřív tu byl crash
  // na overlay-title a overlay se vůbec neukázal).
  const set = (id, txt)=>{ const el = document.getElementById(id); if(el) el.textContent = txt; };
  set('overlay-title', reason || 'Konec kola');
  set('overlay-score', score);
  set('overlay-msg', 'Hráno ' + Math.round(playTime) + ' s');
  const ov = document.getElementById('overlay');
  if(ov) ov.hidden = false;
}

// ---------------------------------------------------------------- init + Gamee lifecycle
function initGame(){
  console.log('[WS] Golden Ducks '+WS_VERSION);
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
