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
  const RADIUS = 0.05;        // poloměr částice v metrech (5 px)
  const MAX_DEFAULT = 3000;
  // Naměřeno na testu: 1015 částic o poloměru 0,06 m zaplnilo 8,32 m²,
  // tedy ~2,28·R² na částici. Z toho puzzle počítá, kdy je válec plný.
  const AREA_PER = 2.28 * (RADIUS*PPM) * (RADIUS*PPM);

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

  function reset(cap, R, top){
    if(!B){ load(); return; }
    maxCount = cap || MAX_DEFAULT;
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

  function step(dtFull, container){
    if(!ready) return;
    if(container.R !== curR || container.top !== curTop) buildContainer(container.R, container.top);
    // gravitace nese náklon nádoby (gx, gy jsou v px/s², převedeme na m/s²)
    world.SetGravity(new B.b2Vec2(container.gx/PPM, container.gy/PPM));
    world.Step(Math.min(dtFull, 1/50), 4, 2);
    cull(container);
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

  // Hladina = výška, pod kterou je většina částic. Bere se percentil, aby
  // jedna vystřelená kapka nedělala hladinu o metr výš.
  function surfaceY(){
    const n = count();
    if(n === 0) return 0;
    const p = positions();
    if(!p) return 0;
    let hi = 0;
    const skip = Math.max(1, (n*0.02)|0);   // horní 2 % ignorujeme
    // levné přiblížení percentilu: hledáme maximum mimo nejvyšší skupinku
    const tops = [];
    for(let i=0;i<n;i++){
      const y = p[i*2+1];
      if(y > hi){ hi = y; }
      if(tops.length < skip){ tops.push(y); tops.sort((a,b)=>a-b); }
      else if(y > tops[0]){ tops[0] = y; tops.sort((a,b)=>a-b); }
    }
    return (tops.length ? tops[0] : hi) * PPM;
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
           surfaceY, positions, draw,
           get R0(){ return RADIUS*PPM; }, get PPM(){ return PPM; },
           get areaPerParticle(){ return AREA_PER; } };
})();
