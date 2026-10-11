/*
  Sill light panel: a reusable control surface for any Sill instance.
  Every control writes through sill.set(); the panel re-reads on every
  emitted change, so presets and programmatic changes stay in sync.
*/
import { PRESETS } from './sill.js';

const SLIDERS = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 1.6, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'temperature', label: 'Temperature', min: 2200, max: 7500, step: 50, fmt: (v) => `${Math.round(v)} K` },
  { key: 'shadowLength', label: 'Shadow length', min: 0.4, max: 2.6, step: 0.01, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'falloff', label: 'Falloff', min: 0.2, max: 2, step: 0.01, fmt: (v) => v.toFixed(2), only: 'lamp' },
  { key: 'depth', label: 'Surface depth', min: 0, max: 2.5, step: 0.01, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'material', label: 'Material response', min: 0, max: 2, step: 0.01, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'ambient', label: 'Ambient', min: 0.1, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'rays', label: 'Rays', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'shadow', label: 'Shadow strength', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}` },
];

const PRESET_LABELS = { morning: 'Morning', noon: 'Noon', golden: 'Golden hour', lamp: 'Evening lamp' };
const TIER_LABELS = { auto: 'Auto', high: 'High', balanced: 'Balanced', low: 'Low', static: 'Static (no WebGL)' };

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};

export function mountPanel(sill, { host = document.body, onTheme = null, theme = 'auto' } = {}) {
  const id = 'sill-panel';
  const dock = h('button', { class: 'sp-dock', type: 'button', 'aria-expanded': 'false', 'aria-controls': id },
    h('span', { class: 'sp-dock-dot', 'aria-hidden': 'true' }), 'Light');
  const close = h('button', { class: 'sp-close', type: 'button', 'aria-label': 'Close light controls' }, '×');

  const modeGroup = h('div', { class: 'sp-seg', role: 'radiogroup', 'aria-label': 'Light source' });
  const modeBtns = ['lamp', 'sun'].map((m) =>
    h('button', { type: 'button', role: 'radio', class: 'sp-seg-btn', 'data-mode': m, onclick: () => sill.set({ mode: m }) }, m === 'lamp' ? 'Lamp' : 'Sun'));
  modeGroup.append(...modeBtns);

  const presets = h('div', { class: 'sp-presets', role: 'group', 'aria-label': 'Light presets' },
    Object.keys(PRESETS).map((k) => h('button', { type: 'button', class: 'sp-chip', onclick: () => sill.preset(k) }, PRESET_LABELS[k] || k)));

  // Position pad: a keyboard- and touch-friendly way to place the light precisely.
  const handle = h('span', { class: 'sp-pad-handle', 'aria-hidden': 'true' });
  const pad = h('div', { class: 'sp-pad', role: 'slider', tabindex: '0', 'aria-label': 'Light position', 'aria-valuemin': '0', 'aria-valuemax': '100' }, handle);
  const padMove = (e) => {
    const r = pad.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    sill.set({ follow: false });
    sill.moveTo(fx * innerWidth, fy * innerHeight);
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padMove(e); e.stopPropagation(); });
  pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) { padMove(e); e.stopPropagation(); } });
  pad.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 0.1 : 0.02);
    const L = sill.light;
    let x = L.x / innerWidth, y = L.y / innerHeight;
    if (e.key === 'ArrowLeft') x -= step; else if (e.key === 'ArrowRight') x += step;
    else if (e.key === 'ArrowUp') y -= step; else if (e.key === 'ArrowDown') y += step;
    else return;
    e.preventDefault();
    sill.set({ follow: false });
    sill.moveTo(Math.min(1, Math.max(0, x)) * innerWidth, Math.min(1, Math.max(0, y)) * innerHeight);
  });

  const follow = h('button', { type: 'button', role: 'switch', class: 'sp-switch', onclick: () => sill.set({ follow: !sill.params.follow }) },
    h('span', { class: 'sp-switch-label' }, 'Follow pointer'), h('span', { class: 'sp-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'sp-switch-thumb' })), h('span', { class: 'sp-switch-state' }));

  const rows = SLIDERS.map((s) => {
    const inputId = `sp-${s.key}`;
    const out = h('output', { class: 'sp-val', for: inputId });
    const input = h('input', { id: inputId, type: 'range', min: s.min, max: s.max, step: s.step,
      oninput: (e) => sill.set({ [s.key]: Number(e.target.value) }) });
    const row = h('div', { class: 'sp-row', 'data-only': s.only || null }, h('label', { for: inputId }, s.label), out, input);
    return { s, row, input, out };
  });

  const tier = h('select', { id: 'sp-tier', onchange: (e) => sill.set({ tier: e.target.value }) },
    Object.entries(TIER_LABELS).map(([v, l]) => h('option', { value: v }, l)));
  const themeSel = onTheme ? h('select', { id: 'sp-theme', onchange: (e) => onTheme(e.target.value) },
    [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: v === theme }, l))) : null;
  const readout = h('p', { class: 'sp-readout', 'aria-live': 'off' });
  const reset = h('button', { type: 'button', class: 'sp-reset', onclick: () => sill.set({ ...sill.constructor.defaults }) }, 'Reset light');

  const panel = h('section', { id, class: 'sp-panel', role: 'dialog', 'aria-label': 'Light controls', hidden: true },
    h('header', { class: 'sp-head' }, h('h2', {}, 'Light'), close),
    modeGroup,
    presets,
    h('div', { class: 'sp-padwrap' }, pad, follow),
    h('div', { class: 'sp-rows' }, rows.map((r) => r.row)),
    h('div', { class: 'sp-foot' },
      h('label', { for: 'sp-tier' }, 'Quality'), tier,
      themeSel ? h('label', { for: 'sp-theme' }, 'Theme') : null, themeSel),
    readout,
    reset);

  host.append(dock, panel);

  const open = (v) => {
    panel.hidden = !v;
    dock.setAttribute('aria-expanded', String(v));
    if (v) panel.querySelector('.sp-seg-btn[aria-checked="true"]')?.focus();
    else dock.focus();
  };
  dock.addEventListener('click', () => open(panel.hidden));
  close.addEventListener('click', () => open(false));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });

  const sync = () => {
    const p = sill.params;
    modeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === p.mode)));
    for (const r of rows) {
      if (document.activeElement !== r.input) r.input.value = p[r.s.key];
      r.out.textContent = r.s.fmt(p[r.s.key]);
      r.row.hidden = r.s.only ? r.s.only !== p.mode : false;
    }
    follow.setAttribute('aria-checked', String(p.follow));
    follow.querySelector('.sp-switch-state').textContent = p.follow ? 'On' : 'Off';
    tier.value = p.tier;
    const L = sill.light;
    const fx = L.x / innerWidth, fy = L.y / innerHeight;
    pad.style.setProperty('--hx', `${(fx * 100).toFixed(1)}%`);
    pad.style.setProperty('--hy', `${(fy * 100).toFixed(1)}%`);
    pad.setAttribute('aria-valuenow', String(Math.round(fx * 100)));
    pad.setAttribute('aria-valuetext', `${Math.round(fx * 100)}% across, ${Math.round(fy * 100)}% down`);
  };
  sill.subscribe(sync);
  let rafSync = 0;
  sill.onFrame = (stats) => {
    if (panel.hidden || rafSync) return;
    rafSync = requestAnimationFrame(() => {
      rafSync = 0;
      sync();
      readout.textContent = `${TIER_LABELS[stats.tier] || stats.tier} · floor ${stats.gl ? `${stats.floorScale.toFixed(2)}x` : 'off'} · ${stats.frameMs.toFixed(1)} ms/frame CPU`;
    });
  };
  sync();
  return { open, sync };
}
