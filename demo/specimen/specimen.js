import { Sill } from '../../src/sill.js';
import { mountPanel } from '../../src/panel.js';

// Key field: 9 x 4 keys whose heights follow a slow wave, so the light reveals the relief.
const keys = document.getElementById('keys');
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 9; c++) {
    const k = document.createElement('span');
    k.className = 'key' + (r === 1 && c === 6 ? ' is-signal' : '');
    const wave = 0.5 + 0.5 * Math.sin(c * 0.72 + r * 0.95);
    k.dataset.lit = '';
    k.dataset.material = r === 1 && c === 6 ? 'gloss' : 'satin';
    k.dataset.depth = (4 + wave * 20).toFixed(1);
    keys.append(k);
  }
}

const q = new URLSearchParams(location.search);
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');

const sill = new Sill({
  root: document.body,
  params: { mode: 'lamp', temperature: 3200, intensity: 1.15, ambient: 0.3, shadowLength: 1.4, softness: 0.55, depth: 1.6, material: 1.4, rays: 0.45, falloff: 0.9 },
});

// Specimen controls are real: the switch flips, the slider sets the light's temperature.
const sw = document.getElementById('haze-switch');
sw.addEventListener('click', () => {
  const on = sw.getAttribute('aria-checked') !== 'true';
  sw.setAttribute('aria-checked', String(on));
  sill.set({ rays: on ? 0.45 : 0 });
});
const temp = document.getElementById('temp');
const out = document.getElementById('temp-out');
const slider = document.querySelector('.slider');
const setTemp = (v) => {
  temp.value = v;
  const p = (v - temp.min) / (temp.max - temp.min);
  slider.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
  out.textContent = `${Math.round(v / 50) * 50} K`;
  sill.set({ temperature: Number(v) });
};
temp.addEventListener('input', () => setTemp(temp.value));
setTemp(3200);

mountPanel(sill, { onTheme: (t) => { document.documentElement.dataset.theme = t === 'auto' ? 'dark' : t; } });
window.sill = sill;
window.specimen = { setTemp };
