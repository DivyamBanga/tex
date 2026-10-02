const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PAL = ['#E6DFD3', '#C79A8B', '#9FB39A', '#C8AE82', '#9AA6BC'];
const INK = '#ECE8E1';
const fine = matchMedia('(pointer: fine)').matches;

export function initUI(dataPromise) {
  gsap.registerPlugin(ScrollTrigger);
  cursor();
  splitScrub();
  problem();
  dataPromise.then(how);
  capabilities();
  demo();
  stack();
  team();
  cta();
  $$('.sec-tag').forEach((el) => ScrollTrigger.create({ trigger: el, start: 'top 88%', onEnter: () => el.classList.add('in') }));
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href'); if (id.length < 2 || a.id === 'backToGraph') return;
    const t = $(id); if (!t) return; e.preventDefault();
    scrollTo({ top: id === '#hero' ? 0 : t.getBoundingClientRect().top + scrollY - 20, behavior: 'smooth' });
  }));
  document.addEventListener('cortex:live', () => ScrollTrigger.refresh());
  const onScroll = () => document.body.classList.toggle('scrolled', scrollY > innerHeight * 0.6);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

// ---------------- custom cursor ----------------
function cursor() {
  if (!fine) return;
  const c = $('#cursor'), dot = $('.c-dot', c), ring = $('.c-ring', c);
  document.body.classList.add('has-cursor');
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, shown = false;
  addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    if (!shown) { shown = true; rx = x; ry = y; c.style.opacity = 1; }
    const hot = e.target.closest && e.target.closest('a, button, input, .card, .lg, .sr, .panel-nb li');
    c.classList.toggle('hover', !!hot || graphHot);
    if (hot) c.style.removeProperty('--rc');
  });
  let graphHot = false;
  document.addEventListener('cortex:hover', (e) => {
    graphHot = !!e.detail; c.classList.toggle('hover', graphHot);
    if (e.detail) c.style.setProperty('--rc', e.detail); else c.style.removeProperty('--rc');
  });
  addEventListener('pointerdown', () => c.classList.add('down'));
  addEventListener('pointerup', () => c.classList.remove('down'));
  document.addEventListener('pointerleave', () => { c.style.opacity = 0; shown = false; });
  gsap.ticker.add(() => {
    rx = lerp(rx, x, 0.2); ry = lerp(ry, y, 0.2);
    dot.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
  });
}

