'use strict';
// Golden Ducks — úroveň 2: shazování beden z bidla.
//
// Bedny stojí na bidle nad zemí. Dělo je NEROZBÍJÍ — jen do nich strká. Rozbijí
// se samy, až dopadnou na zem. Voda tak není zbraň, ale páka: hráč nehledá, kam
// tlouct, ale kam strčit, aby to spadlo.
//
// Předchozí verze bedny ničila proudem a nešla vyladit: s ubráním 1,35 za zásah
// padla pyramida za 2,4 s, s 0,35 nespadla za 31 s ani jedna bedna. Tenhle návrh
// ten problém celý obchází — o zničení rozhoduje pád, ne kalibrace poškození.
//
// Používá projekci a pomocné funkce z game.js, fyziku z fluid_lf.js.

const TOWER = (function(){

  const Z        = 780;      // hloubka scény
  const GROUND   = -560;     // úroveň dlažby (world y)
  const VIEW     = 0.13;     // stejný lehký nadhled jako u nádoby

  const BOX      = 58;       // hrana bedny
  const BEAM_Y   = 250;      // výška bidla nad zemí
  const BEAM_HW  = 330;      // poloviční délka bidla
  const BEAM_HH  = 17;       // poloviční tloušťka bidla

  // Materiály. Rozdíl dělá HUSTOTA — těžší bedna se při stejném impulzu vody
  // pohne míň, takže shoditelnost vyjde z fyziky a nemusí se nikde zvlášť
  // zařizovat. Kámen je čtyřikrát těžší než dřevo.
  const MAT = {
    drevo: { hustota: 1.3,
             vrch:'#d9a066', bok:'#8a5a2b',
             predek:['#c98a4b','#b9793c','#a96b32'],
             spara:'rgba(90,55,20,0.35)', obrys:'rgba(60,35,10,0.7)' },
    kamen: { hustota: 11,
             vrch:'#cdd2d6', bok:'#6d747b',
             predek:['#b3b9bf','#9ba1a8','#888e95'],
             spara:'rgba(45,52,60,0.30)', obrys:'rgba(48,54,60,0.75)' },
    // Sklo je lehké a křehké — spadne snadno, ale je zavalené zbytkem věže.
    sklo:  { hustota: 0.9, sklenene: true,
             vrch:'rgba(210,245,255,0.55)', bok:'rgba(150,205,230,0.45)',
             predek:['rgba(225,250,255,0.42)','rgba(190,235,250,0.30)','rgba(210,245,255,0.42)'],
             spara:'rgba(255,255,255,0.45)', obrys:'rgba(255,255,255,0.9)' },
  };

  // Impulz od jedné částice. Jediná veličina, která řídí obtížnost — čím míň,
  // tím déle trvá bednu dostrkat přes okraj.
  const PUSH     = 17;

  // Pod touhle výškou se bedna počítá za dopadlou na zem a rozbije se.
  const CRASH_Y  = BOX*0.85;

  // HLOUBKA JAKO PLNOHODNOTNÁ SOUŘADNICE.
  //
  // Box2D počítá boční pohled (x, y) — gravitaci, stohování, otáčení. Hloubku z
  // si vede scéna sama: nemá gravitaci, jen setrvačnost a odpor. Podpory mají
  // hloubkový rozsah, takže „bedna spadla za bidlo" NENÍ prahová podmínka, ale
  // fyzikální důsledek — její z vyjelo z rozsahu bidla, tedy ji nemá co držet.
  //
  // Co takhle nejde: převalení krychle přes hranu do hloubky. Rotace ve 2D má
  // jeden stupeň volnosti, ve 3D tři — to není otázka implementace, ale rozměru.
  const PUSH_Z   = 9;        // přírůstek rychlosti do hloubky za jeden zásah
  const Z_DAMP   = 0.9;      // odpor prostředí v ose z (1/s)
  const Z_MAX    = 320;      // dál bedna neodletí (byla by na obrazovce moc malá)
  const BEAM_ZH  = 100;      // hloubková polovina bidla — co vyjede ven, spadne
  const ROW_Z    = 56;       // rozestup dvou řad beden do hloubky

  let boxes = [], beam = null;
  let letici = [];           // bedny za bidlem — dopad si dopočítají samy
  let volnaKachna = null;    // kachnička po prasknutí skla
  let trisky = [];           // odštěpky odražené od beden
  let state = 'play';        // 'play' | 'won'
  let bg = null;
  let rozbito = 0;

  // ---------------------------------------------------------------- pozadí
  let bgImg = null;
  (function loadBg(){
    const kandidati = ['./img/bg_puzzle.jpg', './img/bg_puzzle.png'];
    let i = 0;
    const zkus = ()=>{
      if(i >= kandidati.length) return;
      const im = new Image();
      im.onload = ()=>{ bgImg = im; if(typeof W === 'number' && W > 0) prerenderBackground(); };
      im.onerror = ()=>{ i++; zkus(); };
      im.src = kandidati[i];
    };
    zkus();
  })();

  function prerenderBackground(){
    bg = document.createElement('canvas');
    bg.width = Math.round(W*DPR); bg.height = Math.round(H*DPR);
    const g = bg.getContext('2d');
    g.setTransform(DPR,0,0,DPR,0,0);
    if(bgImg){
      const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
      const sc = Math.max(W/iw, H/ih);
      g.drawImage(bgImg, (W-iw*sc)/2, 0, iw*sc, ih*sc);
    } else {
      g.fillStyle = '#fdf0d9'; g.fillRect(0,0,W,H);
    }
    FLUID_GL.setBackground(bg);
  }
  function drawBackground(){ if(bg) ctx.drawImage(bg, 0, 0, W, H); }

  // ---------------------------------------------------------------- start
  function init(){
    state = 'play'; rozbito = 0;
    boxes = []; beam = null; letici = []; volnaKachna = null; trisky = [];
    if(!FLUID_LF.isAvailable()){ prerenderBackground(); return; }

    // Podlaha je TLUSTÝ blok, ne úsečka — do tenké hrany rychlá bedna prolétne.
    FLUID_LF.reset(200, null, tune.dropSize);
    FLUID_LF.addBox(0, -60, 1200, 60, 0, 1, { static: true });

    // bidlo, na kterém všechno stojí
    beam = FLUID_LF.addBox(0, BEAM_Y, BEAM_HW, BEAM_HH, 0, 1, { static: true });

    // Bedny stojí ve DVOU HLOUBKOVÝCH ŘADÁCH za sebou. Každá řada je vlastní
    // kolizní vrstva, takže se navzájem neprostupují ani nesrážejí — 2D fyzika
    // o hloubce neví a bez toho by bedna z přední řady stála na zadní.
    //
    // Skladba materiálů dělá hádanku: kamenný základ se nedá odfouknout, takže
    // se musí začít od dřeva nahoře, nebo do kamene tlačit dlouho.
    const y0 = BEAM_Y + BEAM_HH + BOX/2;
    const patra = [
      { n: 6, mat: 'kamen' },
      { n: 5, mat: 'drevo' },
      { n: 4, mat: 'kamen' },
      { n: 3, mat: 'drevo' },
      { n: 2, mat: 'drevo' },
    ];
    for(const rada of [{ layer: 0, z: -ROW_Z }, { layer: 1, z: ROW_Z }]){
      patra.forEach((patro, r) => {
        for(let i=0;i<patro.n;i++){
          const x = (i-(patro.n-1)/2)*(BOX*1.07);
          const y = y0 + r*(BOX*1.03);
          // Doprostřed přední řady jedna SKLENĚNÁ s kachničkou. Je lehká, ale
          // zavalená zbytkem věže — dostat se k ní je smysl celé úrovně.
          const jeSklo = rada.layer === 1 && r === 2 && i === ((patro.n/2)|0);
          const m = jeSklo ? MAT.sklo : MAT[patro.mat];
          const h = FLUID_LF.addBox(x, y, BOX/2, BOX/2, m.hustota, 1, { layer: rada.layer });
          if(h){
            h.z = rada.z; h.vz = 0; h.mat = m;
            if(jeSklo) h.kachnicka = true;
            boxes.push(h);
          }
        }
      });
    }
    prerenderBackground();
  }

  // ---------------------------------------------------------------- update
  function update(dt){
    if(!FLUID_LF.isReady()) return;
    FLUID_LF.step(dt, { halfW: 1200, top: 2000, gx: 0, gy: -1400 });

    // Bedna se rozbije DOPADEM NA ZEM, ne proudem. Nemusí se tedy nic
    // kalibrovat — o zničení rozhoduje to, jestli spadla z bidla.
    for(let i=boxes.length-1; i>=0; i--){
      const h = boxes[i];
      const p = FLUID_LF.floaterPos(h);
      if(!p) { boxes.splice(i,1); continue; }

      // Pohyb v ose z: bez gravitace, jen setrvačnost a odpor prostředí.
      // Dokud bedna stojí sevřená mezi sousedy, drží ji tření — proto se
      // v klidu posouvá jen zlomkem rychlosti.
      if(h.vz){
        const volna = Math.abs(p.vy) > 12 || Math.abs(p.vx) > 12;
        h.z = clamp((h.z || 0) + h.vz * dt * (volna ? 95 : 6), -Z_MAX, Z_MAX);
        h.vz -= h.vz * Math.min(1, Z_DAMP*dt);
      }

      // Vyjela z hloubkového rozsahu bidla → nemá ji co držet. Fyzika je 2D
      // a o tom neví, takže si ji od téhle chvíle vede scéna sama.
      if(Math.abs(h.z || 0) > BEAM_ZH){
        letici.push({ x: p.x, y: p.y, vx: p.vx*0.35, vy: p.vy*0.35,
                      z: h.z, vz: h.vz||0, rot: p.angle, spin: rand(-2.5, 2.5),
                      halfW: h.halfW, halfH: h.halfH, mat: h.mat,
                      kachnicka: !!h.kachnicka });
        FLUID_LF.removeBody(h);
        boxes.splice(i,1);
        continue;
      }

      if(p.y < CRASH_Y){
        const sx = projX(p.x, projS(Z)), sy = projY(GROUND + p.y, projS(Z));
        FLUID_LF.removeBody(h);
        boxes.splice(i,1);
        rozbito++;
        splashAt(p.x, GROUND + p.y, Z + (h.z||0), h.kachnicka ? 22 : 10, 0);
        odstrelTrisky(p.x, p.y, h.z||0, h.mat, h.kachnicka ? 16 : 10, 110);
        addFloater(sx, sy, h.kachnicka ? 'OSVOBOZENA!' : 'PRÁSK!');
        if(h.kachnicka) volnaKachna = { x: p.x, y: BOX*0.5, z: h.z||0, t: 0 };
      }
    }

    // Bedny za bidlem: prostá balistika, dopad na zem je rozbije.
    for(let i=letici.length-1; i>=0; i--){
      const f = letici[i];
      f.vy -= 1400*dt;
      f.x += f.vx*dt; f.y += f.vy*dt;
      f.rot += f.spin*dt;
      f.z = clamp(f.z + f.vz*dt*95, -Z_MAX, Z_MAX);
      f.vz -= f.vz * Math.min(1, Z_DAMP*dt);
      if(f.y <= f.halfH){
        const sd = projS(Z + f.z);
        splashAt(f.x, GROUND + f.halfH, Z + f.z, f.kachnicka ? 22 : 10, 0);
        odstrelTrisky(f.x, f.halfH, f.z, f.mat, f.kachnicka ? 16 : 10, 110);
        addFloater(projX(f.x, sd), projY(GROUND + f.halfH, sd),
                   f.kachnicka ? 'OSVOBOZENA!' : 'PRÁSK!');
        if(f.kachnicka){
          // sklo puklo — kachnička je venku a odplouvá
          volnaKachna = { x: f.x, y: f.halfH, z: f.z, t: 0 };
        }
        letici.splice(i,1);
        rozbito++;
      }
    }

    // osvobozená kachnička poskočí a odpluje
    updateTrisky(dt);

    if(volnaKachna){
      volnaKachna.t += dt;
      volnaKachna.y += Math.max(0, 90 - volnaKachna.t*70) * dt;
      volnaKachna.x += 26*dt;
    }

    if(state === 'play' && boxes.length === 0 && letici.length === 0) state = 'won';
  }

  // Odštěpky z bedny. Nesou barvu svého materiálu, takže z kamene odletí
  // šedé úlomky a ze dřeva třísky — hráč tak vidí, do čeho tluče.
  function odstrelTrisky(x, y, z, mat, n, sila){
    for(let i=0;i<n;i++){
      trisky.push({
        x, y, z,
        vx: rand(-1,1)*sila, vy: rand(0.3,1.4)*sila, vz: rand(-0.4,1.0)*sila*0.5,
        rot: rand(0, 6.28), spin: rand(-9, 9),
        dl: rand(3, 9), sir: rand(1.5, 3.5),
        life: rand(0.5, 1.3), life0: 1,
        barva: mat.predek[1],
      });
    }
  }

  function updateTrisky(dt){
    for(let i=trisky.length-1;i>=0;i--){
      const t = trisky[i];
      t.vy -= 1400*dt;
      t.x += t.vx*dt; t.y += t.vy*dt; t.z += t.vz*dt;
      t.rot += t.spin*dt;
      t.life -= dt;
      if(t.life <= 0 || t.y < -20) trisky.splice(i,1);
    }
  }

  function drawTrisky(){
    for(const t of trisky){
      const sd = projS(Z + t.z);
      const sc = sd*S;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life*2.2);
      ctx.translate(projX(t.x, sd), projY(GROUND + t.y, sd));
      ctx.rotate(t.rot);
      ctx.fillStyle = t.barva;
      ctx.fillRect(-t.dl*sc/2, -t.sir*sc/2, t.dl*sc, t.sir*sc);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Zásah proudem bednu NEPOŠKODÍ, jen do ní strčí. Ničení má na starosti pád.
  function onParticle(p){
    if(state !== 'play') return false;
    if(Math.abs(p.z - Z) > 120) return false;
    const lx = p.x, ly = p.y - GROUND;
    if(ly < -20 || ly > 2000) return false;

    const h = FLUID_LF.bodyAt(lx, ly);
    if(!h) return false;

    // Impulz jde po SKUTEČNÉM směru letu kapky, ne podle toho, na které
    // polovině obrazu bedna stojí. Proud míří vzhůru a od hráče, takže bedny
    // odletí nahoru a dozadu — dřív je umělé „strč doleva/doprava" posílalo
    // jen do stran, což vypadalo ploše.
    const v = Math.hypot(p.vx, p.vy, p.vz) || 1;
    FLUID_LF.pushBody(h, lx, ly, PUSH*(p.vx/v)*0.5, PUSH*(p.vy/v)*0.9);
    h.vz = (h.vz || 0) + PUSH_Z*0.01*Math.max(0.2, p.vz/v);
    if(Math.random() < 0.18) splashAt(p.x, p.y, p.z, 1, 0);
    // občas se z bedny odloupne tříska
    if(Math.random() < 0.05) odstrelTrisky(lx, ly, h.z||0, h.mat, 1, 55);
    return true;
  }

  function aimZ(){ return Z; }
  function isWon(){ return state === 'won'; }

  // ---------------------------------------------------------------- kresba
  // Krychle ve fake 3D: přední stěna, horní zkosená podle nadhledu a boční,
  // jejíž šířka roste se vzdáleností od středu obrazu. Stěny se kreslí v lokální
  // soustavě tělesa, takže při otočení se horní stěna natočí do strany — což je
  // u krychle rotující kolem osy do hloubky fyzikálně správně, ne trik.
  // Krychle ve fake 3D: přední stěna, horní zkosená podle nadhledu a boční,
  // jejíž šířka roste se vzdáleností od středu obrazu. Stěny se kreslí v lokální
  // soustavě tělesa, takže při otočení se horní stěna natočí do strany — což je
  // u krychle rotující kolem osy do hloubky fyzikálně správně, ne trik.
  function kresliKrychli(w, ht, side, m){
    m = m || MAT.drevo;
    const top = ht*VIEW*2.2;
    if(Math.abs(side) > 1){
      ctx.fillStyle = m.bok;
      ctx.beginPath();
      const dir = side > 0 ? 1 : -1;
      ctx.moveTo(dir*w, -ht); ctx.lineTo(dir*w + side, -ht - top);
      ctx.lineTo(dir*w + side, ht - top); ctx.lineTo(dir*w, ht);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = m.vrch;
    ctx.beginPath();
    ctx.moveTo(-w, -ht); ctx.lineTo(-w + side, -ht - top);
    ctx.lineTo(w + side, -ht - top); ctx.lineTo(w, -ht);
    ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, m.predek[0]); g.addColorStop(0.5, m.predek[1]); g.addColorStop(1, m.predek[2]);
    ctx.fillStyle = g;
    ctx.fillRect(-w, -ht, w*2, ht*2);
    ctx.strokeStyle = m.spara; ctx.lineWidth = 1.5*S;
    ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke();
    ctx.strokeStyle = m.obrys; ctx.lineWidth = 2*S;
    ctx.strokeRect(-w, -ht, w*2, ht*2);
  }

  function drawBox(h){
    const p = FLUID_LF.floaterPos(h);
    if(!p) return;
    const s = projS(Z + (h.z || 0));
    const scale = s*S;
    const sx = projX(p.x, s), sy = projY(GROUND + p.y, s);
    const w = h.halfW*scale, ht = h.halfH*scale;
    const side = clamp((sx - projX(0, s)) / (W*0.5), -1, 1) * w * 0.5;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-p.angle);
    kresliKrychli(w, ht, side, h.mat);
    // kachnička uvnitř skleněné bedny
    if(h.kachnicka){
      const sz = ht*1.55;
      ctx.drawImage(duckSprite, -sz*0.53, -sz*0.60, sz, sz);
      // odlesk na skle až přes ni, ať je čitelné, že je zavřená
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.5*S;
      ctx.beginPath();
      ctx.moveTo(-w*0.55, -ht*0.75); ctx.lineTo(-w*0.15, ht*0.7);
      ctx.moveTo(-w*0.15, -ht*0.78); ctx.lineTo(w*0.1, ht*0.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Bedna za bidlem: kreslí se stejně jako ta na fyzice, jen si polohu
  // a otočení nese sama.
  function drawFlying(f){
    const s = projS(Z + f.z);
    const scale = s*S;
    ctx.save();
    ctx.translate(projX(f.x, s), projY(GROUND + f.y, s));
    ctx.rotate(-f.rot);
    kresliKrychli(f.halfW*scale, f.halfH*scale, 0, f.mat);
    if(f.kachnicka){
      const sz = f.halfH*scale*1.55;
      ctx.drawImage(duckSprite, -sz*0.53, -sz*0.60, sz, sz);
    }
    ctx.restore();
  }

  function drawScene(){
    const s = projS(Z);
    const scale = s*S;

    ctx.save();

    // stín na dlažbě
    ctx.fillStyle = 'rgba(120,90,50,0.20)';
    ctx.beginPath();
    ctx.ellipse(projX(0, s), projY(GROUND, s) + 6*S, BEAM_HW*scale, BEAM_HW*0.14*scale, 0, 0, Math.PI*2);
    ctx.fill();

    // stojky bidla
    const beamSy = projY(GROUND + BEAM_Y, s);
    const groundSy = projY(GROUND, s);
    ctx.fillStyle = '#7d5327';
    for(const sx of [-BEAM_HW*0.82, BEAM_HW*0.82]){
      const px = projX(sx, s);
      ctx.fillRect(px - 7*scale, beamSy, 14*scale, groundSy - beamSy);
    }
    // POŘADÍ PODLE HLOUBKY, včetně bidla. Bidlo se dřív kreslilo první, takže
    // bedna odstřelená ZA něj se namalovala přes něj a vypadala, že padá před
    // ním — přesně naopak, než kam letí.
    const zaBidlem = letici.filter(f => f.z > BEAM_ZH).sort((a,b)=> b.z - a.z);
    const predBidlem = letici.filter(f => f.z <= BEAM_ZH).sort((a,b)=> b.z - a.z);
    const naBidle = boxes.slice().sort((a,b)=> (b.z||0) - (a.z||0));

    for(const f of zaBidlem) drawFlying(f);      // nejdřív co je za bidlem
    if(beam) drawBox(beam);                       // pak bidlo
    for(const h of naBidle) drawBox(h);           // pak bedny na něm
    for(const f of predBidlem) drawFlying(f);     // a nakonec co letí před ním
    drawTrisky();

    if(volnaKachna){
      const sd = projS(Z + volnaKachna.z);
      const sz = 150*sd*S;
      ctx.save();
      ctx.translate(projX(volnaKachna.x, sd), projY(GROUND + volnaKachna.y, sd));
      ctx.rotate(Math.sin(volnaKachna.t*4)*0.10);
      ctx.drawImage(duckSprite, -sz*0.53, -sz*0.62, sz, sz);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawHud(){
    const zbyva = boxes.length + letici.length;
    ctx.font = '700 '+Math.round(15*S)+'px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3*S;
    const t = 'shodit: ' + zbyva;
    ctx.strokeText(t, W - 14*S, H*0.30);
    ctx.fillText(t, W - 14*S, H*0.30);
    ctx.textAlign = 'left';
  }

  return { init, update, onParticle, aimZ, isWon,
           prerenderBackground, drawBackground, drawScene, drawHud,
           resetFluid: init,
           get fill(){ return 0; }, get state(){ return state; } };
})();
