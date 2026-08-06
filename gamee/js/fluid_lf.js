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

  // Stěny nádoby jsou SEZNAM ÚSEČEK v pixelech lokální soustavy, ne „poloměr
  // a výška". Díky tomu může mít nádoba libovolný tvar (U, nálevka, trubka)
  // a nové úrovně jsou data, ne kód. Naklonění se — stejně jako dřív — řeší
  // otočením gravitace, ne přestavbou geometrie.
  let curWalls = null;
  function buildWalls(segments){
    if(!ground) ground = world.CreateBody(new B.b2BodyDef());
    else {
      let f = ground.GetFixtureList();
      while(f && B.getPointer(f) !== 0){ const nx = f.GetNext(); ground.DestroyFixture(f); f = nx; }
    }
    const sh = new B.b2EdgeShape();
    for(const [x1,y1,x2,y2] of segments){
      sh.SetTwoSided(new B.b2Vec2(x1/PPM, y1/PPM), new B.b2Vec2(x2/PPM, y2/PPM));
      ground.CreateFixture(sh, 0);
    }
    curWalls = segments;
  }

  function reset(cap, walls, dropPx){
    if(!B){ load(); return; }
    maxCount = cap || MAX_DEFAULT;
    RADIUS = (dropPx || DROP_DEFAULT)/PPM;
    bodies = [];
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
    if(walls) buildWalls(walls);
    ready = true;
  }

  // ---- plovoucí tělesa (kachnička) ----
  // Hustota pod 1 znamená lehčí než voda, takže těleso vyplave. Tvar je kruh:
  // přesný obrys kachničky by fyzice nic nepřidal a stál by výkon.
  let bodies = [];
  // opts: { comDrop } — o kolik pixelů níž než střed leží těžiště,
  //       { maxAngle } — strop náklonu v radiánech, { upright } — síla vzpřímení
  function addFloater(x, y, rPx, density, opts){
    if(!ready) return null;
    const o = opts || {};
    const bd = new B.b2BodyDef();
    bd.type = 2;                                   // dynamické těleso
    bd.position = new B.b2Vec2(x/PPM, y/PPM);
    bd.angularDamping = o.angularDamping === undefined ? 2.2 : o.angularDamping;
    const body = world.CreateBody(bd);
    const cir = new B.b2CircleShape();
    cir.set_m_radius(rPx/PPM);
    const fd = new B.b2FixtureDef();
    fd.shape = cir;
    fd.density = density === undefined ? 0.35 : density;
    fd.friction = 0.2;
    fd.restitution = 0.05;
    body.CreateFixture(fd);

    // Těžiště NÍŽ než střed tvaru. Vztlak působí zhruba ve středu ponořené
    // části, takže když je hmota níž, vzniká vzpřimovací moment — přesně jako
    // u gumové kachničky, která se sama narovná. Kruh má těžiště ve středu,
    // proto se dosud převracela stejně snadno na obě strany.
    const comDrop = (o.comDrop === undefined ? rPx*0.55 : o.comDrop)/PPM;
    if(comDrop > 0){
      const md = new B.b2MassData();
      body.GetMassData(md);
      md.center = new B.b2Vec2(0, -comDrop);
      body.SetMassData(md);
    }

    const h = { body, r: rPx,
                maxAngle: o.maxAngle === undefined ? 0.55 : o.maxAngle,
                upright:  o.upright  === undefined ? 9 : o.upright };
    bodies.push(h);
    return h;
  }

  // Vzpřimování a strop náklonu. Samotné nízké těžiště pomáhá, ale ve zvířené
  // vodě to nestačí — pružina k nule drží kachničku rozumně vzhůru a tvrdý
  // strop zaručí, že se nikdy nepřetočí na záda.
  function uprightBodies(dt){
    for(const h of bodies){
      // Vzpřimování patří jen plovoucím tělesům. Bedny ho nemají a bez téhle
      // podmínky se jim do momentu dostalo NaN (chybějící konstanty), poloha
      // se rozsypala a přestaly se kreslit.
      if(h.upright === undefined) continue;
      const a = h.body.GetAngle();
      const w = h.body.GetAngularVelocity();
      h.body.ApplyTorque((-a*h.upright - w*1.5) * h.body.GetMass(), true);
      if(a > h.maxAngle || a < -h.maxAngle){
        const cl = a > 0 ? h.maxAngle : -h.maxAngle;
        const p = h.body.GetPosition();
        h.body.SetTransform(p, cl);
        h.body.SetAngularVelocity(w * 0.2);
      }
    }
  }
  // Hranatá bedna do věže. Vrací úchyt se stavem výdrže — bourání se neřídí
  // jen hybností vody (naměřeno: mezi „vystřelí do vesmíru" a „ani se nehne"
  // je hrana, na které tentýž vstup jednou věž složí a podruhé ne).
  function addBox(x, y, halfW, halfH, density, hp, opts){
    if(!ready) return null;
    const o = opts || {};
    const bd = new B.b2BodyDef();
    bd.type = o.static ? 0 : 2;
    // Spojitá detekce kolizí: bez ní rychlá bedna prolétne tenkou podlahou.
    // Naměřeno — první bedna skončila 60 m pod scénou.
    bd.bullet = !o.static;
    // Tlumení: bez něj se zbytková rychlost z řešiče nikdy nevynuluje, bedny
    // neusnou a celý stoh se pomalu plazí do strany (naměřeno ~1,5 px/s).
    bd.linearDamping = o.static ? 0 : 0.6;
    bd.angularDamping = o.static ? 0 : 0.7;
    bd.position = new B.b2Vec2(x/PPM, y/PPM);
    const body = world.CreateBody(bd);
    const box = new B.b2PolygonShape();
    box.SetAsBox(halfW/PPM, halfH/PPM);
    const fd = new B.b2FixtureDef();
    fd.shape = box;
    fd.density = density === undefined ? 4 : density;
    fd.friction = 0.85;
    fd.restitution = 0.0;
    // Hloubkové vrstvy: 2D simulace o hloubce neví, takže dvě bedny stojící
    // za sebou by se srazily, i když je mezi nimi kus prostoru. Každá vrstva
    // proto dostane vlastní bit a sráží se jen sama se sebou a se statickými
    // tělesy (zem, bidlo), která jsou hluboká přes všechny vrstvy.
    if(o.layer !== undefined || o.static){
      const f2 = new B.b2Filter();
      if(o.static){ f2.categoryBits = 0x8000; f2.maskBits = 0xFFFF; }
      else { f2.categoryBits = (1 << o.layer); f2.maskBits = (1 << o.layer) | 0x8000; }
      fd.filter = f2;
    }
    body.CreateFixture(fd);
    const h = { body, halfW, halfH, hp: hp === undefined ? 100 : hp,
                hp0: hp === undefined ? 100 : hp, box: true, alive: true,
                stat: !!o.static };
    bodies.push(h);
    return h;
  }

  function removeBody(h){
    if(!h || !h.alive) return;
    world.DestroyBody(h.body);
    h.alive = false;
    const i = bodies.indexOf(h);
    if(i >= 0) bodies.splice(i, 1);
  }

  // Impulz do tělesa v daném bodě (v pixelech lokální soustavy).
  function pushBody(h, px, py, ix, iy){
    if(!h || !h.alive) return;
    h.body.ApplyLinearImpulse(new B.b2Vec2(ix/PPM, iy/PPM),
                              new B.b2Vec2(px/PPM, py/PPM), true);
  }

  // Které těleso obsahuje daný bod? Slouží k vyhodnocení zásahu proudem.
  function bodyAt(px, py){
    for(const h of bodies){
      if(!h.alive || !h.box || h.stat) continue;
      const p = h.body.GetPosition();
      const a = -h.body.GetAngle();
      const dx = px/PPM - p.get_x(), dy = py/PPM - p.get_y();
      const lx = dx*Math.cos(a) - dy*Math.sin(a);
      const ly = dx*Math.sin(a) + dy*Math.cos(a);
      if(Math.abs(lx) <= h.halfW/PPM && Math.abs(ly) <= h.halfH/PPM) return h;
    }
    return null;
  }

  function bodyList(){ return bodies; }

  function floaterPos(h){
    if(!h || !h.alive && h.alive !== undefined) return null;
    const p = h.body.GetPosition();
    const v = h.body.GetLinearVelocity();
    return { x: p.get_x()*PPM, y: p.get_y()*PPM, angle: h.body.GetAngle(),
             vx: v.get_x()*PPM, vy: v.get_y()*PPM };
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
    // Uplynulý čas se ROZDĚLÍ na kroky pevné délky, neořízne. Ořezáním na 1/50
    // se při 10 snímcích za sekundu svět posunul jen o pětinu skutečného času
    // a voda tekla pětkrát pomaleji — na telefonu to vypadalo jako med.
    // Strop 0,1 s je pojistka proti spirále smrti: po dlouhém zámrzu se
    // nedohání celý výpadek, protože by to způsobilo další zámrz.
    const dt = Math.min(dtFull, 0.1);
    // Culling PŘED krokem: DestroyParticle jen označí zombie a uklidí se až
    // v Step(). Když stejné indexy vyhodíme i z našich polí teď, po kroku
    // obě strany zase sedí (LiquidFun odstraňuje stabilně, ověřeno).
    cull(container);
    // gravitace nese náklon nádoby (gx, gy jsou v px/s², převedeme na m/s²)
    world.SetGravity(new B.b2Vec2(container.gx/PPM, container.gy/PPM));
    // 8/3 místo 4/2: u řetězu dotýkajících se beden se při nízkém počtu
    // iterací hromadí chyba jedním směrem a celá řada se posune do strany
    // (naměřeno 30 px doprava během první vteřiny).
    let zbyva = dt;
    while(zbyva > 1e-4){
      const krok = Math.min(zbyva, 1/60);
      world.Step(krok, 8, 3);
      zbyva -= krok;
    }
    if(bodies.length) uprightBodies(dt);
  }

  // Co přeteče přes okraj nebo propadne pod dno, je nenávratně pryč —
  // jinak by to padalo donekonečna a žralo výkon.
  function cull(container){
    const n = ps.GetParticleCount();
    if(n === 0) return;
    const p = positions();
    if(!p) return;
    const lim = (container.top*1.8)/PPM, side = (container.halfW*2.5)/PPM;
    for(let i=n-1;i>=0;i--){
      const x = p[i*2], y = p[i*2+1];
      if(y < -0.5 || y > lim || x < -side || x > side) ps.DestroyParticle(i);
    }
  }

  // Odebere částice uvnitř kruhu a vrátí, kolik jich bylo. Slouží k úniku
  // otvorem: ten je v PŘEDNÍ stěně, kterou 2D simulace nezná, takže vytékání
  // nevznikne z kolizí a musí se udělat odebráním.
  function destroyIn(cx, cy, r){
    if(!ready) return 0;
    const n = ps.GetParticleCount();
    if(n === 0) return 0;
    const p = positions();
    if(!p) return 0;
    const x0 = cx/PPM, y0 = cy/PPM, rr = (r/PPM)*(r/PPM);
    let odebrano = 0;
    for(let i=n-1;i>=0;i--){
      const dx = p[i*2]-x0, dy = p[i*2+1]-y0;
      if(dx*dx + dy*dy < rr){ ps.DestroyParticle(i); odebrano++; }
    }
    return odebrano;
  }

  // Hladina se NEDÁ počítat percentilem výšky částic: padající proud je svislý
  // sloupec od otvoru až dolů, takže percentil skončí uprostřed proudu a hladina
  // vyskočí k okraji nádoby (naměřeno: 502 px místo 75 px). Hladina je místo,
  // kde voda přestane být souvislá — hledá se tedy zdola histogramem výšek.
  function surfaceFromHistogram(getY, n, width, areaPerP, areaPerLoose){
    if(n === 0 || !width) return 0;
    const BIN = 8;                                  // px
    const bins = 90;
    const hist = new Int32Array(bins);
    for(let i=0;i<n;i++){
      const b = (getY(i)/BIN)|0;
      if(b >= 0 && b < bins) hist[b]++;
    }
    const full = (BIN * width) / areaPerP;          // kolik částic má plná vrstva
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
    const byVolume = (n * areaPerLoose) / width * 1.15;
    return Math.min(h, byVolume);
  }

  // Hladina ve vodorovném výseku x0..x1 (v pixelech lokální soustavy). U tvaru U
  // má každé rameno vlastní hladinu — kdyby se měřila celá nádoba najednou,
  // vyšla by hladina někde mezi rameny, kde žádná voda není.
  function surfaceY(x0, x1){
    const n = count();
    if(n === 0) return 0;
    const p = positions();
    if(!p) return 0;
    if(x0 === undefined){ x0 = -1e6; x1 = 1e6; }
    const width = Math.max(1, x1 - x0);
    // do histogramu jdou jen částice z výseku
    const idx = [];
    for(let i=0;i<n;i++){
      const x = p[i*2]*PPM;
      if(x >= x0 && x <= x1) idx.push(i);
    }
    if(idx.length === 0) return 0;
    return surfaceFromHistogram(k => p[idx[k]*2+1]*PPM, idx.length, width, areaPer(), areaPerLoose());
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
           buildWalls, addFloater, floaterPos, destroyIn,
           addBox, removeBody, pushBody, bodyAt, bodyList,
           get R0(){ return RADIUS*PPM; }, get PPM(){ return PPM; },
           get areaPerParticle(){ return areaPer(); } };
})();
