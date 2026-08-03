'use strict';
// Golden Ducks — puzzle mód (hotelový bazén).
//
// Level 1: skleněný válec na čepu, na dně uvězněná kachnička. Nahoře je otvor
// určený k napouštění. Hráč do něj musí trefit proud vody; hladina uvnitř
// stoupá a kachnička s ní vyplave až ven, kde je osvobozená a odpluje.
//
// Válec stojí na čepu, takže zásahy mimo otvor s ním kývou — a když se nakloní
// moc, voda z něj vyšplíchne. Nepřesná hra tedy stojí postup.
//
// Používá projekci, částice a pomocné funkce z game.js (klasické skripty sdílí
// globální scope, takže se sem dostanou za běhu).

const PUZZLE = (function(){

  // ---- geometrie scény (world souřadnice, viz projekce v game.js) ----
  const CYL_Z    = 780;      // hloubka válce
  const CYL_R    = 150;      // vnitřní poloměr
  const CYL_BOT  = -560;     // dno válce
  const CYL_H    = 500;      // výška válce
  const GLASS    = 16;       // tloušťka skla
  const HOLE_R   = 78;       // poloměr napouštěcího otvoru
  const HOLE_DX  = 92;       // otvor je stranou od osy, ať se musí mířit

  const FILL_PER_HIT = 0.00026;  // kolik hladiny přidá jedna kapka (~10 s přesného míření)
  const TILT_MAX     = 0.30;     // za tímhle náklonem začne voda vyšplíchávat
  const TILT_PER_HIT = 0.02;     // příspěvek jedné kapky do rozhoupání
  const TILT_CAP     = 0.10;     // strop za snímek — bez něj proud válec okamžitě překlopí
  const SPILL_RATE   = 0.16;     // jak rychle uniká při překlonění

  let fill = 0;              // 0..1 hladina uvnitř
  let tilt = 0, tiltV = 0;   // náklon na čepu
  let bob = 0;               // pohupování kachničky
  let state = 'play';        // 'play' | 'escape' | 'done'
  let escT = 0;              // čas útěku
  let escX = 0, escY = 0;    // pozice kachničky při útěku
  let bg = null;             // prerenderované pozadí
  let spillT = 0;            // odpočet efektu vyšplíchnutí
  let tiltAccum = 0;         // impulzy od kapek za aktuální snímek

  // ---------------------------------------------------------------- pozadí
  // Hotelový bazén: rozostřená modrá voda vzadu, bělavé kachlíky vepředu.
  function prerenderBackground(){
    bg = document.createElement('canvas');
    bg.width = Math.round(W*DPR); bg.height = Math.round(H*DPR);
    const g = bg.getContext('2d');
    g.setTransform(DPR,0,0,DPR,0,0);

    const horizon = H*0.30;          // kde končí bazén a začínají kachlíky
    const edgeH   = 26*S;            // bílý obrubník bazénu

    // obloha / okolí nad bazénem
    const sky = g.createLinearGradient(0,0,0,horizon*0.55);
    sky.addColorStop(0,'#bfe9ff'); sky.addColorStop(1,'#e8f7ff');
    g.fillStyle = sky; g.fillRect(0,0,W,horizon*0.55);

    // bazén — sytá modrá, nahoře světlejší
    const pool = g.createLinearGradient(0,horizon*0.5,0,horizon);
    pool.addColorStop(0,'#3fc0f0');
    pool.addColorStop(0.55,'#159fdc');
    pool.addColorStop(1,'#0d7fbe');
    g.fillStyle = pool; g.fillRect(0,horizon*0.5,W,horizon-horizon*0.5+2);

    // rozostřené odlesky na hladině (dojem blurru bez skutečného filtru)
    g.save();
    g.globalAlpha = 0.5;
    for(let i=0;i<26;i++){
      const y = horizon*0.55 + Math.random()*(horizon*0.45);
      const w = rand(30, 130)*S, h = rand(2.5, 7)*S;
      g.fillStyle = 'rgba(255,255,255,'+rand(0.12,0.5).toFixed(2)+')';
      g.beginPath();
      g.ellipse(rand(0,W), y, w, h, 0, 0, Math.PI*2);
      g.fill();
    }
    g.restore();

    // obrubník bazénu
    const cop = g.createLinearGradient(0,horizon-edgeH*0.2,0,horizon+edgeH);
    cop.addColorStop(0,'#ffffff'); cop.addColorStop(1,'#dfd6c6');
    g.fillStyle = cop; g.fillRect(0,horizon-edgeH*0.2,W,edgeH*1.2);

    // kachlíková podlaha v perspektivě
    const tile = g.createLinearGradient(0,horizon,0,H);
    tile.addColorStop(0,'#f6f0e4');
    tile.addColorStop(0.5,'#efe6d5');
    tile.addColorStop(1,'#e3d7c2');
    g.fillStyle = tile; g.fillRect(0,horizon+edgeH,W,H-horizon-edgeH);

    // spáry: podélné sbíhající se k úběžníku
    g.strokeStyle = 'rgba(150,132,104,0.35)';
    g.lineWidth = 1.6*S;
    for(let k=-7;k<=7;k++){
      g.beginPath();
      g.moveTo(VPX + k*70*S*0.45, horizon+edgeH);
      g.lineTo(VPX + k*70*S*2.6, H);
      g.stroke();
    }
    // spáry: příčné, s rostoucím rozestupem směrem k divákovi
    let y = horizon+edgeH, step = 10*S;
    while(y < H){
      g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.stroke();
      y += step; step *= 1.28;
    }

    // sluneční zář na kachlících pod válcem
    const gl = g.createRadialGradient(W/2, horizon+edgeH+H*0.22, 10, W/2, horizon+edgeH+H*0.22, W*0.6);
    gl.addColorStop(0,'rgba(255,255,255,0.5)');
    gl.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(0,horizon,W,H-horizon);
  }

  // ---------------------------------------------------------------- start
  function init(){
    fill = 0; tilt = 0; tiltV = 0; bob = 0;
    state = 'play'; escT = 0; spillT = 0;
    prerenderBackground();
  }

  // ---------------------------------------------------------------- pomocné
  function holeWorldX(){ return HOLE_DX; }              // střed otvoru
  function waterTopY(){ return CYL_BOT + CYL_H*fill; }  // hladina uvnitř
  function duckWorldY(){
    // kachnička plave na hladině; než voda dosáhne, sedí na dně
    return Math.max(CYL_BOT + 60, waterTopY() + 40);
  }

  // ---------------------------------------------------------------- update
  function update(dt){
    // Náklon na čepu se sám vrací do svislé polohy. Impulzy od kapek se sčítají
    // za snímek a jsou zastropované — proud má stovky částic za sekundu, takže
    // bez limitu by válec převrátil během okamžiku.
    tiltV += clamp(tiltAccum, -TILT_CAP, TILT_CAP);
    tiltAccum = 0;
    tiltV += (-tilt*30 - tiltV*3.4) * dt;
    tilt += tiltV * dt;
    tilt = clamp(tilt, -0.5, 0.5);
    bob += dt*2.2;
    if(spillT > 0) spillT -= dt;

    // překlopený válec vodu ztrácí
    if(state === 'play' && Math.abs(tilt) > TILT_MAX && fill > 0){
      fill = Math.max(0, fill - SPILL_RATE*dt);
      if(spillT <= 0){
        spillT = 0.12;
        const s = projS(CYL_Z);
        const sx = projX(Math.sign(tilt)*CYL_R, s);
        splashAt(Math.sign(tilt)*CYL_R, waterTopY(), CYL_Z, 6, 0);
        addFloater(sx, projY(waterTopY(), s), 'vylévá se!');
      }
    }

    if(state === 'play' && fill >= 1){
      state = 'escape'; escT = 0;
      const s = projS(CYL_Z);
      escX = projX(0, s); escY = projY(CYL_BOT + CYL_H + 40, s);
      addFloater(escX, escY - 40*S, 'OSVOBOZENA!');
    }

    if(state === 'escape'){
      escT += dt;
      // kachnička vyplave z válce a odpluje do bazénu vzadu
      escX += 120*S*dt;
      escY -= 150*S*dt;
      if(escT > 2.2){ state = 'done'; }
    }
  }

  // ---------------------------------------------------------------- zásahy
  // Vrací true, když částice narazila do válce (a tedy se má spotřebovat).
  function onParticle(p){
    if(state !== 'play') return false;
    if(Math.abs(p.z - CYL_Z) > 90) return false;

    const topY = CYL_BOT + CYL_H;
    const hx = holeWorldX();

    // trefa do otvoru → přitéká dovnitř
    if(p.y > topY - 30 && p.y < topY + 90 && Math.abs(p.x - hx) < HOLE_R){
      fill = Math.min(1, fill + FILL_PER_HIT);
      // dopad na hladinu uvnitř
      if(Math.random() < 0.25) splashAt(p.x, waterTopY(), CYL_Z, 1, 1);
      return true;
    }

    // trefa do skla → válec se rozkýve
    if(p.y > CYL_BOT && p.y < topY + 40 && Math.abs(p.x) < CYL_R + GLASS*2){
      tiltAccum += (p.x >= 0 ? 1 : -1) * TILT_PER_HIT;
      if(Math.random() < 0.2) splashAt(p.x, p.y, p.z, 1, 0);
      return true;
    }
    return false;
  }

  // pro raycast míření v game.js — kam až smí voda „odjištěná" letět
  function aimZ(sx, sy){
    const s = projS(CYL_Z);
    const wx = unprojX(sx, s), wy = unprojY(sy, s);
    if(wy > CYL_BOT - 60 && wy < CYL_BOT + CYL_H + 140 && Math.abs(wx) < CYL_R + 120) return CYL_Z;
    return WALL_Z;
  }

  function isWon(){ return state === 'done'; }

  // ---------------------------------------------------------------- kresba
  function drawBackground(){ if(bg) ctx.drawImage(bg, 0, 0, W, H); }

  function drawScene(){
    const s = projS(CYL_Z);
    const cx = projX(0, s);
    const bottomSy = projY(CYL_BOT, s);
    const topSy = projY(CYL_BOT + CYL_H, s);
    const rx = CYL_R*s*S;
    const hgt = bottomSy - topSy;
    const ry = rx*0.26;                 // zploštění elipsy dané nadhledem

    ctx.save();
    ctx.translate(cx, bottomSy);
    ctx.rotate(tilt*0.35);              // náklon na čepu
    ctx.translate(-cx, -bottomSy);

    // čep a podstavec
    ctx.fillStyle = '#8c7a5e';
    ctx.beginPath(); ctx.ellipse(cx, bottomSy + 10*S, rx*0.5, ry*0.6, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#b9a583';
    ctx.fillRect(cx - rx*0.16, bottomSy - 6*S, rx*0.32, 20*S);

    // voda uvnitř
    const wTop = bottomSy - hgt*fill;
    if(fill > 0.005){
      const wg = ctx.createLinearGradient(cx-rx, 0, cx+rx, 0);
      wg.addColorStop(0,'#1c86c8'); wg.addColorStop(0.45,'#5cc8f2'); wg.addColorStop(1,'#1c86c8');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.moveTo(cx-rx, wTop);
      ctx.lineTo(cx-rx, bottomSy);
      ctx.ellipse(cx, bottomSy, rx, ry, 0, Math.PI, 0, true);
      ctx.lineTo(cx+rx, wTop);
      ctx.closePath(); ctx.fill();
      // hladina
      ctx.fillStyle = 'rgba(190,240,255,0.9)';
      ctx.beginPath(); ctx.ellipse(cx, wTop, rx, ry, 0, 0, Math.PI*2); ctx.fill();
    }

    // kachnička uvnitř (dokud neutekla)
    if(state === 'play'){
      const dy = projY(duckWorldY(), s) + Math.sin(bob)*3*S;
      const sz = 150*s*S;
      ctx.drawImage(duckSprite, cx - sz*0.53, dy - sz*0.75, sz, sz);
    }

    // sklo válce
    const glass = ctx.createLinearGradient(cx-rx, 0, cx+rx, 0);
    glass.addColorStop(0.00,'rgba(255,255,255,0.42)');
    glass.addColorStop(0.16,'rgba(255,255,255,0.10)');
    glass.addColorStop(0.45,'rgba(255,255,255,0.30)');
    glass.addColorStop(0.80,'rgba(255,255,255,0.08)');
    glass.addColorStop(1.00,'rgba(255,255,255,0.42)');
    ctx.fillStyle = glass;
    ctx.fillRect(cx-rx, topSy, rx*2, hgt);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3*S;
    ctx.beginPath(); ctx.moveTo(cx-rx, topSy); ctx.lineTo(cx-rx, bottomSy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+rx, topSy); ctx.lineTo(cx+rx, bottomSy); ctx.stroke();
    // dno a horní okraj
    ctx.beginPath(); ctx.ellipse(cx, bottomSy, rx, ry, 0, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, topSy, rx, ry, 0, 0, Math.PI*2); ctx.stroke();

    // napouštěcí otvor — nálevka stranou od osy
    const hx = projX(holeWorldX(), s);
    const hr = HOLE_R*s*S;
    ctx.fillStyle = '#e8a33a';
    ctx.beginPath(); ctx.ellipse(hx, topSy, hr, hr*0.34, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#3a2a12';
    ctx.beginPath(); ctx.ellipse(hx, topSy, hr*0.68, hr*0.22, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2*S;
    ctx.beginPath(); ctx.ellipse(hx, topSy, hr, hr*0.34, 0, Math.PI*1.1, Math.PI*1.9); ctx.stroke();

    ctx.restore();

    // uniklá kachnička letí do bazénu
    if(state === 'escape' || state === 'done'){
      const sz = 150*s*S * (1 - Math.min(escT/2.2,1)*0.45);
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, (escT-1.4)/0.8);
      ctx.translate(escX, escY);
      ctx.rotate(Math.sin(escT*5)*0.12);
      ctx.drawImage(duckSprite, -sz*0.53, -sz*0.75, sz, sz);
      ctx.restore();
    }
  }

  // ukazatel napuštění vedle válce
  function drawHud(){
    const s = projS(CYL_Z);
    const cx = projX(0, s);
    const bottomSy = projY(CYL_BOT, s);
    const topSy = projY(CYL_BOT + CYL_H, s);
    const bx = cx + CYL_R*s*S + 26*S, bw = 14*S;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(bx, topSy, bw, bottomSy-topSy);
    ctx.fillStyle = '#159fdc';
    ctx.fillRect(bx, bottomSy - (bottomSy-topSy)*fill, bw, (bottomSy-topSy)*fill);
    ctx.strokeStyle = 'rgba(60,90,120,0.6)'; ctx.lineWidth = 2*S;
    ctx.strokeRect(bx, topSy, bw, bottomSy-topSy);
    ctx.font = '700 '+Math.round(15*S)+'px Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#25506e';
    ctx.fillText(Math.round(fill*100)+' %', bx + bw + 6*S, topSy + 10*S);
    ctx.textBaseline = 'alphabetic';
  }

  return { init, update, onParticle, aimZ, isWon,
           prerenderBackground, drawBackground, drawScene, drawHud,
           get fill(){ return fill; }, get state(){ return state; } };
})();
