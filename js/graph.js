import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const gsap = window.gsap;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Muted, low-chroma topic colours: bone, clay, sage, ochre, slate.
const PAL = ['#E6DFD3', '#C79A8B', '#9FB39A', '#C8AE82', '#9AA6BC'];
const HERO = 8;              // "Resume Tailoring for RBC"
const BASE_D = 38, MIN_D = 3.2;
// Portrait screens have a narrow horizontal FOV, so pull the camera back to fit the graph.
const maxD = () => BASE_D * Math.pow(Math.max(1, 1.25 / (innerWidth / innerHeight)), 0.75);
const AZ_F = 0.55, EL_F = 0.3;
const PROMPT = 'help me tailor my resume for the RBC data analyst role';
const REPLY = `<p>Here's what RBC's Data Analyst posting screens for. Mirror these exact terms:</p>
<ul><li><b>SQL</b> and <b>Python (pandas)</b> for cleaning and analysis</li><li><b>Tableau / Power BI</b> dashboards for stakeholders</li><li>KPI reporting, data validation and ETL</li></ul>
<p>Paste your top three bullets and I'll rewrite them in that language.</p>`;

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const DEBUG = new URLSearchParams(location.search).has('debug');
const clock = { t: 0 };
const now = () => (DEBUG ? clock.t : gsap.ticker.time);

