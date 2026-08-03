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

  // Aktivní solver kapaliny: vlastní PBF (fluid.js) nebo LiquidFun (fluid_lf.js).
  // Přepíná se v ⚙ HUD; dokud se wasm nenačte, jede se na vlastním.
  const F = () => (tune.lfFluid && FLUID_LF.isReady()) ? FLUID_LF : FLUID;
  // Kapalina se kreslí v 1 CSS px na pixel — na retině by 2x rozlišení bylo
  // 4x práce a voda je stejně měkká, na ostrosti tu nezáleží.
  const GL_RES = 1;

  // ---- geometrie scény (world souřadnice, viz projekce v game.js) ----
  const CYL_Z    = 780;      // hloubka válce
  const CYL_R    = 150;      // vnitřní poloměr
  const CYL_BOT  = -560;     // dno válce
  const CYL_H    = 500;      // výška válce
  const GLASS    = 16;       // tloušťka skla
  const HOLE_R   = 78;       // poloměr napouštěcího otvoru
  const HOLE_DX  = 92;       // otvor je stranou od osy, ať se musí mířit
  // Míra nadhledu: poměr svislé a vodorovné poloosy elips (dno, okraj, otvor).
  // 0 = čistě zepředu, 0,3 = pohled hodně shora. Držíme se nízko — scéna má být
  // z lehkého nadhledu, ne z ptačí perspektivy.
  const VIEW = 0.13;

  // Kolik kapaliny přibude za jednu částici proudu. NEDÁVAT natvrdo: cíl se
  // mění s velikostí kapek (plocha na částici roste s druhou mocninou poloměru)
  // a s ním se musí měnit i přítok, jinak je puzzle buď triviální, nebo
  // nesplnitelný. Naměřeno: při přesném míření projde otvorem ~39 % částic
  // proudu, zbytek mine nebo trefí sklo.
  const HIT_RATE = 0.39;
  function dropsPerHit(){
    return fullCount() / (tune.emitRate * HIT_RATE * tune.fillSeconds);
  }
  const WIN_LEVEL     = 0.95;    // jak plno musí být, aby kachnička přeplavala okraj
  // Kolik kapek je potřeba na plný válec. Slouží UŽ JEN ke kalibraci přítoku
  // (viz dropsPerHit) — zobrazovaná plnost se měří z hladiny.
  function fullCount(){
    const area = 2*(CYL_R-GLASS) * CYL_H;
    return Math.min(Math.round(area/F().areaPerParticle), F().capacity());
  }
  const TILT_MAX     = 0.30;     // za tímhle náklonem začne voda vyšplíchávat
  const TILT_PER_HIT = 0.02;     // příspěvek jedné kapky do rozhoupání
  const TILT_CAP     = 0.10;     // strop za snímek — bez něj proud válec okamžitě překlopí
  const SPILL_RATE   = 0.16;     // jak rychle uniká při překlonění

  let fill = 0;              // 0..1 hladina uvnitř (odvozená ze skutečné kapaliny)
  let dropAcc = 0;           // zbytkové kapky do dalšího spawnu
  let tilt = 0, tiltV = 0;   // náklon na čepu
  let bob = 0;               // pohupování kachničky
  let duckY = -1;            // vyhlazená výška plavání (hladina sama poskakuje s vlnami)
  let state = 'play';        // 'play' | 'escape' | 'done'
  let escT = 0;              // čas útěku
  let escX = 0, escY = 0;    // pozice kachničky při útěku
  let bg = null;             // prerenderované pozadí
  let spillT = 0;            // odpočet efektu vyšplíchnutí
  let tiltAccum = 0;         // impulzy od kapek za aktuální snímek

  // ---------------------------------------------------------------- pozadí
  // Letní bazén: sytá tyrkysová voda s bílými odlesky, bílý obrubník, teplá
  // krémová podlaha. Barvy podle předlohy — jasné a teplé, žádná šeď.
  const COL = {
    sky:    ['#fefaf2', '#eaf9ff'],
    water:  ['#5ce9f7', '#2ed2ee', '#12b0dc'],
    coping: '#ffffff',
    deck:   ['#fff9ec', '#fdf0d9'],
    grout:  'rgba(214,186,145,0.30)',
    yellow: '#ffd34d',
    orange: '#ff9b4d',
  };

  function prerenderBackground(){
    bg = document.createElement('canvas');
    bg.width = Math.round(W*DPR); bg.height = Math.round(H*DPR);
    const g = bg.getContext('2d');
    g.setTransform(DPR,0,0,DPR,0,0);

    const horizon = H*0.30;          // kde končí bazén a začínají kachlíky
    const edgeH   = 30*S;            // bílý obrubník bazénu

    // Obloha je jen úzký proužek — v předloze vyplňuje záběr bazén, ne nebe.
    const poolTop = H*0.055;
    const sky = g.createLinearGradient(0,0,0,poolTop);
    sky.addColorStop(0, COL.sky[0]); sky.addColorStop(1, COL.sky[1]);
    g.fillStyle = sky; g.fillRect(0,0,W,poolTop);

    // bazén — tyrkysová, nahoře nejsvětlejší
    const pool = g.createLinearGradient(0,poolTop,0,horizon);
    pool.addColorStop(0,   COL.water[0]);
    pool.addColorStop(0.5, COL.water[1]);
    pool.addColorStop(1,   COL.water[2]);
    g.fillStyle = pool; g.fillRect(0,poolTop,W,horizon-poolTop+2);

    // Kaustiky: síť světla na hladině. Kreslí se ve dvou vrstvách — široké
    // slabé pruhy dělají měkkou zář, tenké jasnější jiskření navrch. Jedna
    // vrstva ostrých čar vypadá jako škrábance, ne jako světlo pod vodou.
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for(const layer of [{n:26, w:[10,26], a:[0.05,0.13], amp:[6,16]},
                        {n:30, w:[2,6],   a:[0.16,0.40], amp:[3,9]}]){
      for(let i=0;i<layer.n;i++){
        const y0 = poolTop + Math.random()*(horizon-poolTop);
        const x0 = rand(-60, W);
        const len = rand(90, 300)*S;
        const amp = rand(layer.amp[0], layer.amp[1])*S;
        g.strokeStyle = 'rgba(255,255,255,'+rand(layer.a[0], layer.a[1]).toFixed(2)+')';
        g.lineWidth = rand(layer.w[0], layer.w[1])*S;
        g.beginPath();
        g.moveTo(x0, y0);
        for(let t=1;t<=10;t++){
          const px = x0 + len*t/10;
          g.lineTo(px, y0 + Math.sin(t*0.7 + i)*amp);
        }
        g.stroke();
      }
    }
    g.restore();

    // Barevné akcenty. Patří k dolnímu okraji bazénu a ke krajům — nahoře
    // sedí skóre, čas a mince, tam by se to tlouklo.
    drawRing(g, W*0.14, horizon*0.90, 34*S);
    drawBall(g, W*0.88, horizon*0.84, 20*S);

    // obrubník bazénu — čistě bílý, měkký stín pod ním
    g.fillStyle = COL.coping;
    g.fillRect(0, horizon-edgeH*0.18, W, edgeH*1.25);
    const csh = g.createLinearGradient(0, horizon+edgeH*1.07, 0, horizon+edgeH*1.6);
    csh.addColorStop(0,'rgba(196,166,120,0.28)');
    csh.addColorStop(1,'rgba(196,166,120,0)');
    g.fillStyle = csh; g.fillRect(0, horizon+edgeH*1.07, W, edgeH*0.6);

    // teplá krémová podlaha
    const tile = g.createLinearGradient(0,horizon,0,H);
    tile.addColorStop(0, COL.deck[0]);
    tile.addColorStop(1, COL.deck[1]);
    g.fillStyle = tile; g.fillRect(0,horizon+edgeH,W,H-horizon-edgeH);

    // Spáry podlahy. Sbíhavost držíme malou — scéna je z lehkého nadhledu,
    // takže podlaha nesmí utíkat do dálky jako u pohledu shora.
    g.strokeStyle = COL.grout;
    g.lineWidth = 1.4*S;
    for(let k=-9;k<=9;k++){
      g.beginPath();
      g.moveTo(VPX + k*70*S*0.92, horizon+edgeH);
      g.lineTo(VPX + k*70*S*1.18, H);
      g.stroke();
    }
    // příčné spáry: skoro rovnoměrné, jen mírně se rozestupující
    let y = horizon+edgeH, step = 30*S;
    while(y < H){
      g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.stroke();
      y += step; step *= 1.07;
    }

    // sluneční zář na kachlících pod válcem
    const sun = g.createRadialGradient(W/2, horizon+edgeH+H*0.20, 10, W/2, horizon+edgeH+H*0.20, W*0.7);
    sun.addColorStop(0,'rgba(255,247,225,0.75)');
    sun.addColorStop(1,'rgba(255,247,225,0)');
    g.fillStyle = sun; g.fillRect(0,horizon,W,H-horizon);

    // WebGL vrstva si pozadí drží jako texturu — voda jím prosvítá a láme ho.
    // Je statické, takže stačí nahrát při každém prerenderu (tj. při resize).
    FLUID_GL.setBackground(bg);
  }

  // nafukovací kruh — žluté a bílé čtvrtiny, jako v předloze
  function drawRing(g, cx, cy, r){
    g.save();
    g.translate(cx, cy);
    g.scale(1, 0.42);                       // leží na hladině, tedy zploštělý
    for(let q=0;q<4;q++){
      g.beginPath();
      g.arc(0, 0, r, q*Math.PI/2, (q+1)*Math.PI/2);
      g.arc(0, 0, r*0.52, (q+1)*Math.PI/2, q*Math.PI/2, true);
      g.closePath();
      g.fillStyle = q%2 ? '#ffffff' : COL.yellow;
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 2;
    g.beginPath(); g.arc(0,0,r,0,Math.PI*2); g.stroke();
    g.restore();
  }

  // plážový míč — barevné klíny
  function drawBall(g, cx, cy, r){
    const cols = [COL.orange, '#ffffff', '#4fc9f0', '#ffffff', '#ff7a6b', '#ffffff'];
    g.save();
    g.translate(cx, cy);
    g.scale(1, 0.5);
    for(let i=0;i<6;i++){
      g.beginPath();
      g.moveTo(0,0);
      g.arc(0, 0, r, i*Math.PI/3, (i+1)*Math.PI/3);
      g.closePath();
      g.fillStyle = cols[i];
      g.fill();
    }
    g.restore();
  }

  // ---------------------------------------------------------------- start
  // Reset kapaliny drží geometrii nádoby na jednom místě — LiquidFun si z ní
  // staví stěny, vlastní PBF ji dostává až v každém kroku.
  function resetFluid(){
    FLUID.reset(tune.fluidMax);
    if(FLUID_LF.isAvailable()) FLUID_LF.reset(tune.fluidMax, CYL_R - GLASS, CYL_H, tune.dropSize);
  }

  function init(){
    fill = 0; tilt = 0; tiltV = 0; bob = 0; dropAcc = 0;
    state = 'play'; escT = 0; spillT = 0; duckY = -1;
    resetFluid();
    prerenderBackground();
  }

  // ---------------------------------------------------------------- pomocné
  function holeWorldX(){ return HOLE_DX; }              // střed otvoru
  function waterTopY(){ return CYL_BOT + CYL_H*fill; }  // hladina uvnitř
  function duckWorldY(){
    // kachnička plave na skutečné hladině kapaliny; než voda dosáhne, sedí na dně
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

    // Krok kapaliny. Simuluje se v lokální soustavě nádoby, takže naklonění
    // řešíme otočením gravitace — voda se pak sama nakloní a při velkém úhlu
    // přeteče přes okraj a je nenávratně pryč.
    const G = 1400;
    F().step(dt, { R: CYL_R - GLASS, top: CYL_H,
                     gx: Math.sin(tilt)*G, gy: -Math.cos(tilt)*G });
    // Plnost se MĚŘÍ z hladiny, nepočítá z počtu částic: kapalina se pod
    // vlastní vahou stlačuje (naměřeno 1,44 × r² na kapku u mělké vody proti
    // 1,04 × r² u hluboké), takže žádný pevný přepočet nesedí v celém rozsahu.
    fill = clamp(F().surfaceY() / CYL_H, 0, 1);
    // Kachnička plave na hladině, ale ne na každé vlnce — dojíždí za ní.
    // Nahoru rychleji než dolů: voda ji nadnáší hned, klesá s ubývajícím objemem.
    const targetY = Math.max(70, F().surfaceY() + 46);
    if(duckY < 0) duckY = targetY;
    else duckY += (targetY - duckY) * Math.min(1, dt * (targetY > duckY ? 3.5 : 1.8));

    if(state === 'play' && fill >= WIN_LEVEL){
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
      // proud se v nálevce mění na kapalinu, která už si teče sama
      dropAcc += dropsPerHit();
      while(dropAcc >= 1){
        dropAcc -= 1;
        F().spawn(HOLE_DX + rand(-30,30), CYL_H - 14, rand(-15,15), -60);
      }
      if(Math.random() < 0.12) splashAt(p.x, p.y, CYL_Z, 1, 1);
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
    const ry = rx*VIEW;                 // zploštění elipsy dané nadhledem

    ctx.save();
    ctx.translate(cx, bottomSy);
    ctx.rotate(tilt*0.35);              // náklon na čepu
    ctx.translate(-cx, -bottomSy);

    // čep a podstavec
    ctx.fillStyle = '#8c7a5e';
    ctx.beginPath(); ctx.ellipse(cx, bottomSy + 10*S, rx*0.5, ry*0.6, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#b9a583';
    ctx.fillRect(cx - rx*0.16, bottomSy - 6*S, rx*0.32, 20*S);

    // kapalina uvnitř — každá částice na svém místě, ne plochý obdélník
    if(F().count() > 0){
      const scale = s*S;
      const toScreen = (lx, ly) => ({ x: cx + lx*scale, y: bottomSy - ly*scale });
      ctx.save();
      // Ořez kopíruje SKUTEČNÝ tvar válce i s vykrouženým dnem. S obdélníkem
      // měla voda dole rovnou hranu, zatímco sklo oblouk — a bylo to vidět.
      ctx.beginPath();
      ctx.moveTo(cx-rx, topSy - 40*S);
      ctx.lineTo(cx-rx, bottomSy);
      ctx.ellipse(cx, bottomSy, rx, ry, 0, Math.PI, 0, true);   // přední oblouk dna
      ctx.lineTo(cx+rx, topSy - 40*S);
      ctx.closePath();
      ctx.clip();
      const solver = F();
      const glcv = tune.glFluid && FLUID_GL.available()
        ? FLUID_GL.render(W, H, GL_RES, solver.count(),
            p => solver.fillGL(p, toScreen),
            { pointSize: solver.R0 * scale * tune.glPoint,
              gain: tune.glGain, thresh: tune.glThresh,
              tint: tune.glTint, tintMix: tune.glTintMix, white: tune.glWhite,
              capLo: 0.01, capTop: tune.glCap, capBot: tune.glCap * 0.18,
              // odkud kam se šířka bílé zužuje (v = 1 nahoře plátna)
              yTop: 1 - toScreen(0, solver.surfaceY()).y / H,
              yBot: 1 - bottomSy / H })
        : null;
      if(glcv) ctx.drawImage(glcv, 0, 0, W, H);
      else solver.draw(ctx, toScreen, scale, { R: CYL_R - GLASS, top: CYL_H });
      ctx.restore();
    }

    // kachnička uvnitř (dokud neutekla)
    if(state === 'play'){
      const dy = projY(CYL_BOT + (duckY < 0 ? 70 : duckY), s) + Math.sin(bob)*3*S;
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
    ctx.beginPath(); ctx.ellipse(hx, topSy, hr, hr*VIEW*1.3, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#3a2a12';
    ctx.beginPath(); ctx.ellipse(hx, topSy, hr*0.68, hr*VIEW*0.85, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2*S;
    ctx.beginPath(); ctx.ellipse(hx, topSy, hr, hr*VIEW*1.3, 0, Math.PI*1.1, Math.PI*1.9); ctx.stroke();

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
    ctx.font = '600 '+Math.round(12*S)+'px Arial, sans-serif';
    ctx.fillStyle = 'rgba(37,80,110,0.75)';
    ctx.fillText(F().count()+'/'+F().capacity()+' kapek', bx + bw + 6*S, topSy + 26*S);
    ctx.textBaseline = 'alphabetic';
  }

  return { init, update, onParticle, aimZ, isWon, resetFluid,
           prerenderBackground, drawBackground, drawScene, drawHud,
           get fill(){ return fill; }, get state(){ return state; } };
})();