// ---------------- word scrubbing ----------------
function splitWords(root) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
  while (tw.nextNode()) list.push(tw.currentNode);
  for (const t of list) {
    const f = document.createDocumentFragment();
    t.data.split(/(\s+)/).forEach((w) => {
      if (!w) return;
      if (/^\s+$/.test(w)) f.appendChild(document.createTextNode(w));
      else { const s = document.createElement('span'); s.className = 'w'; s.textContent = w; f.appendChild(s); }
    });
    t.replaceWith(f);
  }
  return $$('.w', root);
}
function splitScrub() {
  $$('[data-scrub]').forEach((el) => {
    const words = splitWords(el);
    gsap.to(words, { opacity: 1, stagger: 0.12, ease: 'none', scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 42%', scrub: 0.6 } });
  });
}

// ---------------- 01 problem ----------------
function problem() {
  const cards = $$('.dupe');
  const spread = () => Math.min(385, innerWidth * 0.28);
  gsap.set(cards, { y: (i) => i * -10, scale: (i) => 1 - (2 - i) * 0.04, rotate: 0 });
  const tl = gsap.timeline({ scrollTrigger: { trigger: '#dupes', start: 'top 85%', end: 'center 45%', scrub: 0.8, invalidateOnRefresh: true } });
  tl.to(cards, { x: (i) => (i - 1) * spread(), y: (i) => (i === 1 ? -14 : 26), rotate: (i) => (i - 1) * 6, scale: 1, ease: 'power2.out', duration: 1 }, 0)
    .fromTo('#dupeCount', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, 0.3);
  gsap.fromTo('.amnesia .a1', { '--k': 0 }, { '--k': 1, ease: 'none', scrollTrigger: { trigger: '.amnesia', start: 'top 80%', end: 'top 50%', scrub: 0.5 } });
  gsap.fromTo('.amnesia .a2', { clipPath: 'inset(0 100% 0 0)', opacity: 0.4 }, { clipPath: 'inset(0 0% 0 0)', opacity: 1, ease: 'power2.out', scrollTrigger: { trigger: '.amnesia', start: 'top 62%', end: 'top 30%', scrub: 0.6 } });
}

// ---------------- 02 how (pinned, morphing dots = the real 76 chats) ----------------
function how(data) {
  const chats = data.chats, N = chats.length;
  const cv = $('#howCanvas'), g = cv.getContext('2d'), steps = $$('#howSteps li'), bar = $('#howBar'), readout = $('#howReadout');
  const READ = [
    ['Your export', '76 conversations'],
    ['One vector per chat', '768 dimensions'],
    ['Folded into space', '3 dimensions'],
    ['Grouped by meaning', '5 topics'],
    ['Claude asks Cortex', '3 memories found'],
  ];
  let w = 0, h = 0, dpr = 1;
  const size = () => { const r = cv.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height; cv.width = w * dpr; cv.height = h * dpr; };
  size(); addEventListener('resize', size);
  const rand = (() => { let s = 9; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const seeds = chats.map(() => ({ bw: 0.3 + rand() * 0.7, v: rand(), ph: rand() * 6.28 }));
  let prog = 0, cur = -1;
  const st = ScrollTrigger.create({
    trigger: '.how-pin', start: 'top top', end: () => `+=${innerHeight * (innerWidth > 900 ? 4 : 3)}`, pin: true, scrub: true, anticipatePin: 1,
    onUpdate: (s) => { prog = s.progress; },
  });
  // Steps are also clickable: jump the scroll to that step.
  steps.forEach((li, i) => li.addEventListener('click', () => scrollTo({ top: st.start + (st.end - st.start) * ((i + 0.5) / 5), behavior: 'smooth' })));

  function layout(step, i, t) {
    const s = seeds[i], cx = w / 2, cy = h / 2, m = Math.min(w, h);
    if (step === 0) { // a chat export: two columns of message lines
      const col = i < 38 ? 0 : 1, row = i % 38;
      const lw = m * 0.34 * s.bw, x0 = cx - m * 0.36 + col * m * 0.38;
      const user = row % 5 === 0;
      return { x: (user ? x0 + m * 0.34 - lw : x0) + lw / 2, y: cy - m * 0.36 + row * (m * 0.72 / 37), w: lw, h: m * 0.009, r: 2, c: INK, a: user ? 0.75 : 0.28 };
    }
    if (step === 1) { // the embedding: a heatmap of vector components
      const cols = 12, r = Math.floor(i / cols), c = i % cols, cell = m * 0.052;
      const v = 0.5 + 0.5 * Math.sin(t * 1.4 + s.ph + c * 0.4);
      return { x: cx + (c - (cols - 1) / 2) * cell * 1.18, y: cy + (r - 3) * cell * 1.18, w: cell, h: cell, r: 3, c: INK, a: 0.06 + 0.6 * v };
    }
    // 3D: real UMAP coordinates, slowly rotating
    const p = chats[i].p, ang = t * 0.25 + step * 0.4, ca = Math.cos(ang), sa = Math.sin(ang);
    const x = p[0] * ca - p[2] * sa, z = p[0] * sa + p[2] * ca, y = p[1];
    const sc = m * 0.042, persp = 1 / (1 + z * 0.03);
    const col = step === 2 ? INK : PAL[chats[i].c];
    let a = step === 2 ? 0.7 : 0.85;
    if (step === 4) a = [8, 7, 10, 28, 46].includes(i) ? 1 : 0.18;
    return { x: cx + x * sc * persp, y: cy - y * sc * persp, w: 5.5 * persp, h: 5.5 * persp, r: 99, c: col, a, z };
  }

  function draw() {
    if (!w) return;
    const t = gsap.ticker.time, p = prog * 5, s = Math.min(4, Math.floor(p)), l = p - s;
    if (s !== cur) {
      cur = s;
      steps.forEach((li, i) => li.classList.toggle('on', i === s));
      readout.innerHTML = `<span>${READ[s][0]}</span><span>${READ[s][1]}</span>`;
    }
    bar.style.transform = `scaleX(${prog})`;
    const k = s < 4 ? smooth(0.62, 0.98, l) : 0;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // axes for 3D steps
    if (s >= 2 || k > 0 && s === 1) {
      const aa = s >= 2 ? 1 : k, m = Math.min(w, h);
      g.strokeStyle = `rgba(236,232,225,${0.07 * aa})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(w / 2 - m * 0.4, h / 2); g.lineTo(w / 2 + m * 0.4, h / 2); g.moveTo(w / 2, h / 2 - m * 0.4); g.lineTo(w / 2, h / 2 + m * 0.4); g.stroke();
    }
    const pts = [];
    for (let i = 0; i < N; i++) {
      const A = layout(s, i, t), B = s < 4 ? layout(s + 1, i, t) : A;
      const q = { x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), w: lerp(A.w, B.w, k), h: lerp(A.h, B.h, k), r: lerp(Math.min(A.r, A.h / 2, A.w / 2), Math.min(B.r, B.h / 2, B.w / 2), k), a: lerp(A.a, B.a, k), c: k < 0.5 ? A.c : B.c, i };
      pts.push(q);
    }
    // recall step: query beam + links to the hits
    if (s === 4) {
      const hub = { x: w * 0.14, y: h * 0.16 };
      g.font = `400 12px "Bricolage Grotesque", sans-serif`; g.fillStyle = 'rgba(236,232,225,.6)'; g.fillText('Claude', hub.x - 18, hub.y - 14);
      g.beginPath(); g.arc(hub.x, hub.y, 3.5, 0, 7); g.fillStyle = INK; g.fill();
      [8, 7, 10].forEach((i, n) => {
        const q = pts[i], e = smooth(0.05 + n * 0.12, 0.45 + n * 0.12, l);
        g.strokeStyle = `rgba(236,232,225,${0.45 * e})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(hub.x, hub.y); g.lineTo(lerp(hub.x, q.x, e), lerp(hub.y, q.y, e)); g.stroke();
        if (e > 0.98) { g.beginPath(); g.arc(q.x, q.y, 10, 0, 7); g.strokeStyle = 'rgba(236,232,225,.35)'; g.stroke(); }
      });
    }
    // edges in cluster step
    if (s === 3) {
      g.lineWidth = 1;
      chats.forEach((c, i) => c.nb.slice(0, 2).forEach(([j]) => {
        const A = pts[i], B = pts[j]; g.strokeStyle = PAL[c.c]; g.globalAlpha = 0.14 * (1 - k);
        g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      }));
      g.globalAlpha = 1;
    }
    for (const q of pts) {
      g.globalAlpha = q.a; g.fillStyle = q.c;
      g.beginPath(); g.roundRect(q.x - q.w / 2, q.y - q.h / 2, q.w, q.h, q.r); g.fill();
    }
    g.globalAlpha = 1;
  }
  let visible = false;
  ScrollTrigger.create({ trigger: '#how', start: 'top bottom', end: 'bottom top', onToggle: (s) => (visible = s.isActive) });
  gsap.ticker.add(() => { if (visible) draw(); });
  draw();
}

// ---------------- 03 capabilities ----------------
function capabilities() {
  $$('.card').forEach((c) => c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));
  gsap.from('.card', { y: 60, opacity: 0, duration: 1.1, stagger: 0.09, ease: 'power3.out', scrollTrigger: { trigger: '.bento', start: 'top 82%' } });
  gsap.from('#capabilities .sec-h', { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '#capabilities .sec-h', start: 'top 85%' } });

  // search demo
  const q = 'how do i stop forgetting what i study', qEl = $('.ds-q'), rows = $$('.ds-res li');
  const runSearch = () => {
    const tl = gsap.timeline();
    qEl.textContent = ''; gsap.set(rows, { opacity: 0, y: 8 });
    [...q].forEach((ch, i) => tl.call(() => { qEl.textContent = q.slice(0, i + 1); }, null, 0.3 + i * 0.045));
    tl.to(rows, { opacity: 1, y: 0, duration: 0.5, stagger: 0.09, ease: 'power3.out' }, 0.3 + q.length * 0.045 + 0.25);
    return tl;
  };
  ScrollTrigger.create({ trigger: '.card-search', start: 'top 70%', once: true, onEnter: runSearch });

  // MCP demo
  const reply = 'Picking up from your RBC keyword checklist: SQL, pandas, Tableau. Here are your top three bullets, rewritten in that language…';
  const runMcp = () => {
    const tl = gsap.timeline(), txt = $('.dm-text'), spin = $('.dm-th .spin');
    tl.to('.dm-u', { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2)
      .to('.dm-tool', { opacity: 1, duration: 0.4 }, 0.9)
      .to('.dm-row', { opacity: 1, duration: 0.4, stagger: 0.22 }, 1.5)
      .call(() => spin.classList.add('done'), null, 2.3)
      .to('.dm-a .av', { opacity: 1, duration: 0.3 }, 2.4);
    const words = reply.split(' ');
    words.forEach((_, i) => tl.call(() => { txt.textContent = words.slice(0, i + 1).join(' '); }, null, 2.6 + i * 0.05));
  };
  gsap.set('.dm-u', { y: 10 });
  ScrollTrigger.create({ trigger: '.card-mcp', start: 'top 70%', once: true, onEnter: runMcp });

  // count-ups
  $$('[data-count]').forEach((el) => {
    const to = +el.dataset.count; if (!to) return;
    const o = { v: 0 }; el.textContent = '0';
    ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => gsap.to(o, { v: to, duration: 1.6, ease: 'expo.out', onUpdate: () => (el.textContent = Math.round(o.v)) }) });
  });
  gsap.from('.pack > span, .pack-out', { x: -20, opacity: 0, duration: 0.6, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: '.pack', start: 'top 80%' } });
}