export async function initGraph(data) {
  const CH = data.chats, N = CH.length, CN = data.clusters;
  const COL = PAL.map((h) => new THREE.Color(h));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const R = rng(7);

  // ---------------- renderer ----------------
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let W = innerWidth, H = innerHeight, DPR = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x0B0B0C, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 600);
  const rt = new THREE.WebGLRenderTarget(W * DPR, H * DPR, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(DPR);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  // Additive sprites can stack into large HDR values; clamp them so bloom stays soft.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(1.3)), c.a); }',
  }));
  const BLOOM = 0.32;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), BLOOM, 0.5, 0.18);
  // three's blur kernels use sigma = radius (cut off at 1 sigma), which shows up as square halos
  // around bright points on a dark background. Re-weight with a tighter sigma so the falloff reaches ~0.
  [3, 5, 7, 9, 11].forEach((k, i) => {
    const sig = k / 2.3, co = [];
    for (let j = 0; j < k; j++) co.push(Math.exp(-0.5 * j * j / (sig * sig)));
    bloom.separableBlurMaterials[i].uniforms.gaussianCoefficients.value = co;
  });
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------------- background ----------------
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uAsp: { value: W / H }, uDim: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uAsp; uniform float uDim;
      void main(){
        vec2 p = vUv - 0.5; p.x *= uAsp;
        vec3 c = vec3(0.043, 0.043, 0.047);
        c += vec3(0.022, 0.02, 0.018) * smoothstep(0.9, 0.0, length(p - vec2(0.2, 0.05)));
        c *= 1.0 - length(p) * 0.45;
        gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  }));
  bg.frustumCulled = false; bg.renderOrder = -10;
  scene.add(bg);

  // ---------------- shared sprite shader ----------------
  const glowMat = (extra = {}) => new THREE.ShaderMaterial({
    uniforms: { uScale: { value: DPR }, uMax: { value: 260 * DPR } },
    vertexShader: `uniform float uScale; uniform float uMax;
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(aSize * uScale * (30.0 / max(-mv.z, 0.5)), uMax);
        vColor = aColor; vAlpha = aAlpha;
      }`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.3, 0.18, d);
        float glow = exp(-d * d * 9.0);
        float a = (core + glow * 0.22) * vAlpha;
        vec3 col = mix(vColor, vec3(1.0), core * 0.18);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, ...extra,
  });
  function makePoints(count, mat = glowMat()) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const p = new THREE.Points(g, mat); p.frustumCulled = false;
    p.userData = { pos, col, size, alpha, flush() { for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) g.attributes[k].needsUpdate = true; } };
    scene.add(p); return p;
  }

  // ---------------- stars ----------------
  {
    const S = 1300, g = new THREE.BufferGeometry(), pos = new Float32Array(S * 3), tw = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      const r = 90 + R() * 220, th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph) * 0.7; pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      tw[i] = R();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTw', new THREE.BufferAttribute(tw, 1));
    var stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: DPR } },
      vertexShader: `attribute float aTw; uniform float uTime; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.8 + aTw * 1.6) * uScale; vA = (0.25 + 0.5 * aTw) * (0.6 + 0.4 * sin(uTime * (0.6 + aTw * 2.0) + aTw * 40.0)); }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.8, 0.78, 0.74), vA * 0.55 * smoothstep(1.0, 0.0, d)); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    stars.frustumCulled = false;
    scene.add(stars);
  }

  // ---------------- nodes ----------------
  const nodes = CH.map((c, i) => {
    const umap = new THREE.Vector3(c.p[0], c.p[1], c.p[2]);
    let chaos;
    if (i === HERO) chaos = umap.clone();
    else do {
      chaos = new THREE.Vector3((R() * 2 - 1) * 13, (R() * 2 - 1) * 8.5, (R() * 2 - 1) * 11);
    } while (chaos.length() > 14 || chaos.distanceTo(nodesHero()) < 3.5);
    const mid = chaos.clone().add(umap).multiplyScalar(0.5);
    const ctrl = mid.add(new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).multiplyScalar(4.5));
    return { i, c: c.c, umap, chaos, ctrl, pos: chaos.clone(), fly: 0, vis: 0, flash: 0, cmix: 0, f: 1, ft: 1, hot: 0, seed: R() * 6.28, sx: 0, sy: 0, sz: 2, px: 0,
      hist: Array.from({ length: 14 }, () => chaos.clone()) };
  });
  function nodesHero() { return new THREE.Vector3(CH[HERO].p[0], CH[HERO].p[1], CH[HERO].p[2]); }
  const nodePts = makePoints(N);
  nodePts.renderOrder = 3;
  const trailPts = makePoints(N * 14);
  trailPts.renderOrder = 2;

  // adjacency + edges
  const adj = Array.from({ length: N }, () => new Set());
  const edges = [];
  const seen = new Set();
  CH.forEach((c, i) => c.nb.slice(0, 4).forEach(([j, s]) => {
    const k = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(k)) return; seen.add(k);
    edges.push({ a: i, b: j, s, draw: 0, f: 1, ft: 1, depth: 99 });
    adj[i].add(j); adj[j].add(i);
  }));
  // BFS from the hero node so lines grow outward from the first memory
  {
    const depth = new Array(N).fill(-1); depth[HERO] = 0; const q = [HERO];
    while (q.length) { const u = q.shift(); for (const v of adj[u]) if (depth[v] < 0) { depth[v] = depth[u] + 1; q.push(v); } }
    let maxD = Math.max(...depth);
    edges.forEach((e) => {
      const da = depth[e.a], db = depth[e.b];
      if (da < 0 && db < 0) e.depth = maxD + 1;
      else { e.depth = Math.min(da < 0 ? 99 : da, db < 0 ? 99 : db); if (db < da && db >= 0) { const t = e.a; e.a = e.b; e.b = t; } }
    });
  }
  const E = edges.length;
  const lineGeo = new LineSegmentsGeometry();
  lineGeo.setPositions(new Float32Array(E * 6));
  lineGeo.setColors(new Float32Array(E * 6));
  const lineMat = new LineMaterial({ vertexColors: true, linewidth: 1, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  lineMat.resolution.set(W, H);
  const lines = new LineSegments2(lineGeo, lineMat);
  lines.frustumCulled = false; lines.renderOrder = 1;
  scene.add(lines);
  const linePosArr = lineGeo.attributes.instanceStart.data;
  const lineColArr = lineGeo.attributes.instanceColorStart.data;

  // sparks: tip of every edge while it draws + travelling signal pulses
  const PULSES = 36;
  const sparkPts = makePoints(E + PULSES);
  sparkPts.renderOrder = 4;
  const pulses = Array.from({ length: PULSES }, () => ({ e: (R() * E) | 0, t: R(), sp: 0.25 + R() * 0.5, dir: R() < 0.5 }));

  // halo rings (hover + selected)
  const haloMat = glowMat({
    fragmentShader: `varying vec3 vColor; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0;
        float ring = (smoothstep(0.06, 0.0, abs(d - 0.78)) + smoothstep(0.4, 0.0, abs(d - 0.78)) * 0.12) * smoothstep(1.0, 0.92, d);
        gl_FragColor = vec4(vColor, ring * vAlpha); }`,
  });
  const halo = makePoints(2, haloMat);
  halo.renderOrder = 5;

  // ---------------- particles (chat dissolve) ----------------
  let particles = null;
  const partMat = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(W, H) }, uDpr: { value: DPR }, uTime: { value: 0 },
      uScanT0: { value: 0 }, uScanDur: { value: 1 }, uTop: { value: 0 }, uH: { value: 1 },
      uCollapse: { value: 0 }, uTarget: { value: new THREE.Vector2(W / 2, H / 2) }, uFade: { value: 1 },
    },
    vertexShader: `uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform float uScanT0; uniform float uScanDur;
      uniform float uTop; uniform float uH; uniform float uCollapse; uniform vec2 uTarget; uniform float uFade;
      attribute vec2 aStart; attribute vec3 aColor; attribute vec4 aRand; attribute float aKind;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        float rel = uScanT0 + clamp((aStart.y - uTop) / uH, 0.0, 1.0) * uScanDur;
        float age = uTime - rel;
        float vis = step(0.0, age);
        age = max(age, 0.0);
        vec2 p = aStart;
        vec2 dir = normalize(aRand.xy * 2.0 - 1.0 + vec2(0.0, -0.55));
        p += dir * (1.0 - exp(-age * 2.6)) * (5.0 + aRand.z * 30.0);
        p += vec2(sin(age * 1.9 + aRand.w * 6.28), cos(age * 1.4 + aRand.x * 6.28)) * 5.0 * min(age, 1.0);
        p.y -= age * 9.0 * aRand.y;
        float k = clamp((uCollapse - aRand.w * 0.32) / 0.68, 0.0, 1.0);
        float e = k * k * (3.0 - 2.0 * k);
        e = pow(e, 1.6);
        vec2 v = p - uTarget;
        float ang = e * (3.5 + aRand.z * 3.0);
        float s = sin(ang), c = cos(ang);
        v = vec2(c * v.x - s * v.y, s * v.x + c * v.y) * pow(1.0 - e, 1.25);
        p = uTarget + v;
        gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
        gl_PointSize = (aKind > 1.5 ? 2.1 : 2.4) * uDpr * (1.0 + e * 0.8);
        vColor = mix(aColor, vec3(0.95, 0.92, 0.87), smoothstep(0.0, 0.7, e));
        float a = aKind > 1.5 ? 0.85 : (aKind > 0.5 ? 0.45 : 0.3);
        vAlpha = a * vis * (1.0 - smoothstep(0.62, 0.97, e)) * uFade * (0.6 + 0.4 * min(age * 5.0, 1.0));
      }`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vColor, vAlpha * smoothstep(1.0, 0.3, d)); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });

  function rasterizeChat() {
    const card = $('#chat'), r = card.getBoundingClientRect();
    const cw = Math.ceil(r.width), chh = Math.ceil(r.height);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rr = (x, y, w, h, rad) => { g.beginPath(); g.roundRect(x, y, w, h, rad); };
    rr(0, 0, cw, chh, 22); g.fillStyle = '#212121'; g.fill();
    for (const el of card.querySelectorAll('.msg-u, .chat-input, .chat-send, .chat-share')) {
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      rr(b.left - r.left, b.top - r.top, b.width, b.height, parseFloat(cs.borderTopLeftRadius) || 0);
      if (!cs.backgroundColor.includes('0)')) { g.fillStyle = cs.backgroundColor; g.fill(); }
      if (parseFloat(cs.borderTopWidth) > 0) { g.strokeStyle = 'rgba(255,255,255,.18)'; g.stroke(); }
    }
    g.fillStyle = '#ECECEC';
    for (const li of card.querySelectorAll('.msg-a li')) {
      const b = li.getBoundingClientRect(); g.beginPath(); g.arc(b.left - r.left - 11, b.top - r.top + 13, 2.4, 0, 7); g.fill();
    }
    const tw = document.createTreeWalker(card, NodeFilter.SHOW_TEXT), range = document.createRange();
    while (tw.nextNode()) {
      const t = tw.currentNode, el = t.parentElement;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const cs = getComputedStyle(el);
      g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; g.fillStyle = cs.color; g.textBaseline = 'middle';
      for (let i = 0; i < t.data.length; i++) {
        const ch = t.data[i]; if (!ch.trim()) continue;
        range.setStart(t, i); range.setEnd(t, i + 1);
        const b = range.getBoundingClientRect(); if (!b.width) continue;
        g.fillText(ch, b.left - r.left, b.top - r.top + b.height / 2);
      }
    }
    const img = g.getImageData(0, 0, cw, chh).data;
    const st = [], co = [], ra = [], ki = [];
    const lin = (v) => Math.pow(v / 255, 2.2);
    for (let y = 0; y < chh; y += 2) for (let x = 0; x < cw; x += 2) {
      const o = (y * cw + x) * 4; if (img[o + 3] < 10) continue;
      const lum = (img[o] + img[o + 1] + img[o + 2]) / 3;
      let kind;
      if (lum > 95) kind = 2; else if (lum > 42) { if (x % 4 || y % 4) continue; kind = 1; } else { if (x % 6 || y % 6) continue; kind = 0; }
      st.push(r.left + x + Math.random() * 2, r.top + y + Math.random() * 2);
      if (kind === 0) co.push(0.045, 0.045, 0.045); else co.push(lin(img[o]) * 1.1, lin(img[o + 1]) * 1.1, lin(img[o + 2]) * 1.15);
      ra.push(Math.random(), Math.random(), Math.random(), Math.random());
      ki.push(kind);
    }
    const geo = new THREE.BufferGeometry();
    const n = ki.length;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aStart', new THREE.BufferAttribute(new Float32Array(st), 2));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(co), 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(ra), 4));
    geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(ki), 1));
    const p = new THREE.Points(geo, partMat); p.frustumCulled = false; p.renderOrder = 10;
    return { p, rect: r };
  }
  function dropParticles() { if (particles) { scene.remove(particles); particles.geometry.dispose(); particles = null; } }

  // ---------------- camera rig ----------------
  const rig = { tx: 0, ty: 0, tz: 0, d: maxD(), az: AZ_F, el: EL_F, shift: 0 };
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.enableZoom = false; controls.rotateSpeed = 0.55; controls.panSpeed = 0.7;
  controls.autoRotateSpeed = 0.35; controls.enabled = false;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = Math.PI - 0.15;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  // Let vertical swipes scroll the page on touch screens; horizontal drags still orbit.
  canvas.style.touchAction = 'pan-y';
  function applyRig() {
    const ce = Math.cos(rig.el);
    camera.position.set(rig.tx + rig.d * ce * Math.sin(rig.az), rig.ty + rig.d * Math.sin(rig.el), rig.tz + rig.d * ce * Math.cos(rig.az));
    camera.lookAt(rig.tx, rig.ty, rig.tz);
  }
  function applyShift() {
    camera.aspect = W / H;
    if (rig.shift) camera.setViewOffset(W, H, -rig.shift * W, 0, W, H); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  const desktopShift = () => (W > 900 ? 0.075 : 0);

  // ---------------- state ----------------
  let mode = 'intro';   // intro | live
  let trailAmt = 0, pulseAmt = 0, labelsOn = 0, scrollP = 0;
  let hovered = -1, selected = -1, focusSet = null, clusterFocus = -1;
  let scan = null;
  let introTL = null;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  // DOM refs
  const stage = $('#stage'), chat = $('#chat'), body = $('#chatBody'), typed = $('#chatTyped');
  const caret = $('#chatCaret'), ph = $('#chatPh'), send = $('#chatSend'), empty = $('#chatEmpty');
  const fcur = $('#fakeCursor'), ring = $('#clickRing'), scanEl = $('#scanline');
  const landing = $('#landing'), ghostsEl = $('#ghosts');
  const labelsEl = $('#labels'), counter = $('#counter'), counterN = $('#counterN'), captionEl = $('#caption');
  const tip = $('#tip'), panel = $('#panel');

  // cluster labels
  const centroids = CN.map((_, c) => {
    const pts = nodes.filter((n) => n.c === c).map((n) => n.umap);
    const mean = (arr) => arr.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / arr.length);
    const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; };
    const m0 = mean(pts), md = med(pts.map((v) => v.distanceTo(m0)));
    const inl = pts.filter((v) => v.distanceTo(m0) <= md * 2);
    const m = mean(inl), r = med(inl.map((v) => v.distanceTo(m)));
    return { v: new THREE.Vector3(m.x, m.y + r + 1.1, m.z), k: pts.length };
  });
  const clabels = CN.map((name, c) => {
    const d = document.createElement('div'); d.className = 'clabel'; d.style.setProperty('--c', PAL[c]);
    d.innerHTML = `<i></i>${name}`; labelsEl.appendChild(d); return d;
  });

  // legend
  const legend = $('#legend');
  CN.forEach((name, c) => {
    const d = document.createElement('div'); d.className = 'lg'; d.style.setProperty('--c', PAL[c]); d.dataset.c = c;
    d.innerHTML = `<span>${name}</span><span class="n">${String(centroids[c].k).padStart(2, '0')}</span><i></i>`;
    d.addEventListener('click', () => { clusterFocus = clusterFocus === c ? -1 : c; legend.querySelectorAll('.lg').forEach((x) => x.classList.toggle('on', +x.dataset.c === clusterFocus)); if (selected >= 0) deselect(); });
    d.addEventListener('pointerenter', () => { legendHover = c; });
    d.addEventListener('pointerleave', () => { legendHover = -1; });
    legend.appendChild(d);
  });
  let legendHover = -1;

  // ---------------- projection ----------------
  function project(v, out) {
    tmp2.copy(v).project(camera);
    out.x = (tmp2.x + 1) / 2 * W; out.y = (1 - tmp2.y) / 2 * H; out.z = tmp2.z;
    return out;
  }

  // ---------------- per-frame ----------------
  const white = new THREE.Color(0.86, 0.85, 0.83);
  const cTmp = new THREE.Color();
  let last = now();
  function frame() {
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    stars.material.uniforms.uTime.value = t;
    stars.rotation.y = t * 0.004;

    if (mode === 'live') {
      controls.enabled = scrollP < 0.5;
      applyZoom();
      controls.update();
    } else applyRig();
    camera.updateMatrixWorld();

    // focus targets
    let fs = focusSet, primary = -1;
    if (hovered >= 0) { primary = hovered; fs = new Set([hovered, ...adj[hovered]]); }
    else if (selected >= 0) { primary = selected; fs = new Set([selected, ...adj[selected]]); }
    else if (!fs && (legendHover >= 0 || clusterFocus >= 0)) { const c = legendHover >= 0 ? legendHover : clusterFocus; fs = new Set(nodes.filter((n) => n.c === c).map((n) => n.i)); }
    const k = 1 - Math.exp(-dt * 9);

    // nodes
    const P = nodePts.userData;
    const camD = camera.position;
    for (const n of nodes) {
      // bezier flight from chaos to umap
      const u = n.fly, iu = 1 - u;
      n.pos.set(
        iu * iu * n.chaos.x + 2 * iu * u * n.ctrl.x + u * u * n.umap.x,
        iu * iu * n.chaos.y + 2 * iu * u * n.ctrl.y + u * u * n.umap.y,
        iu * iu * n.chaos.z + 2 * iu * u * n.ctrl.z + u * u * n.umap.z);
      n.ft = fs ? (fs.has(n.i) ? 1 : 0.14) : 1;
      n.f += (n.ft - n.f) * k;
      n.hot += ((n.i === primary ? 1 : 0) - n.hot) * k;
      n.flash *= Math.exp(-dt * 3.2);
      const o = n.i * 3;
      P.pos[o] = n.pos.x; P.pos[o + 1] = n.pos.y; P.pos[o + 2] = n.pos.z;
      cTmp.copy(white).lerp(COL[n.c], n.cmix);
      const br = (0.5 + 0.5 * n.f) * (1 + n.flash * 0.7 + n.hot * 0.35);
      P.col[o] = cTmp.r * br; P.col[o + 1] = cTmp.g * br; P.col[o + 2] = cTmp.b * br;
      const breathe = 1 + 0.07 * Math.sin(t * 1.6 + n.seed * 3);
      P.size[n.i] = 13 * n.vis * breathe * (1 + n.flash * 0.6) * (0.7 + 0.3 * n.f) * (1 + n.hot * 0.75);
      P.alpha[n.i] = Math.min(1, n.vis) * (0.15 + 0.85 * n.f);
      // screen-space for picking / ghosts
      project(n.pos, tmp); n.sx = tmp.x; n.sy = tmp.y; n.sz = tmp.z;
      n.px = 13 * 30 / Math.max(0.5, tmp.copy(n.pos).applyMatrix4(camera.matrixWorldInverse).z * -1);
      // trail history
      if (trailAmt > 0.001) { n.hist.pop(); n.hist.unshift(n.pos.clone()); }
    }
    P.flush();

    // trails
    const T = trailPts.userData;
    if (trailAmt > 0.001) {
      for (const n of nodes) for (let h = 0; h < 14; h++) {
        const idx = n.i * 14 + h, o = idx * 3, q = n.hist[h], fall = 1 - h / 14;
        T.pos[o] = q.x; T.pos[o + 1] = q.y; T.pos[o + 2] = q.z;
        cTmp.copy(white).lerp(COL[n.c], n.cmix);
        T.col[o] = cTmp.r; T.col[o + 1] = cTmp.g; T.col[o + 2] = cTmp.b;
        T.size[idx] = 8 * fall * n.vis; T.alpha[idx] = 0.22 * fall * fall * trailAmt * (n.i === HERO ? 0 : 1);
      }
      trailPts.visible = true; T.flush();
    } else trailPts.visible = false;

    // edges
    const lp = linePosArr.array, lc = lineColArr.array;
    for (let e = 0; e < E; e++) {
      const ed = edges[e], A = nodes[ed.a], B = nodes[ed.b], o = e * 6;
      const d = ed.draw;
      lp[o] = A.pos.x; lp[o + 1] = A.pos.y; lp[o + 2] = A.pos.z;
      lp[o + 3] = lerp(A.pos.x, B.pos.x, d); lp[o + 4] = lerp(A.pos.y, B.pos.y, d); lp[o + 5] = lerp(A.pos.z, B.pos.z, d);
      if (primary >= 0) ed.ft = (ed.a === primary || ed.b === primary) ? 2.6 : 0.12;
      else if (fs) ed.ft = (fs.has(ed.a) && fs.has(ed.b)) ? 1.6 : 0.1;
      else ed.ft = 1;
      ed.f += (ed.ft - ed.f) * k;
      const base = 0.16 * ed.f * (d > 0 ? 1 : 0);
      const ca = COL[A.c], cb = COL[B.c], tipHot = (1 - d) * (d > 0 ? 1 : 0);
      lc[o] = ca.r * base; lc[o + 1] = ca.g * base; lc[o + 2] = ca.b * base;
      lc[o + 3] = lerp(lerp(ca.r, cb.r, d), 1, tipHot * 0.7) * base * (1 + tipHot * 1.4);
      lc[o + 4] = lerp(lerp(ca.g, cb.g, d), 1, tipHot * 0.7) * base * (1 + tipHot * 1.4);
      lc[o + 5] = lerp(lerp(ca.b, cb.b, d), 1, tipHot * 0.7) * base * (1 + tipHot * 1.4);
    }
    linePosArr.needsUpdate = true; lineColArr.needsUpdate = true;

    // sparks (draw tips) + pulses
    const S = sparkPts.userData;
    for (let e = 0; e < E; e++) {
      const ed = edges[e], A = nodes[ed.a], B = nodes[ed.b], o = e * 3, on = ed.draw > 0 && ed.draw < 1;
      S.pos[o] = lerp(A.pos.x, B.pos.x, ed.draw); S.pos[o + 1] = lerp(A.pos.y, B.pos.y, ed.draw); S.pos[o + 2] = lerp(A.pos.z, B.pos.z, ed.draw);
      S.col[o] = 0.92; S.col[o + 1] = 0.9; S.col[o + 2] = 0.86; S.size[e] = on ? 6 : 0; S.alpha[e] = on ? 0.8 : 0;
    }
    for (let p = 0; p < PULSES; p++) {
      const pu = pulses[p];
      pu.t += dt * pu.sp;
      if (pu.t > 1) { pu.t = 0; pu.e = (Math.random() * E) | 0; pu.dir = Math.random() < 0.5; pu.sp = 0.25 + Math.random() * 0.5; }
      const ed = edges[pu.e], A = nodes[ed.a], B = nodes[ed.b], u = pu.dir ? pu.t : 1 - pu.t, idx = E + p, o = idx * 3;
      S.pos[o] = lerp(A.pos.x, B.pos.x, u); S.pos[o + 1] = lerp(A.pos.y, B.pos.y, u); S.pos[o + 2] = lerp(A.pos.z, B.pos.z, u);
      cTmp.copy(COL[A.c]).lerp(COL[B.c], u).lerp(white, 0.35);
      S.col[o] = cTmp.r; S.col[o + 1] = cTmp.g; S.col[o + 2] = cTmp.b;
      S.size[idx] = 4; S.alpha[idx] = pulseAmt * Math.sin(Math.PI * pu.t) * Math.min(1, ed.f) * 0.5;
    }
    S.flush();

    // halos
    const Hh = halo.userData;
    [hovered, selected].forEach((ix, s) => {
      const o = s * 3;
      if (ix < 0) { Hh.alpha[s] = 0; Hh.size[s] = 0; return; }
      const n = nodes[ix];
      Hh.pos[o] = n.pos.x; Hh.pos[o + 1] = n.pos.y; Hh.pos[o + 2] = n.pos.z;
      Hh.col[o] = COL[n.c].r; Hh.col[o + 1] = COL[n.c].g; Hh.col[o + 2] = COL[n.c].b;
      Hh.size[s] = 34 + Math.sin(t * 2) * 1.5; Hh.alpha[s] = s ? 0.5 : 0.38;
    });
    Hh.flush();

    // particles
    if (particles) {
      const U = partMat.uniforms; U.uTime.value = t;
      const hn = nodes[HERO]; U.uTarget.value.set(hn.sx, hn.sy);
    }
    if (scan) {
      const p = clamp((t - scan.t0) / scan.dur, 0, 1), y = scan.top + scan.h * p;
      scanEl.style.transform = `translate(${scan.left}px, ${y}px)`;
      chat.style.clipPath = `inset(${(y - scan.top) / scan.s}px -40px -40px -40px)`;
    }

    // cluster labels (nudged apart in screen space so they never collide)
    const L = [];
    for (let c = 0; c < CN.length; c++) {
      project(centroids[c].v, tmp);
      const el = clabels[c];
      el._w = el._w || el.offsetWidth;
      L.push({ el, c, x: tmp.x, y: tmp.y, z: tmp.z, w: el._w || 140 });
    }
    L.sort((a, b) => a.y - b.y);
    for (let i = 1; i < L.length; i++) for (let j = 0; j < i; j++) {
      const A = L[j], B = L[i];
      if (Math.abs(A.x - B.x) < (A.w + B.w) / 2 + 10 && B.y - A.y < 20) B.y = A.y + 20;
    }
    for (const l of L) {
      l.x = clamp(l.x, l.w / 2 + 10, W - l.w / 2 - 10);
      l.el.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -100%)`;
      const want = labelsOn * (l.z < 1 ? 1 : 0) * (1 - scrollP * 1.6);
      l.el.style.opacity = Math.max(0, want * ((fs && ![...fs].some((i) => nodes[i].c === l.c)) ? 0.15 : 1));
    }

    // ghost cards follow their node
    for (const g of ghosts) {
      const n = nodes[g.i];
      g.el.style.transform = `translate(${n.sx}px, ${n.sy}px) translate(-50%, -50%) scale(${g.s})`;
      g.el.style.opacity = g.o; g.el.style.filter = `blur(${g.b}px)`;
    }

    // tooltip follows hovered node
    if (hovered >= 0) placeTip(nodes[hovered]);
    tip.style.visibility = hovered >= 0 && hovered === selected ? 'hidden' : '';

    bg.material.uniforms.uDim.value = scrollP;
    composer.render();
  }
  gsap.ticker.add(frame);
  if (DEBUG) {
    // Deterministic stepping for headless/background capture: ?debug, then __cx.step(seconds).
    gsap.ticker.remove(gsap.updateRoot);
    clock.t = gsap.ticker.time;
    window.__cx = { pos: (i) => ({ x: nodes[i].sx, y: nodes[i].sy }), step(sec) { for (let k = Math.round(sec * 60); k > 0; k--) { clock.t += 1 / 60; gsap.updateRoot(clock.t); frame(); } return clock.t; } };
  }

  // ---------------- zoom to cursor ----------------
  let zoomPending = 0; const zc = { x: W / 2, y: H / 2 };
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  addEventListener('wheel', (e) => {
    if (mode !== 'live' || scrollY > 2) return;
    if (e.target.closest && e.target.closest('#panel, #searchResults, #content')) return;
    const dist = camera.position.distanceTo(controls.target);
    let dy = e.deltaY * (e.deltaMode === 1 ? 32 : 1);
    if (dy > 0 && dist >= maxD() - 0.05 && zoomPending >= -0.001) return; // fully out: let the page scroll
    e.preventDefault();
    zoomPending += clamp(dy, -140, 140) * 0.0024;
    zc.x = e.clientX; zc.y = e.clientY;
    controls.autoRotate = false; idleT = 0;
  }, { passive: false });
  const HOME = new THREE.Vector3();
  function applyZoom() {
    if (Math.abs(zoomPending) < 1e-4) { zoomPending = 0; return; }
    const step = zoomPending * 0.2; zoomPending -= step;
    const target = controls.target, dist = camera.position.distanceTo(target);
    const nd = clamp(dist * Math.exp(step), MIN_D, maxD());
    if (Math.abs(nd - dist) < 1e-5) { zoomPending = 0; return; }
    const dir = tmp.copy(camera.position).sub(target).normalize();
    if (nd < dist) {
      ndc.set(zc.x / W * 2 - 1, -(zc.y / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.setFromNormalAndCoplanarPoint(dir, target);
      if (ray.ray.intersectPlane(plane, hit)) {
        const s = nd / dist;
        camera.position.sub(hit).multiplyScalar(s).add(hit);
        target.sub(hit).multiplyScalar(s).add(hit);
        return;
      }
    } else {
      const frac = (nd - dist) / Math.max(1e-4, maxD() - dist);
      target.lerp(HOME, clamp(frac, 0, 1));
    }
    camera.position.copy(target).addScaledVector(dir, nd);
  }

  // ---------------- interaction ----------------
  let mouse = { x: -999, y: -999 }, downAt = null, idleT = 0;
  addEventListener('pointermove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (mode !== 'live' || scrollP > 0.3) return setHover(-1);
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) { downAt.moved = true; }
    if (e.target !== canvas) return setHover(-1);
    setHover(pick(e.clientX, e.clientY));
  });
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, moved: false }; controls.autoRotate = false; idleT = 0; });
  addEventListener('pointerup', (e) => {
    if (!downAt || mode !== 'live') { downAt = null; return; }
    const moved = downAt.moved; downAt = null;
    if (moved || e.target !== canvas) return;
    const i = pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 0);
    if (i >= 0) select(i); else if (selected >= 0) deselect();
    else if (clusterFocus >= 0) { clusterFocus = -1; legend.querySelectorAll('.lg').forEach((x) => x.classList.remove('on')); }
  });
  setInterval(() => { if (mode === 'live' && selected < 0 && !downAt) { idleT += 1; if (idleT > 6) controls.autoRotate = true; } }, 1000);

  function pick(x, y, extra = 0) {
    let best = -1, bd = 1e9;
    for (const n of nodes) {
      if (n.sz > 1 || n.vis < 0.5 || n.f < 0.5 && (focusSet || clusterFocus >= 0)) continue;
      const d = Math.hypot(n.sx - x, n.sy - y), r = Math.max(13, n.px * 0.3) + extra;
      if (d < r && d - (1 - n.sz) * 0.01 < bd) { bd = d; best = n.i; }
    }
    return best;
  }
  function setHover(i) {
    if (i === hovered) return;
    hovered = i;
    document.dispatchEvent(new CustomEvent('cortex:hover', { detail: i >= 0 ? PAL[nodes[i].c] : null }));
    if (i < 0) { gsap.to(tip, { opacity: 0, scale: 0.96, duration: 0.18, overwrite: true }); return; }
    const c = CH[i];
    tip.style.setProperty('--c', PAL[c.c]);
    tip.querySelector('.tip-cluster span').textContent = CN[c.c];
    tip.querySelector('.tip-title').textContent = c.title;
    tip.querySelector('.tip-meta').textContent = `${c.mc} messages`;
    tip.querySelector('.tip-summary').textContent = c.summary;
    tip.querySelector('.tip-tags').innerHTML = c.tags.slice(0, 4).map((x) => `<span>${x}</span>`).join('');
    placeTip(nodes[i]);
    gsap.fromTo(tip, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'power3.out', overwrite: true });
  }
  function placeTip(n) {
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = n.sx + 22, y = n.sy - 20;
    if (x + tw > W - 16) x = n.sx - tw - 22;
    if (y + th > H - 16) y = H - th - 16;
    tip.style.left = `${Math.max(12, x)}px`; tip.style.top = `${Math.max(70, y)}px`;
  }

  function fly(target, dist, dur = 1.4) {
    const dir = tmp.copy(camera.position).sub(controls.target).normalize().clone();
    const from = { tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, d: camera.position.distanceTo(controls.target) };
    const st = { k: 0 };
    zoomPending = 0;
    gsap.to(st, { k: 1, duration: dur, ease: 'power3.inOut', overwrite: true, onUpdate() {
      const e = st.k;
      controls.target.set(lerp(from.tx, target.x, e), lerp(from.ty, target.y, e), lerp(from.tz, target.z, e));
      const d = lerp(from.d, dist, e);
      camera.position.copy(controls.target).addScaledVector(dir, d);
    } });
  }
  function select(i) {
    selected = i; controls.autoRotate = false; idleT = -999;
    const c = CH[i];
    panel.style.setProperty('--c', PAL[c.c]);
    panel.querySelector('.panel-cluster').style.setProperty('--c', PAL[c.c]);
    panel.querySelector('.panel-cluster span').textContent = `${CN[c.c]} · ${c.mc} messages`;
    panel.querySelector('.panel-title').textContent = c.title;
    panel.querySelector('.panel-summary').textContent = c.summary;
    panel.querySelector('.panel-tags').innerHTML = c.tags.map((x) => `<span>${x}</span>`).join('');
    panel.querySelector('.panel-nb').innerHTML = c.nb.slice(0, 5).map(([j, s]) =>
      `<li data-j="${j}" style="--c:${PAL[CH[j].c]};--w:${Math.round(s * 100)}%"><i></i><span>${CH[j].title}${CH[j].title === c.title ? '<small>same chat, again</small>' : ''}</span><em></em></li>`).join('');
    panel.classList.add('on');
    fly(nodes[i].umap, 13);
  }
  function deselect() {
    selected = -1; panel.classList.remove('on'); idleT = 0;
    fly(HOME, maxD(), 1.6);
  }
  panel.addEventListener('click', (e) => { const li = e.target.closest('li[data-j]'); if (li) select(+li.dataset.j); });
  $('#panelClose').addEventListener('click', deselect);

  // search
  const sInput = $('#searchInput'), sRes = $('#searchResults');
  let sItems = [], sAct = 0;
  sInput.addEventListener('input', runSearch);
  sInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sAct = clamp(sAct + (e.key === 'ArrowDown' ? 1 : -1), 0, sItems.length - 1); paintRes(); }
    if (e.key === 'Enter' && sItems[sAct]) { select(sItems[sAct].ids[0]); sInput.blur(); }
    if (e.key === 'Escape') { sInput.value = ''; runSearch(); sInput.blur(); }
  });
  sRes.addEventListener('pointerdown', (e) => { const r = e.target.closest('.sr'); if (r) { e.preventDefault(); select(+r.dataset.i); sInput.blur(); } });
  sInput.addEventListener('blur', () => setTimeout(() => sRes.classList.remove('on'), 120));
  sInput.addEventListener('focus', () => { if (sInput.value.trim()) sRes.classList.add('on'); });
  function runSearch() {
    const q = sInput.value.toLowerCase().trim();
    if (!q) { focusSet = null; sRes.classList.remove('on'); sItems = []; return; }
    const toks = q.split(/[^a-z0-9+#.]+/).filter((x) => x.length > 1);
    const by = new Map();
    CH.forEach((c, i) => {
      const title = c.title.toLowerCase(), tags = c.tags.join(' ').toLowerCase(), sum = c.summary.toLowerCase();
      let s = 0; for (const t of toks) s += (title.includes(t) ? 3 : 0) + (tags.includes(t) ? 2 : 0) + (sum.includes(t) ? 1 : 0);
      if (title.includes(q)) s += 4;
      if (s <= 0) return;
      const g = by.get(c.title) || { title: c.title, c: c.c, s: 0, ids: [] };
      g.s = Math.max(g.s, s); g.ids.push(i); by.set(c.title, g);
    });
    sItems = [...by.values()].sort((a, b) => b.s - a.s).slice(0, 6); sAct = 0;
    focusSet = new Set(sItems.flatMap((g) => g.ids));
    if (!sItems.length) focusSet = new Set();
    paintRes(); sRes.classList.add('on');
  }
  function paintRes() {
    sRes.innerHTML = sItems.length ? sItems.map((g, k) => `<div class="sr${k === sAct ? ' act' : ''}" data-i="${g.ids[0]}" style="--c:${PAL[g.c]}"><i></i><span>${g.title}</span>${g.ids.length > 1 ? `<b>×${g.ids.length}</b>` : ''}</div>`).join('')
      : '<div class="sr-empty">Nothing in memory matches that yet.</div>';
  }
  addEventListener('keydown', (e) => {
    if (e.key === '/' && mode === 'live' && document.activeElement !== sInput) { e.preventDefault(); scrollTo({ top: 0 }); sInput.focus(); }
    if (e.key === 'Escape') {
      if (mode === 'intro' && introTL) skip();
      else if (selected >= 0) deselect();
    }
  });

  // ---------------- scroll coupling ----------------
  const shade = $('#shade');
  const heroUI = ['#heroCopy', '#legend', '#hint', '#search', '#scrollCue'].map((s) => $(s));
  addEventListener('scroll', () => {
    scrollP = clamp(scrollY / H, 0, 1);
    shade.style.opacity = Math.min(1, scrollP * 1.15);
    if (mode === 'live') heroUI.forEach((el) => { el.style.opacity = Math.max(0, 1 - scrollP * 2.2); el.style.visibility = scrollP > 0.48 ? 'hidden' : ''; });
    if (scrollP > 0.3 && selected >= 0) deselect();
    if (scrollP > 0.1) setHover(-1);
  }, { passive: true });

  // ---------------- resize ----------------
  addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H); bloom.resolution.set(W, H);
    lineMat.resolution.set(W, H); partMat.uniforms.uRes.value.set(W, H);
    bg.material.uniforms.uAsp.value = W / H;
    if (mode === 'live') rig.shift = desktopShift();
    applyShift();
  });

  // =====================================================================
  //                               THE FILM
  // =====================================================================
  const ghosts = [];
  const stageZ = { px: 0, py: 0, s: 1 };
  function applyStage() {
    const cx = W / 2, cy = H / 2, s = stageZ.s;
    const m = clamp((s - 1) / 0.5, 0, 1) * 0.62;
    const qx = stageZ.px + (cx - stageZ.px) * m, qy = stageZ.py + (cy - stageZ.py) * m;
    stage.style.transform = s === 1 ? 'none' : `translate(${qx - s * stageZ.px}px, ${qy - s * stageZ.py}px) scale(${s})`;
  }
  function clickAt(x, y) {
    gsap.fromTo(ring, { x, y, scale: 0.35, opacity: 1 }, { scale: 1.5, opacity: 0, duration: 0.55, ease: 'power2.out' });
    gsap.fromTo(fcur, { scale: 1 }, { scale: 0.86, duration: 0.09, yoyo: true, repeat: 1, transformOrigin: '20% 12%' });
  }
  function caption(tl, at, text) {
    tl.call(() => {
      captionEl.innerHTML = text.split(' ').map((w) => `<span class="w">${w} </span>`).join('');
      gsap.fromTo(captionEl.children, { opacity: 0, y: 18, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, stagger: 0.06, ease: 'power3.out' });
    }, null, at);
  }
  function captionOut(tl, at) {
    tl.call(() => gsap.to(captionEl.children, { opacity: 0, y: -12, filter: 'blur(6px)', duration: 0.45, stagger: 0.03, ease: 'power2.in' }), null, at);
  }
  function shockwave(x, y, color = 'rgba(236,232,225,.55)') {
    for (let k = 0; k < 1; k++) {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: '24px', height: '24px', margin: '-12px 0 0 -12px', borderRadius: '50%', border: `1px solid ${color}`, pointerEvents: 'none', zIndex: 5 });
      $('#hero').appendChild(d);
      gsap.fromTo(d, { scale: 0.2, opacity: 1 }, { scale: 14, opacity: 0, duration: 1.4, delay: k * 0.1, ease: 'expo.out', onComplete: () => d.remove() });
    }
  }
  let spawned = 0;
  function spawn(i, big = false) {
    const n = nodes[i];
    gsap.fromTo(n, { vis: 0 }, { vis: 1, duration: big ? 0.9 : 0.55, ease: 'back.out(3)' });
    n.flash = big ? 2.4 : 1.6;
    spawned++; counterN.textContent = spawned;
  }
  function wrapWords(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
    while (tw.nextNode()) list.push(tw.currentNode);
    for (const t of list) {
      const frag = document.createDocumentFragment();
      t.data.split(/(\s+)/).forEach((w) => {
        if (!w) return;
        if (/^\s+$/.test(w)) frag.appendChild(document.createTextNode(w));
        else { const s = document.createElement('span'); s.className = 'wd'; s.textContent = w; frag.appendChild(s); }
      });
      t.replaceWith(frag);
    }
    return [...root.querySelectorAll('.wd')];
  }

  function resetFilm() {
    dropParticles(); scan = null;
    ghosts.splice(0).forEach((g) => { g.tl.kill(); g.el.remove(); });
    body.querySelectorAll('.msg-u, .msg-a, .thinking').forEach((e) => e.remove());
    empty.style.display = ''; empty.style.opacity = 1;
    typed.textContent = ''; ph.style.display = ''; caret.style.display = 'none'; send.classList.remove('ready');
    chat.style.clipPath = ''; gsap.set(chat, { clearProps: 'all' }); gsap.set(stage, { display: '', opacity: 1 });
    stageZ.s = 1; applyStage();
    gsap.set([fcur, ring, scanEl, landing, counter], { opacity: 0 });
    captionEl.innerHTML = '';
    nodes.forEach((n) => { n.fly = 0; n.vis = 0; n.flash = 0; n.cmix = n.i === HERO ? 1 : 0; n.hist.forEach((h) => h.copy(n.chaos)); });
    edges.forEach((e) => { e.draw = 0; });
    trailAmt = 0; pulseAmt = 0; labelsOn = 0; spawned = 0; counterN.textContent = '0';
    bloom.strength = BLOOM;
    const hn = nodes[HERO].umap;
    Object.assign(rig, { tx: hn.x, ty: hn.y, tz: hn.z, d: 6.5, az: AZ_F - 1.5, el: 0.08, shift: 0 });
    applyShift(); applyRig();
  }

  function buildFilm() {
    resetFilm();
    const tl = gsap.timeline({ onComplete: goLive });
    // measure the settled layout
    const ir = $('.chat-field').getBoundingClientRect(), sr = send.getBoundingClientRect();
    const inX = ir.left + 6, inY = ir.top + ir.height / 2, sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const ctip = (x, y) => ({ x: x - 5.4, y: y - 3.4 });

    // ---- Act I: the chat ----
    tl.fromTo(chat, { opacity: 0, y: 34, scale: 0.965, filter: 'blur(10px)' }, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 1.0, ease: 'power3.out' }, 0.15);
    tl.set(fcur, { ...ctip(W * 0.82, H * 0.95), opacity: 0 }, 0);
    tl.to(fcur, { opacity: 1, duration: 0.3 }, 0.55);
    tl.to(fcur, { ...ctip(inX + 4, inY), duration: 1.0, ease: 'power3.inOut' }, 0.55);
    stageZ.px = inX + (W < 700 ? ir.width * 0.3 : 110); stageZ.py = inY; stageZ.s = 1;
    tl.to(stageZ, { s: W < 700 ? 1.15 : 1.5, duration: 1.2, ease: 'power3.inOut', onUpdate: applyStage }, 0.6);
    tl.call(() => { clickAt(inX + 4, inY); ph.style.display = 'none'; caret.style.display = 'inline-block'; }, null, 1.6);
    let tt = 1.8;
    const jitter = rng(3);
    for (let c = 0; c < PROMPT.length; c++) {
      const ch = PROMPT[c];
      tl.call(() => { typed.textContent = PROMPT.slice(0, c + 1); if (c === 0) send.classList.add('ready'); }, null, tt);
      tt += 0.026 + jitter() * 0.03 + (ch === ' ' ? 0.025 : 0);
    }
    tl.to(stageZ, { px: inX + Math.min(ir.width * (W < 700 ? 0.7 : 1) - 60, 470), duration: tt - 1.8, ease: 'none', onUpdate: applyStage }, 1.8);
    tl.to(fcur, { ...ctip(sx, sy), duration: 0.5, ease: 'power3.inOut' }, tt + 0.15);
    const sendAt = tt + 0.7;
    tl.call(() => clickAt(sx, sy), null, sendAt);
    tl.to(stageZ, { s: 1, px: W / 2, py: H / 2, duration: 1.0, ease: 'power3.inOut', onUpdate: applyStage }, sendAt + 0.05);
    tl.to(fcur, { ...ctip(sx + 120, sy + 160), opacity: 0, duration: 0.7, ease: 'power2.in' }, sendAt + 0.3);
    tl.call(() => {
      typed.textContent = ''; caret.style.display = 'none'; ph.style.display = ''; send.classList.remove('ready');
      empty.style.display = 'none';
      const u = document.createElement('div'); u.className = 'msg-u'; u.textContent = PROMPT; body.appendChild(u);
      gsap.from(u, { opacity: 0, y: 14, duration: 0.45, ease: 'power3.out' });
      const th = document.createElement('div'); th.className = 'thinking'; body.appendChild(th);
    }, null, sendAt + 0.1);
    const replyAt = sendAt + 0.85;
    let words = [];
    tl.call(() => {
      body.querySelector('.thinking')?.remove();
      const a = document.createElement('div'); a.className = 'msg-a'; a.innerHTML = REPLY; body.appendChild(a);
      words = wrapWords(a);
      a.querySelectorAll('li').forEach((li) => (li.style.opacity = 0));
    }, null, replyAt);
    const WN = REPLY.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    for (let w = 0; w < WN; w++) {
      tl.call(() => { const s = words[w]; if (!s) return; s.classList.add('on'); const li = s.closest('li'); if (li) li.style.opacity = 1; }, null, replyAt + 0.05 + w * 0.042);
    }

    // ---- Act II: compression ----
    const dis = replyAt + WN * 0.042 + 0.6;
    const SCAN = 1.25;
    tl.call(() => {
      const res = rasterizeChat();
      particles = res.p; scene.add(particles);
      const r = res.rect, t0 = now();
      const U = partMat.uniforms;
      U.uScanT0.value = t0; U.uScanDur.value = SCAN; U.uTop.value = r.top; U.uH.value = r.height; U.uCollapse.value = 0; U.uFade.value = 1;
      scan = { t0, dur: SCAN, top: r.top, h: r.height, left: r.left - 20, s: 1 };
      scanEl.style.width = `${r.width + 40}px`;
      gsap.to(scanEl, { opacity: 1, duration: 0.15 });
    }, null, dis);
    tl.call(() => { gsap.to(scanEl, { opacity: 0, duration: 0.25 }); chat.style.opacity = 0; scan = null; }, null, dis + SCAN + 0.02);
    const col = dis + SCAN + 0.35;
    tl.to(partMat.uniforms.uCollapse, { value: 1, duration: 1.55, ease: 'none' }, col);
    const land = col + 1.25;
    tl.call(() => {
      spawn(HERO, true);
      const n = nodes[HERO]; shockwave(n.sx, n.sy);
      gsap.fromTo(bloom, { strength: 0.9 }, { strength: BLOOM, duration: 1.6, ease: 'power2.out' });
    }, null, land);
    tl.call(dropParticles, null, col + 1.6);
    tl.call(() => {
      gsap.fromTo(landing, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
    }, null, land + 0.25);

    // ---- Act III: more memories ----
    const pull = land + 1.5;
    tl.to(landing, { opacity: 0, duration: 0.4 }, pull);
    tl.to(rig, { d: maxD() + 4, tx: 0, ty: 0, tz: 0, az: AZ_F - 0.75, el: 0.2, duration: 4.6, ease: 'power2.inOut' }, pull);
    caption(tl, pull + 0.3, 'Every conversation becomes a point.');
    tl.to(counter, { opacity: 1, duration: 0.5 }, pull + 0.4);
    const others = nodes.filter((n) => n.i !== HERO).map((n) => n.i).sort(() => R() - 0.5);
    const taken = new Set();
    const nextFree = () => others.find((i) => !taken.has(i));
    const pickVisible = () => {
      const titles = new Set([...taken].map((i) => CH[i].title).concat(CH[HERO].title));
      const ok = others.filter((i) => {
        const n = nodes[i];
        return !taken.has(i) && !titles.has(CH[i].title) && n.sz < 1 && n.sx > W * 0.14 && n.sx < W * 0.86 && n.sy > H * 0.2 && n.sy < H * 0.85 &&
          camera.position.distanceTo(n.pos) > 9;
      });
      return ok.length ? ok[0] : nextFree();
    };
    const GHOSTS = 7;
    let gt = pull + 1.0;
    for (let k = 0; k < GHOSTS; k++) {
      tl.call(() => {
        const i = pickVisible(); if (i === undefined) return; taken.add(i);
        const el = document.createElement('div'); el.className = 'ghost';
        el.innerHTML = `<b>${CH[i].title}</b><span class="gu"></span><i></i><i></i>`;
        ghostsEl.appendChild(el);
        const g = { i, el, s: 0.55, o: 0, b: 8 }; ghosts.push(g);
        g.tl = gsap.timeline()
          .to(g, { s: 1, o: 1, b: 0, duration: 0.3, ease: 'power3.out' })
          .to(g, { s: 0.04, o: 0, b: 5, duration: 0.32, ease: 'power3.in' }, 0.5)
          .call(() => { spawn(i); el.remove(); const at = ghosts.indexOf(g); if (at >= 0) ghosts.splice(at, 1); });
      }, null, gt);
      gt += Math.max(0.16, 0.42 - k * 0.05);
    }
    const restN = others.length - GHOSTS;
    const rapid0 = gt + 0.55, RAP = 1.5;
    for (let k = 0; k < restN; k++) tl.call(() => { const i = nextFree(); if (i === undefined) return; taken.add(i); spawn(i); }, null, rapid0 + RAP * Math.pow(k / restN, 0.75));

    // ---- Act IV: clustering ----
    const cl = rapid0 + RAP + 0.35;
    captionOut(tl, cl - 0.3);
    caption(tl, cl + 0.25, 'Similar thoughts find each other.');
    tl.call(() => { trailAmt = 1; }, null, cl);
    nodes.forEach((n) => {
      if (n.i === HERO) return;
      const delay = R() * 0.55 + n.c * 0.06;
      tl.to(n, { fly: 1, duration: 2.1, ease: 'power3.inOut' }, cl + delay);
      tl.to(n, { cmix: 1, duration: 1.4, ease: 'power2.inOut' }, cl + delay + 0.5);
    });
    tl.to(rig, { d: maxD(), az: AZ_F - 0.25, el: EL_F - 0.05, duration: 3.2, ease: 'power2.inOut' }, cl);
    tl.to(counter, { opacity: 0, duration: 0.6 }, cl + 1.6);
    tl.to({ v: 1 }, { v: 0, duration: 0.9, onUpdate() { trailAmt = this.targets()[0].v; } }, cl + 2.5);
    tl.to({ v: 0 }, { v: 1, duration: 1.0, onUpdate() { labelsOn = this.targets()[0].v; } }, cl + 2.4);

    // ---- Act V: connections ----
    const ed = cl + 3.0;
    captionOut(tl, ed - 0.2);
    caption(tl, ed + 0.3, 'And then it all connects.');
    const maxDepth = Math.max(...edges.map((e) => e.depth));
    edges.forEach((e) => {
      const at = ed + e.depth * (2.1 / Math.max(1, maxDepth)) + R() * 0.15;
      tl.to(e, { draw: 1, duration: 0.6, ease: 'power2.inOut', onComplete: () => { nodes[e.b].flash = Math.max(nodes[e.b].flash, 0.8); } }, at);
    });
    tl.to(rig, { az: AZ_F + 0.2, el: EL_F, duration: 3.4, ease: 'sine.inOut' }, ed);
    const fin = ed + 2.9;
    tl.to({ v: 0 }, { v: 1, duration: 1.5, onUpdate() { pulseAmt = this.targets()[0].v; } }, fin - 0.5);

    // ---- Act VI: it's yours ----
    captionOut(tl, fin);
    tl.to(rig, { az: AZ_F, shift: desktopShift(), duration: 1.8, ease: 'power3.inOut', onUpdate: applyShift }, fin);
    tl.call(() => revealUI(), null, fin + 0.3);
    tl.to({}, { duration: 0.01 }, fin + 1.8);
    return tl;
  }

  function revealUI(fast = false) {
    const d = fast ? 0.5 : 1;
    gsap.to('#nav', { opacity: 1, duration: 0.8 * d });
    gsap.fromTo('.wordmark span', { y: 0, yPercent: 110 }, { y: 0, yPercent: 0, duration: 1.1 * d, stagger: 0.055, ease: 'expo.out' });
    gsap.fromTo('.eyebrow', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, delay: 0.25 * d });
    gsap.fromTo('.tagline', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9, delay: 0.4 * d, ease: 'power3.out' });
    gsap.fromTo(['#search', '#legend', '#hint', '#scrollCue', '#replay'], { opacity: 0 }, { opacity: 1, duration: 0.9, delay: 0.7 * d, stagger: 0.08 });
    gsap.to('#skip', { opacity: 0, duration: 0.3 });
    labelsOn = 1;
  }

  function goLive() {
    introTL = null; mode = 'live';
    rig.shift = desktopShift(); applyShift(); applyRig();
    controls.target.set(rig.tx, rig.ty, rig.tz);
    controls.enabled = true; controls.autoRotate = true; idleT = 0;
    controls.update();
    gsap.set(stage, { display: 'none' });
    document.body.classList.remove('is-intro'); document.body.classList.add('is-live');
    ['#search', '#legend', '#scrollCue', '#replay'].forEach((s) => ($(s).style.pointerEvents = 'auto'));
    document.dispatchEvent(new Event('cortex:live'));
  }

  function skip() {
    if (!introTL) return;
    introTL.kill(); introTL = null;
    gsap.killTweensOf([fcur, ring, chat, landing, counter, scanEl, stageZ, rig, partMat.uniforms.uCollapse, ...nodes, ...edges]);
    dropParticles(); scan = null;
    ghosts.splice(0).forEach((g) => { g.tl.kill(); g.el.remove(); });
    gsap.to([stage, scanEl, landing, counter, captionEl], { opacity: 0, duration: 0.4 });
    nodes.forEach((n) => { n.fly = 1; n.vis = 1; n.cmix = 1; n.flash = 0.6; });
    edges.forEach((e) => { e.draw = 1; });
    trailAmt = 0; pulseAmt = 1; bloom.strength = BLOOM;
    gsap.to(rig, { tx: 0, ty: 0, tz: 0, d: maxD(), az: AZ_F, el: EL_F, shift: desktopShift(), duration: 1.2, ease: 'power3.inOut', onUpdate: applyShift, onComplete: goLive });
    revealUI(true);
  }
  $('#skip').addEventListener('click', skip);

  function play() {
    mode = 'intro'; controls.enabled = false; controls.autoRotate = false;
    if (selected >= 0) { selected = -1; panel.classList.remove('on'); }
    setHover(-1); sInput.value = ''; runSearch(); clusterFocus = -1;
    document.body.classList.add('is-intro'); document.body.classList.remove('is-live');
    gsap.set(['#nav', '.eyebrow', '.tagline', '#search', '#legend', '#hint', '#scrollCue', '#replay'], { opacity: 0 });
    heroUI.forEach((el) => { el.style.opacity = ''; el.style.visibility = ''; });
    ['#search', '#legend', '#scrollCue', '#replay'].forEach((s) => ($(s).style.pointerEvents = 'none'));
    gsap.set('.wordmark span', { y: 0, yPercent: 110 });
    gsap.to('#skip', { opacity: 1, duration: 0.6, delay: 1.2 });
    introTL = buildFilm();
  }
  $('#replay').addEventListener('click', () => { scrollTo({ top: 0 }); play(); });

  // Rewind the camera to the hero frame when someone jumps back up via the CTA.
  $('#backToGraph').addEventListener('click', (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); });

  if (reduced) {
    resetFilm();
    nodes.forEach((n) => { n.fly = 1; n.vis = 1; n.cmix = 1; });
    edges.forEach((e) => { e.draw = 1; });
    Object.assign(rig, { tx: 0, ty: 0, tz: 0, d: maxD(), az: AZ_F, el: EL_F, shift: desktopShift() });
    applyShift(); gsap.set(stage, { display: 'none' }); pulseAmt = 0.6;
    revealUI(true); goLive();
  } else {
    scrollTo(0, 0);
    play();
  }
}
