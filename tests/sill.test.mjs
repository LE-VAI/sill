// Sill's math and guarantees, tested without a browser.
// The renderers need a DOM and a GPU; the light model underneath them does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sill, DEFAULTS, MATERIALS, PRESETS, TIERS, kelvin, toLinear } from '../src/sill.js';

test('the core imports in plain Node (no DOM at module load)', async () => {
  const stage = await import('../src/stage.js');
  const panel = await import('../src/panel.js');
  assert.equal(typeof stage.Stage, 'function');
  assert.equal(typeof panel.mountPanel, 'function');
});

test('kelvin: warm light is red-heavy, daylight is near white, and blue rises with temperature', () => {
  const warm = kelvin(2700), day = kelvin(6500);
  assert.equal(Math.max(...warm), 1);
  assert.ok(warm[0] === 1 && warm[2] < 0.6, `2700 K should be red-heavy: ${warm}`);
  assert.ok(day.every((c) => c > 0.9), `6500 K should be near white: ${day}`);
  let prev = -1;
  for (let k = 2200; k <= 6600; k += 400) {
    const b = kelvin(k)[2];
    assert.ok(b >= prev, `blue should not fall as kelvin rises (${k} K)`);
    prev = b;
  }
});

test('toLinear: the sRGB transfer curve', () => {
  assert.equal(toLinear(0), 0);
  assert.ok(Math.abs(toLinear(1) - 1) < 1e-12);
  assert.ok(Math.abs(toLinear(0.5) - 0.214) < 0.001);
});

test('presets and tiers only use real parameters', () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    for (const k of Object.keys(p)) assert.ok(k in DEFAULTS, `preset ${name} sets unknown param ${k}`);
  }
  assert.ok(TIERS.high.floor > TIERS.balanced.floor && TIERS.balanced.floor > TIERS.low.floor);
  assert.equal(TIERS.static.floor, 0);
  for (const [name, m] of Object.entries(MATERIALS)) {
    for (const k of ['spec', 'rough', 'rim', 'wash']) assert.ok(m[k] >= 0 && m[k] <= 1.5, `${name}.${k} out of range`);
  }
});

// A card at elevation z under a lamp: the floor shadow is the footprint projected
// from the light, and its penumbra grows with height (contact hardening).
const card = (x, y, w, h) => ({ vr: { x, y, w, h }, radius: 12, opacity: 1 });
const lamp = { sun: false, x: 0, y: 0, z: 600, size: 100 };

test('lamp shadows project away from the light by Lz / (Lz - z)', () => {
  const o = Sill.prototype._occluder(card(250, -50, 100, 100), lamp, 30);
  const s = 600 / 570;
  assert.ok(Math.abs(o.sr[0] - 300 * s) < 1e-9, 'projected centre moves away from the light');
  assert.ok(Math.abs(o.sr[2] - 50 * s) < 1e-9, 'projected half-width grows by the same scale');
});

test('contact hardening: a low element casts a sharper shadow than a high one', () => {
  const low = Sill.prototype._occluder(card(250, -50, 100, 100), lamp, 4);
  const high = Sill.prototype._occluder(card(250, -50, 100, 100), lamp, 48);
  assert.ok(low.sp[1] < high.sp[1], `penumbra ${low.sp[1]} should be below ${high.sp[1]}`);
});

test('sun shadows are parallel: the offset depends on height, not position', () => {
  const dir = [0.6, 0.0, 0.8];
  const sun = { sun: true, dir, ang: 0.05 };
  const a = Sill.prototype._occluder(card(0, 0, 100, 100), sun, 20);
  const b = Sill.prototype._occluder(card(900, 400, 100, 100), sun, 20);
  assert.ok(Math.abs((a.sr[0] - 50) - (b.sr[0] - 950)) < 1e-9);
  assert.ok(Math.abs((a.sr[0] - 50) - -(0.6 / 0.8) * 20) < 1e-9, 'offset is -dir.xy/dir.z times height');
});

// The contrast guard: wash plus specular over a text-bearing face never exceeds
// the theme's ceiling, whatever the sliders say. This is an accessibility promise.
function shadeOnce({ bare, params, theme }) {
  const ctx = Object.create(Sill.prototype);
  ctx.params = { ...DEFAULTS, ...params };
  ctx.theme = theme;
  ctx.cur = { x: 960, y: 300 };
  const L = ctx._resolveLight(1920, 1080);
  const it = {
    vr: { x: 760, y: 200, w: 400, h: 300 }, mat: MATERIALS.gloss, depth: 16, base: 0,
    bare, cast: 'floor', layer: { style: { cssText: '' } }, el: { style: {} }, css: '',
  };
  ctx._shade(it, L, 1920, 1080, 16);
  const v = (name) => Number((it.layer.style.cssText.match(new RegExp(`--${name}:([\\d.]+)`)) || [])[1]);
  return v('wa') + v('sa');
}
const darkTheme = { wash: 0.07, spec: 0.22, rim: 0.5, cast: 0.2, shade: '0 0 0', key: 1, pool: 1, liftMax: 0.05, liftMaxBare: 0.5, bareGain: 2.6, dark: true };

test('contrast guard: text faces stay under the lift ceiling with every slider maxed', () => {
  const lift = shadeOnce({ bare: false, params: { intensity: 1.6, material: 2 }, theme: darkTheme });
  assert.ok(lift <= darkTheme.liftMax + 0.002, `lift ${lift} exceeds ${darkTheme.liftMax}`);
});

test('contrast guard: faces with no text may take more light, still capped', () => {
  const text = shadeOnce({ bare: false, params: { intensity: 1.6, material: 2 }, theme: darkTheme });
  const bare = shadeOnce({ bare: true, params: { intensity: 1.6, material: 2 }, theme: darkTheme });
  assert.ok(bare > text, 'a bare face should be allowed more light than a text face');
  assert.ok(bare <= darkTheme.liftMaxBare + 0.002, `bare lift ${bare} exceeds ${darkTheme.liftMaxBare}`);
});
