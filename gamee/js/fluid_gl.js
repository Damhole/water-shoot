'use strict';
// Golden Ducks — vykreslení kapaliny přes WebGL (screen-space fluid rendering).
//
// Proč vůbec: sjednocení kruhů na 2D canvasu se vždycky čte jako „kuličky na
// sobě". Standardní trik s blur+contrast na canvasu nejde — `ctx.filter` na
// iOS Safari neexistuje (do 26.5 jen „disabled by default"). Zbývá shader.
//
// Postup je klasický (Green, Screen Space Fluid Rendering, 2010):
//   1) částice se vykreslí jako měkké body do pomocné textury a sečtou se
//      → vznikne pole hustoty (R) a rozvíření (G)
//   2) celoobrazovkový průchod z pole udělá vodu:
//      práh → silueta, gradient → normála, normála → refrakce pozadí,
//      úzký pruh u prahu → obrys, rozvíření u hladiny → pěna
//
// Pole se počítá v poloviční šířce — je hladké, na detailu nezáleží a na
// mobilu to je polovina práce.

const FLUID_GL = (function(){

  let cv = null, gl = null, ok = false, failed = false;
  let progField = null, progComp = null;
  let fbo = null, fieldTex = null, fieldW = 0, fieldH = 0;
  let bgTex = null, bgReady = false;
  let vboPos = null, vboQuad = null;
  let cpuPos = null;
  const FIELD_SCALE = 0.5;

  const VS_FIELD = `
    attribute vec2 aPos;
    uniform vec2 uRes;
    uniform float uSize;
    void main(){
      vec2 c = (aPos / uRes) * 2.0 - 1.0;
      gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
      gl_PointSize = uSize;
    }`;

  // Měkký kopeček místo tvrdého kolečka — z jejich součtu vznikne spojité pole.
  const FS_FIELD = `
    precision mediump float;
    uniform float uGain;
    void main(){
      vec2 d = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(d, d);
      if(r2 > 1.0) discard;
      float w = 1.0 - r2;
      w = w * w;
      gl_FragColor = vec4(w * uGain, 0.0, 0.0, 1.0);
    }`;

  const VS_COMP = `
    attribute vec2 aXY;
    varying vec2 vUv;
    void main(){
      vUv = aXY * 0.5 + 0.5;
      gl_Position = vec4(aXY, 0.0, 1.0);
    }`;

  const FS_COMP = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uField;
    uniform sampler2D uBg;
    uniform vec2 uTexel;
    uniform float uThresh;
    uniform vec3 uTint;
    uniform vec3 uEdge;
    uniform float uTintMix;
    uniform float uWhite;
    uniform float uCapLo;
    uniform float uCapHi;

    void main(){
      vec4 f = texture2D(uField, vUv);
      float d = f.r;
      float a = smoothstep(uThresh - 0.05, uThresh + 0.05, d);
      if(a <= 0.004) discard;

      // Čtyři vzorky stranou slouží zároveň ke gradientu i k vyhlazení.
      // Silueta se bere ze syrové hustoty (ostrý okraj), ale stínování z
      // vyhlazené — jinak se vlnkování mřížky částic propíše do těla jako zrno.
      float sR = texture2D(uField, vUv + vec2(uTexel.x*2.0, 0.0)).r;
      float sL = texture2D(uField, vUv - vec2(uTexel.x*2.0, 0.0)).r;
      float sU = texture2D(uField, vUv + vec2(0.0, uTexel.y*2.0)).r;
      float sD = texture2D(uField, vUv - vec2(0.0, uTexel.y*2.0)).r;
      float dS = (d + sR + sL + sU + sD) * 0.2;
      vec2 g = vec2(sR - sL, sU - sD);
      float glen = length(g);
      vec2 n = glen > 0.0001 ? g / glen : vec2(0.0, 1.0);

      // průhlednost: pozadí prosvítá, jen posunuté podle normály
      vec2 off = n * 0.010 * min(glen * 10.0, 1.0);
      vec3 bg = texture2D(uBg, clamp(vUv - off, 0.001, 0.999)).rgb;

      // Tělo vody je JEDNOLITÉ — žádný přechod uvnitř. Ve Where's My Water
      // není bílá zvláštní veličina: bílá je tenká voda. Letící kapka je malá
      // a tenká, takže je celá bílá; hladina je tenká vrstva, takže má bílou
      // čepičku; hluboké tělo je tlusté, takže je plná barva.
      vec3 col = mix(bg, uTint, uTintMix);

      // bílá podle tloušťky — jediný zdroj bělosti ve scéně
      float white = 1.0 - smoothstep(uThresh + uCapLo, uThresh + uCapHi, dS);
      col = mix(col, vec3(1.0), white * uWhite);

      // obrys — úzká tmavá linka po obvodu, kreslí se přes bílou
      float edge = 1.0 - smoothstep(uThresh + 0.005, uThresh + 0.055, dS);
      col = mix(col, uEdge, edge * 0.8);

      gl_FragColor = vec4(col, a);
    }`;

  function compile(src, type){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  function link(vsSrc, fsSrc){
    const p = gl.createProgram();
    gl.attachShader(p, compile(vsSrc, gl.VERTEX_SHADER));
    gl.attachShader(p, compile(fsSrc, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  function init(){
    if(ok || failed) return ok;
    try{
      cv = document.createElement('canvas');
      gl = cv.getContext('webgl', { alpha:true, premultipliedAlpha:false,
                                    preserveDrawingBuffer:true, antialias:false,
                                    depth:false, stencil:false });
      if(!gl) throw new Error('WebGL není k dispozici');
      progField = link(VS_FIELD, FS_FIELD);
      progComp  = link(VS_COMP,  FS_COMP);
      vboPos = gl.createBuffer();
      vboQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      fbo = gl.createFramebuffer();
      fieldTex = gl.createTexture();
      bgTex = gl.createTexture();
      ok = true;
    }catch(e){
      failed = true; ok = false;
      console.warn('[WS] WebGL render kapaliny nedostupný:', e.message);
    }
    return ok;
  }

  function available(){ return ok || (!failed && init()); }

  function resize(w, h){
    if(cv.width === w && cv.height === h) return;
    cv.width = w; cv.height = h;
    fieldW = Math.max(1, Math.round(w*FIELD_SCALE));
    fieldH = Math.max(1, Math.round(h*FIELD_SCALE));
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fieldW, fieldH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Pozadí pro refrakci. Je statické (prerender scény), takže stačí jednou.
  function setBackground(srcCanvas){
    if(!available() || !srcCanvas) return;
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bgReady = true;
  }

  function ensureCpu(n){
    if(!cpuPos || cpuPos.length < n*2) cpuPos = new Float32Array(Math.max(n*2, 8192));
  }

  // pts: souřadnice v pixelech plátna, spd: 0..1 rozvíření. Vrací canvas
  // k vykreslení přes ctx.drawImage — kompozice zůstává na 2D vrstvě.
  // cssW/cssH = rozměr v CSS pixelech (v téhle soustavě přicházejí souřadnice),
  // rs = kolik fyzických pixelů na CSS pixel (na mobilu se vyplatí 1, ne DPR).
  function render(cssW, cssH, rs, n, fillFn, opts){
    if(!available() || n <= 0) return null;
    const w = Math.max(1, Math.round(cssW*rs)), h = Math.max(1, Math.round(cssH*rs));
    resize(w, h);
    ensureCpu(n);
    fillFn(cpuPos);              // volající naplní pozice (projekci zná puzzle)

    const o = opts || {};
    // --- 1) pole hustoty
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fieldW, fieldH);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(progField);
    gl.uniform2f(gl.getUniformLocation(progField, 'uRes'), cssW, cssH);
    gl.uniform1f(gl.getUniformLocation(progField, 'uSize'), (o.pointSize || 26) * rs * FIELD_SCALE);
    gl.uniform1f(gl.getUniformLocation(progField, 'uGain'), o.gain || 0.085);
    const aPos = gl.getAttribLocation(progField, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
    gl.bufferData(gl.ARRAY_BUFFER, cpuPos.subarray(0, n*2), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, n);

    // --- 2) z pole udělat vodu
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(progComp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.uniform1i(gl.getUniformLocation(progComp, 'uField'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bgReady ? bgTex : fieldTex);
    gl.uniform1i(gl.getUniformLocation(progComp, 'uBg'), 1);
    gl.uniform2f(gl.getUniformLocation(progComp, 'uTexel'), 1/fieldW, 1/fieldH);
    gl.uniform1f(gl.getUniformLocation(progComp, 'uThresh'), o.thresh || 0.34);
    const tint = o.tint || [0.36, 0.74, 0.96];
    const edge = o.edge || [0.05, 0.36, 0.52];
    gl.uniform3f(gl.getUniformLocation(progComp, 'uTint'), tint[0], tint[1], tint[2]);
    gl.uniform3f(gl.getUniformLocation(progComp, 'uEdge'), edge[0], edge[1], edge[2]);
    gl.uniform1f(gl.getUniformLocation(progComp, 'uTintMix'), o.tintMix === undefined ? 0.55 : o.tintMix);
    gl.uniform1f(gl.getUniformLocation(progComp, 'uWhite'), o.white === undefined ? 0.9 : o.white);
    gl.uniform1f(gl.getUniformLocation(progComp, 'uCapLo'), o.capLo === undefined ? 0.01 : o.capLo);
    gl.uniform1f(gl.getUniformLocation(progComp, 'uCapHi'), o.capHi === undefined ? 0.22 : o.capHi);
    const aXY = gl.getAttribLocation(progComp, 'aXY');
    gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
    gl.enableVertexAttribArray(aXY);
    gl.vertexAttribPointer(aXY, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return cv;
  }

  return { available, render, setBackground, get canvas(){ return cv; } };
})();
