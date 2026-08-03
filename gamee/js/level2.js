'use strict';
// Golden Ducks — úroveň 2: bourání pyramidy.
//
// Kachnička sedí na vrcholu pyramidy z beden. Proud vody bedny rozbíjí, věž se
// hroutí a kachnička spadne dolů na dlažbu — tím je osvobozená.
//
// Proč bedny mají VÝDRŽ a nespoléhá se jen na hybnost vody: měření v
// _tower_test.html ukázalo, že mezi „proud bedny vystřelí o sto metrů" (lehké
// bedny) a „ani se nehnou" (těžké) je úzká hrana, na které tentýž vstup jednou
// pyramidu složí a podruhé jen zahoupe. Na tom se hra postavit nedá. Voda proto
// bednám ubírá život a zároveň do nich mírně strká; hroucení pak dělá gravitace,
// která je spolehlivá.
//
// Používá projekci a pomocné funkce z game.js, fyziku z fluid_lf.js.

const TOWER = (function(){

  const Z        = 780;      // hloubka scény
  const GROUND   = -560;     // úroveň dlažby (world y)
  const VIEW     = 0.13;     // stejný lehký nadhled jako u nádoby

  const BOX      = 46;       // hrana bedny
  const ROWS     = 4;        // řad pyramidy (dole 4, nahoře 1)
  const BOX_HP   = 100;      // výdrž bedny
  // Kalibrace přes měření: proud vypustí ~400 částic/s a do jedné bedny jich
  // trefí zhruba třetinu. S 1,35 padla bedna za pětinu sekundy (celá pyramida
  // za 2,4 s), s 0,35 nepadla za 31 s ani jedna, protože při přejíždění proud
  // na jedné bedně tak dlouho nevydrží. 0,8 vychází na ~1 s drženého proudu.
  const DMG      = 0.8;      // ubraný život za jednu částici proudu
  const PUSH     = 34;       // impulz od jedné částice (držet nízko, ať to netryská)

  const DUCK_R   = 34;
  const WIN_Y    = 70;       // pod touhle výškou je kachnička dole na dlažbě

  let boxes = [], duck = null;
  let state = 'play';        // 'play' | 'won'
  let bg = null;
  let shakeT = 0;

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
    state = 'play'; shakeT = 0;
    boxes = []; duck = null;
    if(!FLUID_LF.isAvailable()){ prerenderBackground(); return; }

    // Prázdný svět bez kapaliny — voda se tu nehromadí, jen tluče do beden.
    // Podlaha je jediná stěna, kterou pyramida potřebuje.
    FLUID_LF.reset(200, [[-1200, 0, 1200, 0]], tune.dropSize);

    // pyramida: dole ROWS beden, nahoře jedna
    for(let r=0; r<ROWS; r++){
      const n = ROWS - r;
      for(let i=0; i<n; i++){
        const x = (i - (n-1)/2) * (BOX*1.04);
        const y = BOX/2 + r*(BOX*1.02);
        const h = FLUID_LF.addBox(x, y, BOX/2, BOX/2, 4, BOX_HP);
        if(h){ h.rot = 0; boxes.push(h); }
      }
    }
    // kachnička na vrcholu
    duck = FLUID_LF.addFloater(0, ROWS*(BOX*1.02) + DUCK_R, DUCK_R, 1.2,
                               { comDrop: DUCK_R*0.6, maxAngle: 0.6, upright: 8 });
    prerenderBackground();
  }

  // ---------------------------------------------------------------- update
  function update(dt){
    if(!FLUID_LF.isReady()) return;
    FLUID_LF.step(dt, { halfW: 1200, top: 2000, gx: 0, gy: -1400 });
    if(shakeT > 0) shakeT -= dt;

    // Cílem je ZBOURAT PYRAMIDU, ne sundat kachničku. Když se vyhrávalo jejím
    // pádem, dal se level projít za 4 s tím, že ji proud shodil z vrcholu, aniž
    // se rozbila jediná bedna — naměřeno.
    if(state === 'play' && boxes.length === 0) state = 'won';
  }

  // Zásah částicí proudu: ubere život a mírně strčí. Hroucení pak obstará
  // gravitace — spolehlivěji než tlak vody.
  function onParticle(p){
    if(state !== 'play') return false;
    if(Math.abs(p.z - Z) > 120) return false;
    const lx = p.x, ly = p.y - GROUND;          // do lokální soustavy pyramidy
    if(ly < -20 || ly > 2000) return false;

    const h = FLUID_LF.bodyAt(lx, ly);
    if(!h) return false;

    h.hp -= DMG;
    FLUID_LF.pushBody(h, lx, ly, PUSH * (p.vx > 0 ? 1 : (p.vx < 0 ? -1 : 1)) * 0.35, PUSH*0.12);
    if(Math.random() < 0.25) splashAt(p.x, p.y, p.z, 1, 0);

    if(h.hp <= 0){
      FLUID_LF.removeBody(h);
      const i = boxes.indexOf(h);
      if(i >= 0) boxes.splice(i, 1);
      shakeT = 0.18;
      splashAt(p.x, p.y, p.z, 8, 0);
      addFloater(projX(p.x, projS(Z)), projY(p.y, projS(Z)), 'PRASK!');
    }
    return true;
  }

  function aimZ(){ return Z; }
  function isWon(){ return state === 'won'; }

  // ---------------------------------------------------------------- kresba
  // Krychle ve fake 3D: přední stěna, horní zkosená podle nadhledu a boční,
  // jejíž šířka roste se vzdáleností od středu obrazu. Stěny se kreslí v lokální
  // soustavě tělesa, takže při otočení se horní stěna natočí do strany — což je
  // u krychle rotující kolem osy do hloubky fyzikálně správně, ne trik.
  function drawBox(h, s, scale){
    const p = FLUID_LF.floaterPos(h);
    if(!p) return;
    const sx = projX(p.x, s), sy = projY(GROUND + p.y, s);
    const w = h.halfW*scale, ht = h.halfH*scale;
    const top = ht*VIEW*2.2;                       // hloubka horní stěny
    const side = clamp((sx - projX(0, s)) / (W*0.5), -1, 1) * w * 0.5;

    const poskozeni = 1 - h.hp/h.hp0;              // čím míň života, tím tmavší

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-p.angle);

    // boční stěna (odvrácená strana podle polohy na obrazovce)
    if(Math.abs(side) > 1){
      ctx.fillStyle = '#8a5a2b';
      ctx.beginPath();
      const dir = side > 0 ? 1 : -1;
      ctx.moveTo(dir*w, -ht); ctx.lineTo(dir*w + side, -ht - top);
      ctx.lineTo(dir*w + side, ht - top); ctx.lineTo(dir*w, ht);
      ctx.closePath(); ctx.fill();
    }
    // horní stěna
    ctx.fillStyle = '#d9a066';
    ctx.beginPath();
    ctx.moveTo(-w, -ht); ctx.lineTo(-w + side, -ht - top);
    ctx.lineTo(w + side, -ht - top); ctx.lineTo(w, -ht);
    ctx.closePath(); ctx.fill();
    // přední stěna
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, '#c98a4b'); g.addColorStop(0.5, '#b9793c'); g.addColorStop(1, '#a96b32');
    ctx.fillStyle = g;
    ctx.fillRect(-w, -ht, w*2, ht*2);
    // spáry prken
    ctx.strokeStyle = 'rgba(90,55,20,0.35)'; ctx.lineWidth = 1.5*S;
    ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke();
    // poškození: tmavne a praská
    if(poskozeni > 0.05){
      ctx.fillStyle = 'rgba(40,20,5,'+(poskozeni*0.45).toFixed(2)+')';
      ctx.fillRect(-w, -ht, w*2, ht*2);
    }
    ctx.strokeStyle = 'rgba(60,35,10,0.7)'; ctx.lineWidth = 2*S;
    ctx.strokeRect(-w, -ht, w*2, ht*2);
    ctx.restore();
  }

  function drawScene(){
    const s = projS(Z);
    const scale = s*S;

    ctx.save();
    if(shakeT > 0){                                 // otřes při prasknutí bedny
      const k = shakeT/0.18;
      ctx.translate(rand(-3,3)*k*S, rand(-2,2)*k*S);
    }

    // stín pyramidy na dlažbě
    ctx.fillStyle = 'rgba(120,90,50,0.22)';
    ctx.beginPath();
    ctx.ellipse(projX(0, s), projY(GROUND, s) + 6*S, ROWS*BOX*0.62*scale, ROWS*BOX*0.10*scale, 0, 0, Math.PI*2);
    ctx.fill();

    for(const h of boxes) drawBox(h, s, scale);

    if(duck){
      const p = FLUID_LF.floaterPos(duck);
      if(p){
        const sz = 150*scale;
        ctx.save();
        ctx.translate(projX(p.x, s), projY(GROUND + p.y, s));
        ctx.rotate(-p.angle);
        ctx.drawImage(duckSprite, -sz*0.53, -sz*0.62, sz, sz);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawHud(){
    const zbyva = boxes.length;
    ctx.font = '700 '+Math.round(15*S)+'px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3*S;
    const t = 'beden: ' + zbyva;
    ctx.strokeText(t, W - 14*S, H*0.30);
    ctx.fillText(t, W - 14*S, H*0.30);
    ctx.textAlign = 'left';
  }

  return { init, update, onParticle, aimZ, isWon,
           prerenderBackground, drawBackground, drawScene, drawHud,
           resetFluid: init,
           get fill(){ return 0; }, get state(){ return state; } };
})();
