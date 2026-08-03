'use strict';
// Golden Ducks — kapalina na LiquidFunu (Box2D particles, wasm).
//
// Náhrada za ručně psaný PBF ve fluid.js. Rozhraní je schválně stejné
// (reset / spawn / step / count / capacity / surfaceY / R0), takže puzzle.js
// nemusí vědět, který solver zrovna počítá — přepíná se v ⚙ HUD.
//
// Proč: náměr na stejném Macu vyšel ~7,3 µs na částici a krok u našeho PBF
// proti ~0,17 µs u LiquidFunu. Za stejný rozpočet snímku tedy uneseme řádově
// víc částic, a právě počet částic dělá rozdíl mezi „kuličkami" a vodou.
//
// Souřadnice: puzzle počítá v lokální soustavě nádoby v pixelech (x od -R do R,
// y od 0 nahoru). Box2D chce metry řádu jednotek, takže se dělí PPM.

const FLUID_LF = (function(){

  const PPM = 100;            // pixelů na metr
  const MAX_DEFAULT = 3000;
  const DROP_DEFAULT = 5;     // poloměr kapky v pixelech (laditelné v HUD)
  let RADIUS = DROP_DEFAULT/PPM;
  // Plocha na částici v USAZENÉ vodě. Měřeno přímo ve válci: kapalina se pod
  // vlastní vahou stlačuje, takže hodnota klesá s hloubkou — 1,44·r² u mělké
  // vody, 0,69·r² u plného válce. Bereme hodnotu pro plný válec, protože podle
  // ní se kalibruje napouštění po okraj. (Původních 2,28·r² pocházelo z mřížky,
  // ve které se částice rodí — ta je řidší než rovnováha.)
  function areaPer(){ const r = RADIUS*PPM; return 0.69 * r * r; }
  // Nejřidší (nestlačené) balení — mělká voda. Slouží jako horní odhad hladiny.
  function areaPerLoose(){ const r = RADIUS*PPM; return 1.44 * r * r; }

  let B = null;               // wasm modul
  let ready = false, failed = false;
  let world = null, ps = null, ground = null;
  let maxCount = MAX_DEFAULT;
  let curR = 0, curTop = 0;   // geometrie nádoby, pro kterou stojí stěny
  let tmpDef = null, tmpVec = null;
  let posView = null, posPtr = 0;   // pohled do wasm paměti s pozicemi

  // Načtení je asynchronní; než doběhne, hra jede na starém solveru.
  function load(){
    if(B || failed) return;
    if(typeof Box2D !== 'function'){ failed = true; return; }
    Box2D().then(mod => {
      B = mod;
      tmpDef = new B.b2ParticleDef();
      tmpVec = new B.b2Vec2(0, 0);
      console.log('[WS] LiquidFun načten');
    }).catch(e => { failed = true; console.warn('[WS] LiquidFun se nenačetl', e); });
  }

  function isReady(){ return ready; }
  function isAvailable(){ return !!B; }

  // Stěny nádoby: dno + dvě svislé stěny. Nakloněná nádoba se — stejně jako
  // u vlastního solveru — řeší otočením gravitace, ne přestavbou geometrie.
  function buildContainer(R, top){
    if(!ground) ground = world.CreateBody(new B.b2BodyDef());
    else {
      let f = ground.GetFixtureList();
      while(f && B.getPointer(f) !== 0){ const nx = f.GetNext(); ground.DestroyFixture(f); f = nx; }
    }
    const r = R/PPM, t = top/PPM;
    const sh = new B.b2EdgeShape();
    const edge = (x1,y1,x2,y2)=>{ sh.SetTwoSided(new B.b2Vec2(x1,y1), new B.b2Vec2(x2,y2)); ground.CreateFixture(sh, 0); };
    edge(-r, 0, r, 0);          // dno
    edge(-r, 0, -r, t*1.4);     // stěny vedeme výš než okraj, ať voda neuteče bokem
    edge( r, 0,  r, t*1.4);
    curR = R; curTop = top;
  }

  function reset(cap, R, top, dropPx){
    if(!B){ load(); return; }
    maxCount = cap || MAX_DEFAULT;
    RADIUS = (dropPx || DROP_DEFAULT)/PPM;
    if(world) { world.__destroy__(); world = null; ground = null; }
    world = new B.b2World(new B.b2Vec2(0, -10));

    const psd = new B.b2ParticleSystemDef();
    psd.radius = RADIUS;
    psd.dampingStrength = 0.35;      // bez tlumení se hladina dlouho vlní
    psd.viscousStrength = 0.35;      // hustší voda drží tvar a míň se tříští
    psd.surfaceTensionPressureStrength = 0.2;
    psd.surfaceTensionNormalStrength = 0.2;
    ps = world.CreateParticleSystem(psd);
    ps.SetMaxParticleCount(maxCount);

    posPtr = 0; posView = null;
    buildContainer(R || 134, top || 500);
    ready = true;
  }

  function count(){ return ready ? ps.GetParticleCount() : 0; }
  function capacity(){ return maxCount; }

  function spawn(x, y, ivx, ivy){
    if(!ready || ps.GetParticleCount() >= maxCount) return false;
    tmpDef.flags = B.b2_waterParticle | B.b2_tensileParticle;
    tmpVec.set_x(x/PPM); tmpVec.set_y(y/PPM);
    tmpDef.position = tmpVec;
    tmpVec.set_x((ivx||0)/PPM); tmpVec.set_y((ivy||0)/PPM);
    tmpDef.velocity = tmpVec;
    ps.CreateParticle(tmpDef);
    return true;
  }

  // Pohled do wasm paměti se musí obnovit, když paměť poroste (buffer se odpojí).
  function positions(){
    if(!ready) return null;
    const n = ps.GetParticleCount();
    if(n === 0) return null;
    const ptr = B.getPointer(ps.GetPositionBuffer());
    if(ptr !== posPtr || !posView || posView.buffer !== B.HEAPF32.buffer || posView.length < n*2){
      posPtr = ptr;
      posView = new Float32Array(B.HEAPF32.buffer, ptr, maxCount*2);
    }
    return posView;
  }

  function velocities(){
    const n = ps.GetParticleCount();
    if(n === 0) return null;
    return new Float32Array(B.HEAPF32.buffer, B.getPointer(ps.GetVelocityBuffer()), n*2);
  }

  function step(dtFull, container){
    if(!ready) return;
    if(container.R !== curR || container.top !== curTop) buildContainer(container.R, container.top);
    const dt = Math.min(dtFull, 1/50);
    // Culling PŘED krokem: DestroyParticle jen označí zombie a uklidí se až
    // v Step(). Když stejné indexy vyhodíme i z našich polí teď, po kroku
    // obě strany zase sedí (LiquidFun odstraňuje stabilně, ověřeno).
    cull(container);
    // gravitace nese náklon nádoby (gx, gy jsou v px/s², převedeme na m/s²)
    world.SetGravity(new B.b2Vec2(container.gx/PPM, container.gy/PPM));
    world.Step(dt, 4, 2);
  }

  // Co přeteče přes okraj nebo propadne pod dno, je nenávratně pryč —
  // jinak by to padalo donekonečna a žralo výkon.
  function cull(container){
    const n = ps.GetParticleCount();
    if(n === 0) return;
    const p = positions();
    if(!p) return;
    const lim = (container.top*1.6)/PPM, side = (container.R*3)/PPM;
    for(let i=n-1;i>=0;i--){
      const x = p[i*2], y = p[i*2+1];
      if(y < -0.5 || y > lim || x < -side || x > side) ps.DestroyParticle(i);
    }
  }

  // Hladina se NEDÁ počítat percentilem výšky částic: padající proud je svislý
  // sloupec od otvoru až dolů, takže percentil skončí uprostřed proudu a hladina
  // vyskočí k okraji nádoby (naměřeno: 502 px místo 75 px). Hladina je místo,
  // kde voda přestane být souvislá — hledá se tedy zdola histogramem výšek.
  function surfaceFromHistogram(getY, n, R, areaPerP, areaPerLoose){
    if(n === 0 || !R) return 0;
    const BIN = 8;                                  // px
    const bins = 90;
    const hist = new Int32Array(bins);
    for(let i=0;i<n;i++){
      const b = (getY(i)/BIN)|0;
      if(b >= 0 && b < bins) hist[b]++;
    }
    const full = (BIN * 2*R) / areaPerP;            // kolik částic má plná vrstva
    const MIN = full * 0.25;                        // proud dá na vrstvu jednotky procent
    let top = 0;
    for(let b=0;b<bins;b++){
      if(hist[b] >= MIN) top = b + 1;
      else if(top > 0) break;                       // první prázdno nad vodou = hladina
    }
    if(top === 0) return 0;
    // dopočet uvnitř poslední vrstvy, ať hladina stoupá plynule a neskáče po 8 px
    const rest = top < bins ? Math.min(1, hist[top]/full) : 0;
    const h = (top + rest) * BIN;
    // Strop z objemu: víc vody, než kolik jí ve válci je, hladina mít nemůže.
    // Chytá první vteřinu, kdy se u otvoru drží shluk čerstvých kapek a ještě
    // není co zaplavit. MUSÍ počítat s NEJŘIDŠÍM balením — je to horní odhad.
    // (Když jsem sem dal hodnotu pro stlačenou vodu, strop usekával skutečnou
    // hladinu u částečně plné nádoby a ukazatel hlásil míň, než ve válci bylo.)
    const byVolume = (n * areaPerLoose) / (2*R) * 1.15;
    return Math.min(h, byVolume);
  }

  function surfaceY(){
    const n = count();
    if(n === 0) return 0;
    const p = positions();
    if(!p) return 0;
    return surfaceFromHistogram(i => p[i*2+1]*PPM, n, curR, areaPer(), areaPerLoose());
  }

  // Souřadnice (v pixelech lokální soustavy) a rozvíření pro WebGL vrstvu.
  function fillGL(outPos, toScreen){
    const n = count();
    if(n === 0) return 0;
    const p = positions();
    if(!p) return 0;
    for(let i=0;i<n;i++){
      const s = toScreen(p[i*2]*PPM, p[i*2+1]*PPM);
      outPos[i*2] = s.x; outPos[i*2+1] = s.y;
    }
    return n;
  }

  // Dočasné kreslení: prosté kruhy. Slouží jen k ověření fyziky — pořádný
  // vzhled (metaball, pěna, refrakce) dělá až WebGL vrstva ve fluid_gl.js.
  function draw(g, toScreen, scale){
    const n = count();
    if(n === 0) return;
    const p = positions();
    if(!p) return;
    const r = Math.max(1, RADIUS*PPM*scale*1.15);
    g.fillStyle = 'rgba(96,180,240,0.95)';
    for(let i=0;i<n;i++){
      const s = toScreen(p[i*2]*PPM, p[i*2+1]*PPM);
      g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI*2); g.fill();
    }
  }

  return { load, isReady, isAvailable, reset, spawn, step, count, capacity,
           surfaceY, positions, velocities, draw, fillGL,
           get R0(){ return RADIUS*PPM; }, get PPM(){ return PPM; },
           get areaPerParticle(){ return areaPer(); } };
})();
