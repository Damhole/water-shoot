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
  // Hloubka nádoby. Zděděná po pouťové střelnici (nejzazší dráha kachniček byla
  // na 900, zadní stěna je na 1000). Čím dál, tím delší oblouk musí voda urazit
  // a tím víc záleží na síle stisku — ale nádoba se perspektivou zmenší.
  let CYL_Z = 780;
  const CYL_BOT  = -560;     // dno nádoby
  const GLASS    = 16;       // tloušťka skla
  // Míra nadhledu: poměr svislé a vodorovné poloosy elips (ústí ramen, podstavec).
  // 0 = čistě zepředu, 0,3 = pohled hodně shora.
  const VIEW     = 0.13;

  // Nádoba ve tvaru U. Levým ramenem se napouští, v pravém stoupá kachnička.
  // Rozměry jsou v lokální soustavě nádoby: x od -HALF do +HALF, y od 0 nahoru.
  //
  // Kanál dole je schválně NIŽŠÍ NEŽ PRŮMĚR kachničky (45 proti 90), takže se
  // do levého ramene nedostane a hádanka zůstane čitelná: lije se vlevo,
  // vyplouvá vpravo.
  const ARM_W    = 110;      // vnitřní šířka ramene
  const ARM_GAP  = 120;      // mezera mezi rameny (šířka středového sloupu)
  const CH_H     = 35;       // výška propojovacího kanálu u dna (půlka kachničky)
  const HALF     = ARM_GAP/2 + ARM_W;             // 170 — vnější poloviční šířka

  // Levé rameno je VYŠŠÍ než pravé, a to z fyzikální nutnosti: spojené nádoby
  // se srovnají k nejnižšímu odtoku, takže hladina nikdy nepřeroste napouštěcí
  // otvor. Kdyby byl otvor ve stejně vysokém rameni, kachnička by neměla jak
  // přelézt svůj okraj (naměřeno: hladina se ustálila a kachnička uvázla).
  // Takhle je otvor nad úrovní pravého okraje a voda kachničku vyplaví ven.
  const ARM_H_L  = 620;      // výška levého (napouštěcího) ramene
  const ARM_H_R  = 430;      // výška pravého ramene, odkud kachnička vylézá
  const CYL_H    = ARM_H_L;  // celková výška nádoby

  // Kachnička musí mít v rameni VŮLI. S poloměrem 45 v rameni širokém 110 ho
  // skoro ucpala, voda neměla kudy okolo, přetekla přes ni a přitlačila ji ke
  // dnu — naměřeno: stoupla na 336 a pak spadla na 49 při plné nádobě.
  const DUCK_R   = 35;       // poloměr kachničky jako tělesa
  const DUCK_DENS = 0.25;    // hustota proti vodě (1) — čím níž, tím víc plave
  const DUCK_TILT = 0.5;     // největší náklon kachničky (rad, ~29°)

  const armL = { x0: -HALF,        x1: -ARM_GAP/2, h: ARM_H_L };   // napouštěcí
  const armR = { x0:  ARM_GAP/2,   x1:  HALF,      h: ARM_H_R };   // kachnička

  // Stěny pro solver: seznam úseček. Nová úroveň = jiný seznam, ne jiný kód.
  const WALLS = [
    [armL.x0, ARM_H_L, armL.x0, 0],        // vnější stěna levého ramene
    [armL.x0, 0,       armR.x1, 0],        // dno přes celou šířku
    [armR.x1, 0,       armR.x1, ARM_H_R],  // vnější stěna pravého ramene
    [armL.x1, ARM_H_L, armL.x1, CH_H],     // vnitřní stěna levého ramene
    [armR.x0, ARM_H_R, armR.x0, CH_H],     // vnitřní stěna pravého ramene
    [armL.x1, CH_H,    armR.x0, CH_H],     // strop kanálu
  ];

  const HOLE_R   = 62;       // poloměr napouštěcího otvoru
  const HOLE_DX  = (armL.x0 + armL.x1)/2;   // otvor uprostřed levého ramene
  // Otvor je v levém rameni NAD úrovní pravého okraje — jinak by hladina
  // pravé rameno nikdy nepřeplavila a kachnička by nevylezla.
  const HOLE_Y   = 0.88;     // podíl výšky LEVÉHO ramene

  // Kolik kapaliny přibude za jednu částici proudu. NEDÁVAT natvrdo: cíl se
  // mění s velikostí kapek (plocha na částici roste s druhou mocninou poloměru)
  // a s ním se musí měnit i přítok, jinak je puzzle buď triviální, nebo
  // nesplnitelný.
  // Podíl částic, které při přesném míření projdou otvorem. Dokud byl otvor na
  // horní podstavě, přilétal proud obloukem a trefilo se ~39 %. Do otvoru
  // v přední stěně se míří přímo a projde skoro všechno — se starou hodnotou
  // se válec plnil 3x rychleji, než měl (4 s místo 12).
  const HIT_RATE = 0.95;
  function dropsPerHit(){
    return fullCount() / (tune.emitRate * HIT_RATE * tune.fillSeconds);
  }
  const WIN_LEVEL     = 0.95;    // jak plno musí být, aby kachnička přeplavala okraj
  // Kolik kapek je potřeba na plný válec. Slouží UŽ JEN ke kalibraci přítoku
  // (viz dropsPerHit) — zobrazovaná plnost se měří z hladiny.
  function fullCount(){
    const area = 2*ARM_W*CYL_H + ARM_GAP*CH_H;      // obě ramena + kanál
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
  let duckX = 0, duckY = 0, duckAng = 0;   // poloha kachničky ze simulace
  let leakT = 0;             // doběh efektu vytékání z otvoru
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

  // Malované pozadí z obrázku. Zkouší se několik přípon; když soubor není,
  // scéna se nakreslí kódem jako dosud (radši kreslené pozadí než prázdno).
  let bgImg = null;
  (function loadBgImage(){
    const kandidati = ['./img/bg_puzzle.jpg', './img/bg_puzzle.png', './img/bg_puzzle.webp'];
    let i = 0;
    const zkus = ()=>{
      if(i >= kandidati.length) return;
      const im = new Image();
      im.onload = ()=>{
        bgImg = im;
        console.log('[WS] pozadí puzzlu z ' + im.src.split('/').pop());
        if(typeof W === 'number' && W > 0) prerenderBackground();   // překreslit s obrázkem
      };
      im.onerror = ()=>{ i++; zkus(); };
      im.src = kandidati[i];
    };
    zkus();
  })();

  // Přemalování děla z předlohy. Aktuální obrázek je vyretušovaný ručně, takže
  // je vypnuté (1 = nezasahovat). Kdyby se dal do pozadí jiný, který dělo má,
  // stačí sem dát podíl výšky, od kterého dolů se má přemalovat: pruh těsně nad
  // dělem se roztáhne přes něj dolů, a to ZRCADLOVĚ, aby pixely ve spoji
  // navazovaly (bez zrcadlení je přes celou šířku vidět hrana).
  const BG_CANNON_TOP = 1;       // odkud dolů je v obrázku dělo (podíl výšky)
  const BG_PATCH_SRC  = 0.20;    // jak vysoký pruh se na záplatu bere

  function drawBgImage(g){
    const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
    const sc = Math.max(W/iw, H/ih);
    const dw = iw*sc, dh = ih*sc;
    const dx = (W-dw)/2;

    g.drawImage(bgImg, dx, 0, dw, dh);

    if(BG_CANNON_TOP >= 1) return;      // obrázek dělo nemá, není co přemalovat

    // Záplata přes dělo, překlopená vzhůru nohama (viz komentář u konstanty).
    const cut  = ih * BG_CANNON_TOP;
    const srcY = cut - ih*BG_PATCH_SRC;
    const restH = dh - cut*sc;
    g.save();
    g.translate(0, cut*sc);
    g.scale(1, -1);
    g.drawImage(bgImg,
      0, srcY, iw, ih*BG_PATCH_SRC,                 // zdroj: čistý pruh nad dělem
      dx, -restH, dw, restH);                       // cíl: spodek, zrcadlově
    g.restore();
  }

  function prerenderBackground(){
    bg = document.createElement('canvas');
    bg.width = Math.round(W*DPR); bg.height = Math.round(H*DPR);
    const g = bg.getContext('2d');
    g.setTransform(DPR,0,0,DPR,0,0);

    if(bgImg){
      drawBgImage(g);
      FLUID_GL.setBackground(bg);   // vodní vrstva pozadí láme, musí ho znát
      return;
    }

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
  let duckBody = null;
  function resetFluid(){
    FLUID.reset(tune.fluidMax);
    if(FLUID_LF.isAvailable()){
      FLUID_LF.reset(tune.fluidMax, WALLS, tune.dropSize);
      // Kachnička je skutečné plovoucí těleso, ne kresba na změřené hladině.
      // Díky tomu funguje v jakémkoli tvaru nádoby — nové úrovně nepotřebují
      // říkat, kde se má hladina měřit.
      duckBody = FLUID_LF.addFloater((armR.x0+armR.x1)/2, DUCK_R + 6, DUCK_R, DUCK_DENS,
        { comDrop: DUCK_R*0.6,     // těžiště pod středem → sama se narovná
          maxAngle: DUCK_TILT,     // dál se nenakloní, na záda se nepřetočí
          upright: 10 });
    }
  }

  function init(){
    CYL_Z = tune.objZ || 780;
    fill = 0; tilt = 0; tiltV = 0; bob = 0; dropAcc = 0;
    state = 'play'; escT = 0; spillT = 0; duckX = 0; duckY = 0; duckAng = 0; leakT = 0;
    resetFluid();
    prerenderBackground();
  }

  // ---------------------------------------------------------------- pomocné
  function holeWorldX(){ return HOLE_DX; }              // střed otvoru (vodorovně)
  function holeWorldY(){ return CYL_BOT + CYL_H*HOLE_Y; }  // střed otvoru (svisle)
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
    F().step(dt, { halfW: HALF, top: CYL_H,
                   gx: Math.sin(tilt)*G, gy: -Math.cos(tilt)*G });

    // Únik otvorem. Otvor je v PŘEDNÍ stěně, kterou 2D simulace nezná, takže
    // vytékání nevznikne z kolizí — částice v kruhu otvoru se odeberou a místo
    // nich se pustí viditelné kapky padající před sklem.
    if(F() === FLUID_LF && state === 'play'){
      const unik = FLUID_LF.destroyIn(HOLE_DX, CYL_H*HOLE_Y, HOLE_R*0.72);
      if(unik > 0){
        leakT = 0.25;
        if(Math.random() < 0.5)
          splashAt(HOLE_DX, CYL_BOT + CYL_H*HOLE_Y, CYL_Z - HALF, 1, 1);
      }
    }
    if(leakT > 0) leakT -= dt;
    // Plnost se MĚŘÍ z hladiny, nepočítá z počtu částic: kapalina se pod
    // vlastní vahou stlačuje (naměřeno 1,44 × r² na kapku u mělké vody proti
    // 1,04 × r² u hluboké), takže žádný pevný přepočet nesedí v celém rozsahu.
    // Plnost se měří v PRAVÉM rameni — tam stoupá kachnička a o to jde.
    // Měřit celou nádobu najednou nelze, hladina by vyšla mezi rameny.
    fill = clamp(F().surfaceY(armR.x0, armR.x1) / ARM_H_R, 0, 1);

    // Kachnička je těleso, takže její výšku nepočítáme — čteme ji ze simulace.
    const dpos = duckBody ? FLUID_LF.floaterPos(duckBody) : null;
    if(dpos){ duckX = dpos.x; duckY = dpos.y; duckAng = dpos.angle; }

    // Vyhráno, až kachnička vyleze nad okraj svého ramene.
    // vyhráno, až kachnička přeleze okraj SVÉHO (pravého) ramene
    if(state === 'play' && dpos && dpos.y > ARM_H_R - DUCK_R*0.2){
      state = 'escape'; escT = 0;
      const s = projS(CYL_Z);
      escX = projX(duckX, s); escY = projY(CYL_BOT + duckY, s);
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
    // Válec zabírá hloubku od přední po zadní stěnu; dřív se testoval jen úzký
    // pás kolem osy, protože se mířilo shora na podstavu.
    if(p.z < CYL_Z - HALF - 40 || p.z > CYL_Z + HALF + 40) return false;

    const topY = CYL_BOT + CYL_H;
    const hx = holeWorldX(), hy = holeWorldY();

    // Trefa do otvoru: kruh v rovině přední stěny. Dřív to byl pás u horního
    // okraje, protože se mířilo shora dolů do podstavy.
    const dxh = p.x - hx, dyh = p.y - hy;
    if(dxh*dxh + dyh*dyh < HOLE_R*HOLE_R){
      // proud se v otvoru mění na kapalinu, která už si teče sama
      dropAcc += dropsPerHit();
      while(dropAcc >= 1){
        dropAcc -= 1;
        // Kapky vtékají POD otvor, ne přesně do něj — v kruhu otvoru je odsává
        // únik a voda by se vůbec nezačala hromadit (naměřeno: drželo se 20 kapek).
        F().spawn(HOLE_DX + rand(-24,24), CYL_H*HOLE_Y - HOLE_R*1.05 + rand(-12,12),
                  rand(-15,15), -60);
      }
      if(Math.random() < 0.12) splashAt(p.x, p.y, CYL_Z, 1, 1);
      return true;
    }

    // trefa do skla → válec se rozkýve
    if(p.y > CYL_BOT && p.y < topY + 40 && Math.abs(p.x) < HALF + GLASS*2){
      tiltAccum += (p.x >= 0 ? 1 : -1) * TILT_PER_HIT;
      if(Math.random() < 0.2) splashAt(p.x, p.y, p.z, 1, 0);
      return true;
    }
    return false;
  }

  // pro raycast míření v game.js — kam až smí voda „odjištěná" letět
  // Kam až má proud doletět. Cílem je PŘEDNÍ stěna válce, ne jeho osa — otvor
  // je v ní a balistika počítá výšku dráhy právě k zadané hloubce. Kdyby se
  // mířilo na osu, dopadala by voda o kus jinam, než ukazuje zaměřovač.
  // Zastaví uzel stuhy? Jen dotaz, žádný vedlejší účinek — přítok vody řeší
  // onParticle. Otvorem se prolétnout MUSÍ, jinak by se proud utnul před ním.
  function blocksSpine(nd){
    if(nd.z < CYL_Z - HALF - 20 || nd.z > CYL_Z + HALF) return false;
    const ly = nd.y - CYL_BOT;
    if(ly < -20 || ly > ARM_H_L + 40) return false;
    if(Math.abs(nd.x) > HALF + GLASS) return false;
    // Otvorem proud projde, ale jen KOUSEK za jeho rovinu — voda se tam mění
    // na kapalinu. Dřív letěl až k zadní stěně nádoby a stuha ho kreslila přes
    // celý vnitřek, takže z otvoru „couhal" ocásek.
    const dxh = nd.x - HOLE_DX, dyh = ly - CYL_H*HOLE_Y;
    if(dxh*dxh + dyh*dyh < HOLE_R*HOLE_R) return nd.z > CYL_Z - HALF + 70;
    return true;
  }

  function aimZ(sx, sy){
    const s = projS(CYL_Z);
    const wx = unprojX(sx, s), wy = unprojY(sy, s);
    if(wy > CYL_BOT - 60 && wy < CYL_BOT + CYL_H + 140 && Math.abs(wx) < HALF + 120)
      return CYL_Z - HALF;
    return WALL_Z;
  }

  function isWon(){ return state === 'done'; }

  // ---------------------------------------------------------------- kresba
  function drawBackground(){ if(bg) ctx.drawImage(bg, 0, 0, W, H); }

  // Obrys vnitřní dutiny ve tvaru U — jedna cesta, kterou používá jak sklo,
  // tak ořez kapaliny. Nová úroveň znamená jiné body, ne jinou kresbu.
  function cavityPath(toX, toY){
    const p = new Path2D();
    p.moveTo(toX(armL.x0), toY(ARM_H_L));
    p.lineTo(toX(armL.x0), toY(0));
    p.lineTo(toX(armR.x1), toY(0));
    p.lineTo(toX(armR.x1), toY(ARM_H_R));
    p.lineTo(toX(armR.x0), toY(ARM_H_R));
    p.lineTo(toX(armR.x0), toY(CH_H));
    p.lineTo(toX(armL.x1), toY(CH_H));
    p.lineTo(toX(armL.x1), toY(ARM_H_L));
    p.closePath();
    return p;
  }

  function drawScene(){
    const s = projS(CYL_Z);
    const scale = s*S;
    const bottomSy = projY(CYL_BOT, s);
    const toX = lx => projX(lx, s);
    const toY = ly => bottomSy - ly*scale;
    const topSy = toY(ARM_H_R);
    const ry = (HALF*scale)*VIEW*0.5;

    ctx.save();
    ctx.translate(toX(0), bottomSy);
    ctx.rotate(tilt*0.35);
    ctx.translate(-toX(0), -bottomSy);

    const cavity = cavityPath(toX, toY);

    // podstavec pod nádobou
    ctx.fillStyle = 'rgba(120,100,70,0.35)';
    ctx.beginPath();
    ctx.ellipse(toX(0), bottomSy + 8*S, HALF*scale*0.9, ry*0.8, 0, 0, Math.PI*2);
    ctx.fill();

    // ---- kapalina, ořezaná tvarem dutiny ----
    if(F().count() > 0){
      const toScreen = (lx, ly) => ({ x: toX(lx), y: toY(ly) });
      ctx.save();
      ctx.clip(cavity);
      const solver = F();
      const glcv = tune.glFluid && FLUID_GL.available()
        ? FLUID_GL.render(W, H, GL_RES, solver.count(),
            p => solver.fillGL(p, toScreen),
            { pointSize: solver.R0 * scale * tune.glPoint,
              gain: tune.glGain, thresh: tune.glThresh,
              tint: tune.glTint, tintMix: tune.glTintMix, white: tune.glWhite,
              capLo: 0.01, capTop: tune.glCap, capBot: tune.glCap * 0.18,
              yTop: 1 - toY(solver.surfaceY(armR.x0, armR.x1)) / H,
              yBot: 1 - bottomSy / H })
        : null;
      if(glcv) ctx.drawImage(glcv, 0, 0, W, H);
      else solver.draw(ctx, toScreen, scale, { R: ARM_W/2, top: CYL_H });
      ctx.restore();
    }

    // ---- kachnička (těleso ze simulace) ----
    if(state === 'play'){
      const sz = 150*scale;
      ctx.save();
      ctx.translate(toX(duckX), toY(duckY));
      ctx.rotate(-duckAng);
      ctx.drawImage(duckSprite, -sz*0.53, -sz*0.62, sz, sz);
      ctx.restore();
    }

    // ---- sklo ----
    const glass = ctx.createLinearGradient(toX(-HALF), 0, toX(HALF), 0);
    glass.addColorStop(0.00,'rgba(255,255,255,0.42)');
    glass.addColorStop(0.16,'rgba(255,255,255,0.10)');
    glass.addColorStop(0.45,'rgba(255,255,255,0.30)');
    glass.addColorStop(0.80,'rgba(255,255,255,0.08)');
    glass.addColorStop(1.00,'rgba(255,255,255,0.42)');

    const hx = toX(HOLE_DX), hy = toY(CYL_H*HOLE_Y), hr = HOLE_R*scale;

    // sklo jako plocha S DÍROU — otvor je skutečný výřez, ne kolečko navrch
    const sklo = new Path2D();
    sklo.addPath(cavity);
    sklo.arc(hx, hy, hr, 0, Math.PI*2);
    ctx.fillStyle = glass;
    ctx.fill(sklo, 'evenodd');

    // obrys nádoby
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3*S;
    ctx.stroke(cavity);

    // ústí ramen (otevřený horní okraj)
    ctx.lineWidth = 2.5*S;
    for(const a of [armL, armR]){
      ctx.beginPath();
      ctx.ellipse((toX(a.x0)+toX(a.x1))/2, toY(a.h), (toX(a.x1)-toX(a.x0))/2, ry*0.6, 0, 0, Math.PI*2);
      ctx.stroke();
    }

    // hrana výřezu: široký poloprůhledný lem (sklo v řezu) + tenká jasná linka
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 7*S;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.5*S;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3*S;
    ctx.beginPath(); ctx.arc(hx, hy, hr*0.82, Math.PI*1.15, Math.PI*1.75); ctx.stroke();

    // pramínek vytékající z otvoru, když hladina dosáhne nad něj
    if(leakT > 0){
      ctx.strokeStyle = 'rgba(180,225,255,0.75)';
      ctx.lineWidth = 5*S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy + hr*0.5);
      ctx.quadraticCurveTo(hx + 6*S, hy + hr*1.6, hx + 2*S, hy + hr*2.6);
      ctx.stroke();
    }

    ctx.restore();

    // uniklá kachnička letí do bazénu
    if(state === 'escape' || state === 'done'){
      const sz = 150*scale * (1 - Math.min(escT/2.2,1)*0.45);
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
    const topSy = projY(CYL_BOT + ARM_H_R, s);
    const bx = projX(HALF, s) + 26*S, bw = 14*S;
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

  return { init, update, onParticle, aimZ, isWon, resetFluid, blocksSpine,
           prerenderBackground, drawBackground, drawScene, drawHud,
           get fill(){ return fill; }, get state(){ return state; },
           get duckY(){ return duckY; }, get duckX(){ return duckX; },
           get duckBody(){ return duckBody; } };
})();
