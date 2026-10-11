import { Sill } from '../../src/sill.js';
import { Stage } from '../../src/stage.js';
import { mountPanel } from '../../src/panel.js';

const root = document.documentElement;
const readTheme = () => { try { return localStorage.getItem('esy-theme') || 'auto'; } catch { return 'auto'; } };

const sill = new Sill({
  root: document.body,
  params: { mode: 'lamp', temperature: 3900, softness: 0.5, ambient: 0.55, rays: 0.3 },
});

const stages = new Map();
for (const el of document.querySelectorAll('[data-stage]')) {
  try {
    const stage = new Stage(el, el.dataset.stage);
    stages.set(el.dataset.stage, stage);
    sill.addStage(stage);
  } catch (err) {
    console.warn('[esy] stage unavailable', el.dataset.stage, err);
    el.classList.add('stage-fallback');
  }
}

for (const input of document.querySelectorAll('input[name="fabric"]')) {
  input.addEventListener('change', () => stages.get('lounge')?.set({ fabric: input.value }));
}

mountPanel(sill, {
  theme: readTheme(),
  onTheme: (t) => {
    if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
    try { localStorage.setItem('esy-theme', t); } catch {}
  },
});

// Inspection handle for the prototype.
window.sill = sill;
window.sillStages = stages;
