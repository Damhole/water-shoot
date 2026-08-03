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
  const ITERS = 4;             // iterace solveru hustoty (víc = klidnější hladina)
  const SUBSTEPS = 2;          // menší kroky = stabilnější řešič
  // Relaxace v lambda. POZOR na řád: gradienty vycházejí kolem 1e-3, takže
  // hodnota v jednotkách „stovky" by jmenovatel zcela přebila a tlak by byl
  // nulový — voda by se slehla do kaluže na dně.
  const EPS  = 2e-4;
  const VISC = 0.09;           // XSPH viskozita — tlumí odskoky, drží vodu pohromadě
  const SCORR_K = 0.04;        // umělý tlak proti shlukování (relativní k lambda)
  const SCORR_N = 4;
  const DAMP = 0.955;
  // Pojistky proti explozi řešiče: bez nich stačí, aby se pár částic ocitlo
  // na sobě, hustota vystřelí a korekce je vymrští z nádoby ven.
  const MAX_CORR = R0*0.18;    // strop posunu za jednu iteraci
  const MAX_VEL  = 1100;       // strop rychlosti — bez něj kapky vystřelují z hmoty

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
  function step(dtFull, container){
    if(n === 0) return;
    dtFull = Math.min(dtFull, 1/50);
    for(let sub=0; sub<SUBSTEPS; sub++) substep(dtFull/SUBSTEPS, container);
  }

  function substep(dt, container){
    if(n === 0) return;

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

  // Vykreslení kapaliny jako TĚLESA, ne jako shluku kuliček.
  //
  // Sjednocení kruhů má vždycky obrys složený z oblouků a čte se jako
  // „kuličky na sobě", ať se rozmaže jakkoli. Voda v nádobě potřebuje
  // hladinu: z částic se proto spočítá výškový profil po sloupcích, vyhladí
  // se a tělo vody se nakreslí jako jeden tvar s vlnitým povrchem.
  // Kapky výrazně nad hladinou se kreslí zvlášť jako krůpěje.
  const COLS = 26;
  const colH = new Float32Array(COLS);
  const colN = new Int32Array(COLS);
  const smooth = new Float32Array(COLS);
  const colMax = new Float32Array(COLS);

  function draw(g, toScreen, scale, opts){
    if(n === 0) return;
    const R = opts.R, TOP = opts.top;

    // Výška sloupce se počítá z OBJEMU (počtu kapek), ne z nejvyšší částice —
    // jinak jedna letící kapka vytáhne celý sloupec do špičky. Strop tvoří
    // skutečná nejvyšší částice, aby hladina nikdy nepřerostla realitu.
    colH.fill(-1e9); colN.fill(0); colMax.fill(-1e9);
    for(let i=0;i<n;i++){
      let c = ((px[i] + R) / (2*R) * COLS) | 0;
      if(c < 0) c = 0; else if(c >= COLS) c = COLS-1;
      colN[c]++;
      if(py[i] > colMax[c]) colMax[c] = py[i];
    }
    const colW = 2*R/COLS;
    const perDrop = R0*R0*0.66 / colW;      // kolik výšky přidá jedna kapka
    for(let c=0;c<COLS;c++){
      if(colN[c] === 0) continue;
      // Hladina jde po SKUTEČNÉM vrcholu sloupce, ale nejvýš o kousek nad to,
      // co dovolí objem. Samotný objem hladinu podceňoval (horní vrstva je
      // volnější) a ta vrstva pak vypadla z tělesa jako řetěz korálků.
      // Strop z objemu zároveň brání tomu, aby jedna letící kapka udělala špičku.
      colH[c] = Math.min(colMax[c], colN[c]*perDrop + R0*1.6);
    }

    // vyhlazení profilu — bez něj by hladina poskakovala po jednotlivých kapkách
    for(let pass=0; pass<3; pass++){
      for(let c=0;c<COLS;c++){
        const a = colH[Math.max(0,c-1)], b = colH[c], d = colH[Math.min(COLS-1,c+1)];
        const vals = [a,b,d].filter(v => v > -1e8);
        smooth[c] = vals.length ? vals.reduce((x,y)=>x+y,0)/vals.length : -1e9;
      }
      colH.set(smooth);
    }

    // souvislé úseky hladiny (mezi nimi voda není)
    let c = 0;
    while(c < COLS){
      if(colH[c] < -1e8){ c++; continue; }
      let c0 = c;
      while(c < COLS && colH[c] > -1e8) c++;
      const c1 = c - 1;
      drawBody(g, toScreen, scale, R, c0, c1);
    }

    // krůpěje nad hladinou
    const rad = R0*0.55*scale;
    g.fillStyle = 'rgba(150,225,255,0.95)';
    g.beginPath();
    let any = false;
    for(let i=0;i<n;i++){
      let cc = ((px[i] + R) / (2*R) * COLS) | 0;
      if(cc < 0) cc = 0; else if(cc >= COLS) cc = COLS-1;
      if(py[i] < colH[cc] + R0*0.9) continue;      // uvnitř tělesa
      const s = toScreen(px[i], py[i]);
      g.moveTo(s.x+rad, s.y); g.arc(s.x, s.y, rad, 0, Math.PI*2);
      any = true;
    }
    if(any) g.fill();
  }

  function drawBody(g, toScreen, scale, R, c0, c1){
    const xAt = c => -R + (c + 0.5)/COLS * 2*R;
    const top0 = toScreen(xAt(c0), colH[c0]);
    const bot0 = toScreen(xAt(c0), 0);
    const bot1 = toScreen(xAt(c1), 0);

    g.beginPath();
    g.moveTo(toScreen(xAt(c0) - R/COLS, 0).x, bot0.y);
    // povrch zleva doprava, prohnutý přes střední body
    let prev = toScreen(xAt(c0) - R/COLS, colH[c0]);
    g.lineTo(prev.x, prev.y);
    for(let c=c0; c<=c1; c++){
      const cur = toScreen(xAt(c), colH[c]);
      const nx  = (c < c1) ? toScreen(xAt(c+1), colH[c+1]) : toScreen(xAt(c1)+R/COLS, colH[c1]);
      g.quadraticCurveTo(cur.x, cur.y, (cur.x+nx.x)/2, (cur.y+nx.y)/2);
      prev = cur;
    }
    g.lineTo(toScreen(xAt(c1) + R/COLS, 0).x, bot1.y);
    g.closePath();

    const top = toScreen(0, colH[c0] > colH[c1] ? colH[c0] : colH[c1]);
    const bottom = toScreen(0, 0);
    const gr = g.createLinearGradient(0, top.y, 0, bottom.y);
    gr.addColorStop(0.00, '#8fe6ff');
    gr.addColorStop(0.10, '#3fbaf0');
    gr.addColorStop(0.55, '#1b8fd4');
    gr.addColorStop(1.00, '#0a5f9c');
    g.fillStyle = gr;
    g.fill();

    // lesklá hladina
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(220,250,255,0.9)';
    g.lineWidth = Math.max(1.5, 3*scale);
    g.beginPath();
    let p0 = toScreen(xAt(c0) - R/COLS, colH[c0]);
    g.moveTo(p0.x, p0.y);
    for(let c=c0; c<=c1; c++){
      const cur = toScreen(xAt(c), colH[c]);
      const nx  = (c < c1) ? toScreen(xAt(c+1), colH[c+1]) : toScreen(xAt(c1)+R/COLS, colH[c1]);
      g.quadraticCurveTo(cur.x, cur.y, (cur.x+nx.x)/2, (cur.y+nx.y)/2);
    }
    g.stroke();
    g.restore();
  }

  reset(CAP);
  // průměrná rychlost — čím blíž nule, tím klidnější hladina
  function meanSpeed(){
    if(n === 0) return 0;
    let sum = 0;
    for(let i=0;i<n;i++) sum += Math.hypot(vx[i], vy[i]);
    return sum/n;
  }

  return { reset, spawn, step, draw, count, capacity, surfaceY, meanSpeed,
           get R0(){ return R0; } };
})();
