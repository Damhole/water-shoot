'use strict';
// Golden Ducks — 2D kapalina (Position Based Fluids).
//
// Puzzle se odehrává v jedné rovině, takže stačí 2D simulace: částice na sebe
// působí tlakem, drží hustotu a chovají se jako voda — teče, hromadí se,
// najde si hladinu a při naklonění nádoby vyteče přes okraj.
//
// Počítá se v LOKÁLNÍCH souřadnicích nádoby (x od -R do R, y od 0 nahoru),
// takže naklonění řešíme otočením gravitace, ne přepočtem kolizí. Vykreslení
// pak celou soustavu jen orotuje.
//
// Data jsou v typed arrays a sousedi se hledají mřížkou — bez toho by to bylo
// kvadratické a na mobilu nepoužitelné.

const FLUID = (function(){

  const R0   = 20;             // klidová vzdálenost částic (world jednotky)
  const H    = R0 * 2;         // vyhlazovací poloměr
  const H2   = H*H;
  const ITERS = 3;             // iterace solveru hustoty
  // Relaxace v lambda. POZOR na řád: gradienty vycházejí kolem 1e-3, takže
  // hodnota v jednotkách „stovky" by jmenovatel zcela přebila a tlak by byl
  // nulový — voda by se slehla do kaluže na dně.
  const EPS  = 2e-4;
  const VISC = 0.012;          // XSPH viskozita — drží vodu pohromadě
  const SCORR_K = 0.15;        // umělý tlak proti shlukování (relativní k lambda)
  const SCORR_N = 4;
  const DAMP = 0.985;
  // Pojistky proti explozi řešiče: bez nich stačí, aby se pár částic ocitlo
  // na sobě, hustota vystřelí a korekce je vymrští z nádoby ven.
  const MAX_CORR = R0*0.35;    // strop posunu za jednu iteraci
  const MAX_VEL  = 2600;       // strop rychlosti

  // jádra (2D)
  const POLY6 = 4 / (Math.PI * Math.pow(H, 8));
  const SPIKY = -30 / (Math.PI * Math.pow(H, 5));
  function w(r2){ const d = H2 - r2; return d > 0 ? POLY6 * d*d*d : 0; }
  function gradMag(r){ const d = H - r; return d > 0 ? SPIKY * d*d : 0; }

  let CAP = 900;
  let px, py, vx, vy, qx, qy, lam, cx, cy, dens;
  let n = 0;

  // mřížka sousedů
  let cellSize = H, gw = 0, gh = 0, minX = 0, minY = 0;
  let head, next;

  // klidová hustota se spočítá z pravidelného rozložení — ať nezávisí na tom,
  // jaká čísla jsem odhadl
  let REST = 1;

  function alloc(cap){
    CAP = cap;
    px = new Float32Array(CAP); py = new Float32Array(CAP);
    vx = new Float32Array(CAP); vy = new Float32Array(CAP);
    qx = new Float32Array(CAP); qy = new Float32Array(CAP);
    lam = new Float32Array(CAP); dens = new Float32Array(CAP);
    cx = new Float32Array(CAP); cy = new Float32Array(CAP);
    next = new Int32Array(CAP);
    n = 0;
  }

  function computeRest(){
    // Hustota částice uprostřed nekonečné hexagonální mřížky s roztečí R0.
    // Musí se sečíst přes celou mřížku v dosahu jádra — dřívější odhad přes
    // dva „prstence" vycházel moc vysoko, takže tlak nikdy nevznikl a voda
    // se slehla do kaluže na dně.
    let rho = 0;
    const rows = Math.ceil(H/R0) + 2;
    for(let j=-rows; j<=rows; j++){
      for(let i=-rows; i<=rows; i++){
        const x = i*R0 + ((j & 1) ? R0*0.5 : 0);
        const y = j*R0*0.866;
        const r2 = x*x + y*y;
        if(r2 < H2) rho += w(r2);
      }
    }
    REST = rho;
  }

  function reset(cap){
    alloc(cap || CAP);
    computeRest();
  }

  function count(){ return n; }
  function capacity(){ return CAP; }

  function spawn(x, y, ivx, ivy){
    if(n >= CAP) return false;
    px[n] = x; py[n] = y; vx[n] = ivx || 0; vy[n] = ivy || 0;
    n++;
    return true;
  }

  function remove(i){
    n--;
    px[i]=px[n]; py[i]=py[n]; vx[i]=vx[n]; vy[i]=vy[n];
  }

  function buildGrid(bounds){
    minX = bounds.x0 - H; minY = bounds.y0 - H;
    gw = Math.max(1, Math.ceil((bounds.x1 - bounds.x0 + 2*H)/cellSize));
    gh = Math.max(1, Math.ceil((bounds.y1 - bounds.y0 + 2*H)/cellSize));
    const cells = gw*gh;
    if(!head || head.length < cells) head = new Int32Array(cells);
    head.fill(-1, 0, cells);
    for(let i=0;i<n;i++){
      const gx = Math.min(gw-1, Math.max(0, (qx[i]-minX)/cellSize | 0));
      const gy = Math.min(gh-1, Math.max(0, (qy[i]-minY)/cellSize | 0));
      const c = gy*gw + gx;
      next[i] = head[c]; head[c] = i;
    }
  }

  // container: { R, top, gx, gy }  — poloměr, výška okraje, směr gravitace
  function step(dt, container){
    if(n === 0) return;
    dt = Math.min(dt, 1/50);

    const R = container.R, TOP = container.top;
    const gxA = container.gx, gyA = container.gy;

    // 1) predikce polohy
    for(let i=0;i<n;i++){
      vx[i] += gxA*dt; vy[i] += gyA*dt;
      vx[i] *= DAMP; vy[i] *= DAMP;
      qx[i] = px[i] + vx[i]*dt;
      qy[i] = py[i] + vy[i]*dt;
    }

    buildGrid({x0:-R, y0:0, x1:R, y1:TOP + H*3});

    // 2) iterace tlakového řešiče
    const wdq = w((0.2*H)*(0.2*H));
    for(let it=0; it<ITERS; it++){
      // hustoty a lambda
      for(let i=0;i<n;i++){
        let rho = 0, gradSum = 0, gix = 0, giy = 0;
        const gx0 = Math.min(gw-1, Math.max(0,(qx[i]-minX)/cellSize|0));
        const gy0 = Math.min(gh-1, Math.max(0,(qy[i]-minY)/cellSize|0));
        for(let oy=-1; oy<=1; oy++){
          const yy = gy0+oy; if(yy<0||yy>=gh) continue;
          for(let ox=-1; ox<=1; ox++){
            const xx = gx0+ox; if(xx<0||xx>=gw) continue;
            for(let j=head[yy*gw+xx]; j!==-1; j=next[j]){
              const rx = qx[i]-qx[j], ry = qy[i]-qy[j];
              const r2 = rx*rx+ry*ry;
              if(r2 >= H2) continue;
              rho += w(r2);
              if(j === i) continue;
              const r = Math.sqrt(r2) || 1e-4;
              const g = gradMag(r)/REST;
              const gx1 = g*rx/r, gy1 = g*ry/r;
              gix += gx1; giy += gy1;
              gradSum += gx1*gx1 + gy1*gy1;
            }
          }
        }
        dens[i] = rho;
        gradSum += gix*gix + giy*giy;
        const C = rho/REST - 1;
        lam[i] = -C / (gradSum + EPS);
      }

      // korekce polohy
      for(let i=0;i<n;i++){
        let ddx = 0, ddy = 0;
        const gx0 = Math.min(gw-1, Math.max(0,(qx[i]-minX)/cellSize|0));
        const gy0 = Math.min(gh-1, Math.max(0,(qy[i]-minY)/cellSize|0));
        for(let oy=-1; oy<=1; oy++){
          const yy = gy0+oy; if(yy<0||yy>=gh) continue;
          for(let ox=-1; ox<=1; ox++){
            const xx = gx0+ox; if(xx<0||xx>=gw) continue;
            for(let j=head[yy*gw+xx]; j!==-1; j=next[j]){
              if(j === i) continue;
              const rx = qx[i]-qx[j], ry = qy[i]-qy[j];
              const r2 = rx*rx+ry*ry;
              if(r2 >= H2) continue;
              const r = Math.sqrt(r2) || 1e-4;
              const ratio = w(r2)/wdq;
              // umělý tlak se škáluje podle lambda, jinak by byl proti němu neznatelný
              const scorr = -SCORR_K * Math.pow(ratio, SCORR_N) * Math.abs(lam[i]+lam[j]);
              const g = gradMag(r)*(lam[i]+lam[j]+scorr)/REST;
              ddx += g*rx/r; ddy += g*ry/r;
            }
          }
        }
        cx[i] = ddx; cy[i] = ddy;
      }
      for(let i=0;i<n;i++){
        let ddx = cx[i], ddy = cy[i];
        const dl = Math.hypot(ddx, ddy);
        if(dl > MAX_CORR){ const k = MAX_CORR/dl; ddx *= k; ddy *= k; }
        qx[i] += ddx; qy[i] += ddy;
        // stěny a dno nádoby
        if(qx[i] < -R + R0*0.4) qx[i] = -R + R0*0.4;
        if(qx[i] >  R - R0*0.4) qx[i] =  R - R0*0.4;
        if(qy[i] < R0*0.4) qy[i] = R0*0.4;
      }
    }

    // 3) rychlost z posunu + viskozita
    for(let i=0;i<n;i++){
      let nvx = (qx[i]-px[i])/dt, nvy = (qy[i]-py[i])/dt;
      const sp = Math.hypot(nvx, nvy);
      if(sp > MAX_VEL){ const k = MAX_VEL/sp; nvx *= k; nvy *= k; }
      vx[i] = nvx; vy[i] = nvy;
      px[i] = qx[i]; py[i] = qy[i];
    }
    for(let i=0;i<n;i++){
      let ax = 0, ay = 0, cnt = 0;
      const gx0 = Math.min(gw-1, Math.max(0,(px[i]-minX)/cellSize|0));
      const gy0 = Math.min(gh-1, Math.max(0,(py[i]-minY)/cellSize|0));
      for(let oy=-1; oy<=1; oy++){
        const yy = gy0+oy; if(yy<0||yy>=gh) continue;
        for(let ox=-1; ox<=1; ox++){
          const xx = gx0+ox; if(xx<0||xx>=gw) continue;
          for(let j=head[yy*gw+xx]; j!==-1; j=next[j]){
            if(j===i) continue;
            const rx = px[i]-px[j], ry = py[i]-py[j];
            if(rx*rx+ry*ry >= H2) continue;
            ax += vx[j]-vx[i]; ay += vy[j]-vy[i]; cnt++;
          }
        }
      }
      if(cnt){ vx[i] += VISC*ax/cnt; vy[i] += VISC*ay/cnt; }
    }

    // 4) co přeteklo přes okraj, to je pryč
    for(let i=n-1;i>=0;i--){
      if(py[i] > TOP + H*2.5 || Math.abs(px[i]) > R + H*2) remove(i);
    }
  }

  // Hladina: 85. percentil výšky částic — odolnější než maximum, které
  // by skákalo podle jedné vystřelené kapky.
  const heights = [];
  function surfaceY(){
    if(n === 0) return 0;
    heights.length = 0;
    for(let i=0;i<n;i++) heights.push(py[i]);
    heights.sort((a,b)=>a-b);
    return heights[Math.min(heights.length-1, Math.floor(heights.length*0.85))];
  }

  // Vykreslení: metaballs přes rozmazání a kontrast, když to prohlížeč umí,
  // jinak prosté kruhy. Kreslí se do zadaného kontextu v jeho souřadnicích;
  // převod z lokálních jednotek na obrazovku dodá volající přes toScreen().
  let blobCv = null, blobCtx = null;
  const canFilter = (function(){
    try{ const c = document.createElement('canvas').getContext('2d');
         c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; }
    catch(e){ return false; }
  })();

  function draw(g, toScreen, scale, color){
    if(n === 0) return;
    const rad = R0*0.95*scale;
    if(canFilter){
      // metaball: rozmazat a prohnat kontrastem → souvislá hmota
      const pad = rad*3;
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(let i=0;i<n;i++){
        const s = toScreen(px[i], py[i]);
        if(s.x<x0)x0=s.x; if(s.x>x1)x1=s.x;
        if(s.y<y0)y0=s.y; if(s.y>y1)y1=s.y;
      }
      x0-=pad; y0-=pad; x1+=pad; y1+=pad;
      const bw = Math.max(1, Math.ceil(x1-x0)), bh = Math.max(1, Math.ceil(y1-y0));
      if(!blobCv){ blobCv = document.createElement('canvas'); blobCtx = blobCv.getContext('2d'); }
      if(blobCv.width !== bw || blobCv.height !== bh){ blobCv.width = bw; blobCv.height = bh; }
      blobCtx.clearRect(0,0,bw,bh);
      blobCtx.filter = 'blur('+Math.max(2, rad*0.55).toFixed(1)+'px) contrast(14)';
      blobCtx.fillStyle = color;
      blobCtx.beginPath();
      for(let i=0;i<n;i++){
        const s = toScreen(px[i], py[i]);
        blobCtx.moveTo(s.x-x0+rad, s.y-y0);
        blobCtx.arc(s.x-x0, s.y-y0, rad, 0, Math.PI*2);
      }
      blobCtx.fill();
      blobCtx.filter = 'none';
      g.drawImage(blobCv, x0, y0);
    } else {
      g.fillStyle = color;
      g.beginPath();
      for(let i=0;i<n;i++){
        const s = toScreen(px[i], py[i]);
        g.moveTo(s.x+rad, s.y);
        g.arc(s.x, s.y, rad, 0, Math.PI*2);
      }
      g.fill();
    }
  }

  reset(CAP);
  return { reset, spawn, step, draw, count, capacity, surfaceY,
           get R0(){ return R0; }, get metaballs(){ return canFilter; } };
})();
