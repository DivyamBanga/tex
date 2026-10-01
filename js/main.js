import { initUI } from './ui.js';
import { initGraph } from './graph.js';

const data = fetch('data/chats.json').then((r) => r.json());
initUI(data);

// Wait briefly for the display font so the film's typography doesn't swap mid-shot.
await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

try {
  await initGraph(await data);
} catch (err) {
  console.error('[cortex] WebGL scene failed, falling back to static hero', err);
  document.body.classList.remove('is-intro');
  document.body.classList.add('is-live', 'no-gl');
  for (const s of ['#nav', '.eyebrow', '.tagline', '#scrollCue']) document.querySelector(s).style.opacity = 1;
  document.querySelectorAll('.wordmark span').forEach((s) => (s.style.transform = 'none'));
  document.querySelector('#stage').style.display = 'none';
  document.querySelector('#hero').style.background = 'url(assets/poster.jpg) center/cover';
}