// ---------------- 04 demo ----------------
function demo() {
  const frame = $('#demoFrame'), v = $('#demoVideo'), btn = $('#demoSound');
  gsap.fromTo(frame, { scale: 0.84, borderRadius: 48, rotateX: 14, transformPerspective: 1400 }, { scale: 1, borderRadius: 26, rotateX: 0, ease: 'none', scrollTrigger: { trigger: frame, start: 'top 95%', end: 'top 25%', scrub: 0.6 } });
  ScrollTrigger.create({ trigger: frame, start: 'top 75%', end: 'bottom 20%', onToggle: (s) => { if (s.isActive) v.play().catch(() => {}); else v.pause(); } });
  btn.addEventListener('click', () => { v.muted = !v.muted; btn.textContent = v.muted ? 'Sound off' : 'Sound on'; if (!v.muted) v.play(); });
}

// ---------------- 05 stack ----------------
function stack() {
  gsap.from('#stack .sec-h', { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '#stack .sec-h', start: 'top 85%' } });
  gsap.from('.spec-row', { y: 24, opacity: 0, duration: 0.7, stagger: 0.06, ease: 'power3.out', scrollTrigger: { trigger: '.spec', start: 'top 80%' } });
}

// ---------------- 06 team ----------------
function team() {
  const img = $('#memberFloat');
  let on = false, x = 0, y = 0, rx = 0, ry = 0, vx = 0;
  $$('.member').forEach((m) => {
    m.addEventListener('pointerenter', () => {
      img.src = m.dataset.img; on = true;
      gsap.to(img, { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' });
    });
    m.addEventListener('pointerleave', () => { on = false; gsap.to(img, { opacity: 0, scale: 0.6, duration: 0.35 }); });
  });
  addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; });
  gsap.ticker.add(() => {
    const nx = lerp(rx, x + 150, 0.12), ny = lerp(ry, y - 40, 0.12);
    vx = nx - rx; rx = nx; ry = ny;
    if (on || +img.style.opacity > 0) img.style.left = `${rx}px`, img.style.top = `${ry}px`, img.style.rotate = `${clamp(vx * 0.6, -14, 14)}deg`;
  });
  $$('.m-name').forEach((el) => {
    gsap.from(el, { yPercent: 40, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
  });
  gsap.from('.amp', { scale: 0.4, rotate: -30, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.team', start: 'top 80%' } });
  gsap.from('.team-note', { y: 20, opacity: 0, duration: 0.9, scrollTrigger: { trigger: '.team-note', start: 'top 90%' } });
}

// ---------------- CTA ----------------
function cta() {
  const words = splitWords($('.cta-h'));
  gsap.from(words, { yPercent: 70, opacity: 0, rotate: 4, duration: 1.1, stagger: 0.06, ease: 'expo.out', scrollTrigger: { trigger: '.cta-h', start: 'top 85%' } });
  gsap.from('.cta-row .btn', { y: 20, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: '.cta-row', start: 'top 92%' } });
  if (!fine) return;
  $$('.btn').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.25, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4, ease: 'power3.out' });
    });
    b.addEventListener('pointerleave', () => gsap.to(b, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, .4)' }));
  });
}
