/*
  Sill: real-time light for interfaces.

  One light model, three renderers that never disagree:

    floor     WebGL2, one full-screen pass at reduced resolution. Lights the
              page plane and evaluates every lit card as an analytic occluder:
              perspective-projected soft shadows (penumbra grows with
              elevation, so contact hardening falls out), ambient occlusion,
              and an exact volumetric shadow term for the haze layer.
    surfaces  CSS. Each [data-lit] element gets a light layer under its
              content: diffuse wash, the specular reflection of the light,
              and a per-edge rim from the bevel's N.L. Nested controls cast
              onto their parent through a box-shadow derived from the same
              light, so shadows never double up.
    stages    WebGL2 signed-distance scenes (stage.js) for product shots,
              lit by the same light mapped into the stage's own space.

  Nothing renders at rest. Pointer input sets a target; one rAF loop eases the
  light toward it, renders while it moves, and stops when it settles.

  Coordinates: viewport CSS px, x right, y down, z up out of the screen.
  The floor is z = 0; a lit element floats at z = its data-depth.
*/

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const DEG = Math.PI / 180;

export const MATERIALS = {
  // spec: specular strength, rough: 0 mirror to 1 chalk, rim: edge response,
  // wash: diffuse response, metal: tint the reflection by the face colour.
  matte: { spec: 0.18, rough: 0.9, rim: 0.55, wash: 1.0 },
  satin: { spec: 0.42, rough: 0.6, rim: 0.8, wash: 1.0 },
  gloss: { spec: 0.85, rough: 0.28, rim: 1.0, wash: 0.85 },
  metal: { spec: 0.95, rough: 0.4, rim: 1.15, wash: 0.55 },
  fabric: { spec: 0.06, rough: 1.0, rim: 0.4, wash: 1.15 },
  wood: { spec: 0.32, rough: 0.66, rim: 0.7, wash: 1.0 },
  stone: { spec: 0.24, rough: 0.78, rim: 0.6, wash: 1.0 },
  glass: { spec: 0.9, rough: 0.2, rim: 1.25, wash: 0.6 },
};

export const PRESETS = {
  morning: { mode: 'sun', temperature: 5400, intensity: 1, ambient: 0.62, shadowLength: 1.25, softness: 0.55, rays: 0.4 },
  noon: { mode: 'sun', temperature: 6200, intensity: 1.05, ambient: 0.7, shadowLength: 0.7, softness: 0.4, rays: 0.15 },
  golden: { mode: 'sun', temperature: 3300, intensity: 1, ambient: 0.48, shadowLength: 1.9, softness: 0.62, rays: 0.55 },
  lamp: { mode: 'lamp', temperature: 2900, intensity: 1, ambient: 0.42, shadowLength: 1, softness: 0.45, rays: 0.3 },
};

export const DEFAULTS = {
  mode: 'lamp', // 'lamp' (area light at the pointer) or 'sun' (directional, pointer sets its position in the sky)
  follow: true, // light follows the pointer
  intensity: 1,
  temperature: 4000, // kelvin
  shadowLength: 1, // >1 lowers the light: longer shadows
  softness: 0.5, // light size: penumbra width
  falloff: 1, // lamp inverse-square strength
  depth: 1, // multiplies every element's elevation
  material: 1, // multiplies specular, rim and wash response
  ambient: 0.55, // sky fill
  rays: 0.3, // haze visibility
  shadow: 1, // cast-shadow strength
  aperture: true, // sun mode: skylight mullions between sun and page
  smoothing: 36, // ms, pointer easing time constant (touch uses 3x)
  tier: 'auto', // 'auto' | 'high' | 'balanced' | 'low' | 'static'
  enabled: true, // false: no light at all, the page falls back to its static token shadows
};

export const TIERS = {
  high: { floor: 0.75, rays: true, hazeSteps: 12, stage: 2, stageSteps: 1 },
  balanced: { floor: 0.5, rays: true, hazeSteps: 8, stage: 1.5, stageSteps: 0.8 },
  // Stages re-render only when the light changes, so even low tiers keep them sharp.
  low: { floor: 0.34, rays: false, hazeSteps: 0, stage: 1.5, stageSteps: 0.55 },
  static: { floor: 0, rays: false, hazeSteps: 0, stage: 1.5, stageSteps: 0.55 },
};

const MAX_OCCLUDERS = 32;
const VIEWER_Z = 1500; // virtual eye height above the screen centre, for reflections
const LAMP_BASE = 660; // lamp height at shadowLength 1
const SUN_FAR = 20000;

/* Kelvin to linear RGB, normalised so the brightest channel is 1.
   Tanner Helland's fit, valid 1000K to 40000K. */
export function kelvin(k) {
  const t = clamp(k, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const s = [r, g, b].map((v) => clamp(v, 0, 255) / 255);
  const m = Math.max(...s);
  return s.map((v) => v / m);
}

export const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/* Parse any CSS colour the browser understands into sRGB 0..1. */
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
export function parseColor(str) {
  if (!probe) return [1, 1, 1];
  probe.fillStyle = '#000';
  probe.fillStyle = str.trim();
  const v = probe.fillStyle;
  if (v.startsWith('#')) {
    const n = parseInt(v.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  }
  const m = v.match(/[\d.]+/g) || [0, 0, 0];
  return m.slice(0, 3).map((x) => Number(x) / 255);
}

/* ------------------------------------------------------------------ */
/* Floor renderer                                                       */
/* ------------------------------------------------------------------ */

const FLOOR_VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0., 1.); }`;

const FLOOR_FS = `#version 300 es
precision highp float;
#define MAXN ${MAX_OCCLUDERS}
uniform vec2 uRes;
uniform float uScale;
uniform vec2 uOrigin;      // viewport px of the canvas's top-left
uniform float uScroll;     // document scroll, anchors the plaster texture
uniform vec4 uLight;       // xyz (viewport px), w = 1 for directional
uniform vec3 uSunDir;
uniform vec3 uLightCol;    // linear, intensity folded in
uniform float uFalloff;
uniform vec3 uSky;         // linear ambient
uniform vec3 uAlbedo;      // linear floor albedo
uniform float uShadow;
uniform float uRays;
uniform float uHazeH;
uniform int uHazeSteps;
uniform vec4 uAperture;    // on, height, penumbra, strength
uniform vec3 uMull;        // spacing x, spacing y, half thickness
uniform vec2 uMullOrigin;
uniform float uBump;
uniform float uGrain;
uniform int uCount;
uniform vec4 uSR[MAXN];    // projected shadow centre xy, half size
uniform vec4 uSP[MAXN];    // radius, penumbra, opacity, -
uniform vec4 uF[MAXN];     // footprint centre xy, half size
uniform vec4 uFP[MAXN];    // radius, height, ao reach, ao strength
out vec4 outColor;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float plaster(vec2 p){ return vnoise(p * 0.021) * 0.5 + vnoise(p * 0.073) * 0.32 + vnoise(p * 0.29) * 0.18; }
float sdRB(vec2 p, vec2 b, float r){
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}
vec2 slab(vec2 o, vec2 d, vec2 c, vec2 hb){
  vec2 dd = mix(vec2(1e-5), d, step(vec2(1e-5), abs(d)));
  vec2 inv = 1. / dd;
  vec2 t0 = (c - hb - o) * inv, t1 = (c + hb - o) * inv;
  vec2 mn = min(t0, t1), mx = max(t0, t1);
  return vec2(max(mn.x, mn.y), min(mx.x, mx.y));
}
// Occluded height of the haze column [0,h] above p, for a footprint (c, hb) at height h.
float columnOcc(vec2 p, vec2 c, vec2 hb, float h){
  if (uLight.w > 0.5) {
    vec2 D = uSunDir.xy / max(uSunDir.z, 0.05);
    vec2 t = slab(p, D, c, hb);
    return max(min(t.y, h) - max(t.x, 0.), 0.);
  }
  float lz = uLight.z;
  vec2 t = slab(p, uLight.xy - p, c, hb);
  float a = max(t.x, 0.), b = min(t.y, h / lz);
  if (b <= a) return 0.;
  float za = (h - a * lz) / (1. - a), zb = (h - b * lz) / (1. - b);
  return max(za - zb, 0.);
}
float mullion(vec2 q, float pen){
  vec2 g = abs(fract((q - uMullOrigin) / uMull.xy + 0.5) - 0.5) * uMull.xy;
  float d = min(g.x, g.y) - uMull.z;
  return smoothstep(-pen, pen, d);
}
vec3 encode(vec3 c){
  return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 softclip(vec3 c){
  vec3 k = 0.82 + 0.18 * (1. - exp(-(c - 0.82) / 0.18));
  return mix(c, k, step(0.82, c));
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = uOrigin + fc / uScale;
  vec2 pd = p + vec2(0., uScroll);
  bool sun = uLight.w > 0.5;

  vec3 toL = sun ? uSunDir : normalize(vec3(uLight.xy - p, uLight.z));
  float E;
  if (sun) {
    E = mix(1., uSunDir.z, 0.45);
  } else {
    vec2 d = uLight.xy - p; float z2 = uLight.z * uLight.z;
    E = pow(z2 / (dot(d, d) + z2), 1.5 * uFalloff);
  }

  // Plaster: a faint height field. Grazing light reveals it, overhead light hides it.
  float h0 = plaster(pd);
  float hx = plaster(pd + vec2(1.5, 0.));
  float hy = plaster(pd + vec2(0., 1.5));
  vec3 n = normalize(vec3(-(hx - h0) * uBump, -(hy - h0) * uBump, 1.));
  float ndl = max(dot(n, toL), 0.) / max(toL.z, 0.08);

  float occ = 0., ao = 0., col = 0.;
  for (int i = 0; i < MAXN; i++) {
    if (i >= uCount) break;
    vec4 R = uSR[i], S = uSP[i], F = uF[i], FP = uFP[i];
    float d = sdRB(p - R.xy, R.zw, S.x);
    occ = max(occ, (1. - smoothstep(-S.y, S.y, d)) * S.z);
    float df = max(sdRB(p - F.xy, F.zw, FP.x), 0.);
    float a = 1. - clamp(df / FP.z, 0., 1.);
    ao = max(ao, a * a * FP.w * S.z);
    if (uHazeSteps > 0) {
      float soft = 0.5 * (columnOcc(p, F.xy, F.zw + S.y * 0.5, FP.y) + columnOcc(p, F.xy, max(F.zw - S.y * 0.5, 1.), FP.y));
      col += soft * S.z;
    }
  }

  float aper = 1., hazeA = 1.;
  if (sun && uAperture.x > 0.5) {
    vec2 D = uSunDir.xy / max(uSunDir.z, 0.05);
    aper = mix(1. - uAperture.w, 1., mullion(p + D * uAperture.y, uAperture.z));
    if (uHazeSteps > 0) {
      float acc = 0.;
      float j = hash(fc + 0.37);
      for (int k = 0; k < 16; k++) {
        if (k >= uHazeSteps) break;
        float z = (float(k) + j) / float(uHazeSteps) * uAperture.y;
        acc += mullion(p + D * (uAperture.y - z), uAperture.z * (1. - z / uAperture.y) + 1.);
      }
      hazeA = mix(1. - uAperture.w, 1., acc / float(uHazeSteps));
    }
  }

  float vis = (1. - uShadow * occ) * aper;
  vec3 c = uAlbedo * (uSky * (1. - ao) + uLightCol * (E * vis * ndl));

  if (uHazeSteps > 0) {
    float lit = (1. - clamp(col / uHazeH, 0., 1.)) * hazeA;
    c += uLightCol * uRays * 0.06 * (sun ? 0.8 : E) * (lit - 0.8);
  }

  c *= 1. + (h0 - 0.5) * uGrain;
  c = encode(softclip(max(c, 0.)));
  c += (hash(fc) - 0.5) / 255.;
  outColor = vec4(c, 1.);
}`;

class FloorRenderer {
  constructor(host) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'sill-floor';
    this.wrap.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.wrap.append(this.canvas);
    host.prepend(this.wrap);
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('webgl2 unavailable');
    this.gl = gl;
    this.prog = linkProgram(gl, FLOOR_VS, FLOOR_FS);
    this.loc = uniformLocations(gl, this.prog);
    this.vao = fullScreenTriangle(gl, this.prog);
    this.sr = new Float32Array(MAX_OCCLUDERS * 4);
    this.sp = new Float32Array(MAX_OCCLUDERS * 4);
    this.f = new Float32Array(MAX_OCCLUDERS * 4);
    this.fp = new Float32Array(MAX_OCCLUDERS * 4);
    this.size = { w: 0, h: 0, scale: 0, over: 0 };
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }

  resize(vw, vh, scale) {
    const over = Math.round(vh * 0.25);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round((vh + over * 2) * scale));
    if (w !== this.size.w || h !== this.size.h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${vw}px`;
      this.canvas.style.height = `${vh + over * 2}px`;
    }
    this.size = { w, h, scale, over, vw, vh };
  }

  render(frame) {
    if (this.lost) return;
    const { gl, loc, size } = this;
    const { light: L, occluders, scrollY, theme, params, tier } = frame;
    // Glue the canvas to the document: it scrolls with content between renders.
    this.canvas.style.transform = `translate3d(0, ${scrollY - size.over}px, 0)`;
    gl.viewport(0, 0, size.w, size.h);
    gl.useProgram(this.prog);
    const n = Math.min(occluders.length, MAX_OCCLUDERS);
    for (let i = 0; i < n; i++) {
      const o = occluders[i];
      this.sr.set(o.sr, i * 4);
      this.sp.set(o.sp, i * 4);
      this.f.set(o.f, i * 4);
      this.fp.set(o.fp, i * 4);
    }
    gl.uniform2f(loc.uRes, size.w, size.h);
    gl.uniform1f(loc.uScale, size.scale);
    gl.uniform2f(loc.uOrigin, 0, -size.over);
    gl.uniform1f(loc.uScroll, scrollY);
    gl.uniform4f(loc.uLight, L.x, L.y, L.z, L.sun ? 1 : 0);
    gl.uniform3f(loc.uSunDir, L.dir[0], L.dir[1], L.dir[2]);
    gl.uniform3fv(loc.uLightCol, L.floorCol);
    gl.uniform1f(loc.uFalloff, params.falloff);
    gl.uniform3fv(loc.uSky, theme.skyLin.map((v) => v * theme.amb * params.ambient));
    gl.uniform3fv(loc.uAlbedo, theme.floorAlbedo);
    gl.uniform1f(loc.uShadow, clamp(params.shadow, 0, 1) * 0.92);
    gl.uniform1f(loc.uRays, params.rays);
    gl.uniform1f(loc.uHazeH, frame.hazeH);
    gl.uniform1i(loc.uHazeSteps, tier.rays && params.rays > 0.001 ? tier.hazeSteps : 0);
    const ap = L.sun && params.aperture;
    gl.uniform4f(loc.uAperture, ap ? 1 : 0, 540, 4 + 540 * L.ang * 2.2, 0.42);
    gl.uniform3f(loc.uMull, Math.max(420, size.vw * 0.46), Math.max(520, size.vh * 0.9), 26);
    gl.uniform2f(loc.uMullOrigin, size.vw * 0.31, size.vh * 0.18);
    gl.uniform1f(loc.uBump, theme.bump);
    gl.uniform1f(loc.uGrain, theme.grain);
    gl.uniform1i(loc.uCount, n);
    if (n) {
      gl.uniform4fv(loc['uSR[0]'], this.sr, 0, n * 4);
      gl.uniform4fv(loc['uSP[0]'], this.sp, 0, n * 4);
      gl.uniform4fv(loc['uF[0]'], this.f, 0, n * 4);
      gl.uniform4fv(loc['uFP[0]'], this.fp, 0, n * 4);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.wrap.remove();
  }
}

/* ------------------------------------------------------------------ */
/* WebGL helpers (shared with stage.js)                                 */
/* ------------------------------------------------------------------ */

export function linkProgram(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader compile failed: ${log}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program link failed: ${gl.getProgramInfoLog(p)}`);
  return p;
}

export function uniformLocations(gl, prog) {
  const out = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const name = info.name;
    out[name] = gl.getUniformLocation(prog, name);
    if (name.endsWith('[0]')) out[name.slice(0, -3)] = out[name];
  }
  return new Proxy(out, { get: (t, k) => (k in t ? t[k] : null) });
}

export function fullScreenTriangle(gl, prog) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return vao;
}

/* ------------------------------------------------------------------ */
/* Sill                                                                 */
/* ------------------------------------------------------------------ */

export class Sill {
  static defaults = DEFAULTS;

  constructor({ root = document.body, params = {}, onFrame = null } = {}) {
    this.root = root;
    this.params = { ...DEFAULTS, ...params };
    this.onFrame = onFrame;
    this.items = new Map();
    this.stages = new Set();
    this.listeners = new Set();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.coarse = matchMedia('(pointer: coarse)');
    if (this.reduced.matches && params.follow === undefined) this.params.follow = false;

    const vw = innerWidth, vh = innerHeight;
    this.target = { x: vw * 0.3, y: vh * 0.22 };
    this.cur = { ...this.target };
    this.touchEase = false;
    this.stats = { frameMs: 0, renders: 0, tier: 'balanced', floorScale: 0, gl: false };
    this.dirty = { light: true, layout: true, theme: true };
    this.raf = 0;
    this.lastT = 0;
    this.settleTimer = 0;
    this.slow = 0;

    this._readTheme();
    this._pickTier();
    this._initFloor();
    this.scan();
    this._bind();
    this.kick();
  }

  /* ---------------- public API ---------------- */

  set(patch) {
    const prevTier = this.params.tier;
    Object.assign(this.params, patch);
    if (patch.tier && patch.tier !== prevTier) { this._pickTier(); this._initFloor(); this.dirty.layout = true; }
    if ('theme' in patch) this.dirty.theme = true;
    if ('enabled' in patch) this._applyEnabled();
    this.dirty.light = true;
    this.kick();
    this._emit();
  }

  preset(name) {
    if (PRESETS[name]) this.set(PRESETS[name]);
  }

  /* Move the light to a viewport point. `instant` skips easing. */
  moveTo(x, y, instant = false) {
    this.target.x = x;
    this.target.y = y;
    if (instant) Object.assign(this.cur, this.target);
    this.dirty.light = true;
    this.kick();
    this._emit();
  }

  get light() { return { ...this.cur }; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /* Register every [data-lit] and [data-stage] under root. Safe to call again. */
  scan() {
    this.root.querySelectorAll('[data-lit]').forEach((el) => this._register(el));
    for (const it of this.items.values()) {
      let z = 0, p = it.parent;
      while (p) { z += p.depth; p = p.parent; }
      it.base = z;
    }
    this.dirty.layout = true;
    this.kick();
  }

  addStage(stage) {
    this.stages.add(stage);
    this.ro?.observe(stage.el);
    this.dirty.layout = true;
    this.kick();
  }

  refresh() { this.dirty.layout = true; this.dirty.theme = true; this.kick(); }

  kick() {
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame((t) => this._frame(t));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.ro.disconnect();
    this.floor?.destroy();
    for (const it of this.items.values()) { it.layer?.remove(); it.el.classList.remove('sl-on', 'sl-css-cast', 'sl-type'); it.el.style.boxShadow = ''; it.el.style.textShadow = ''; }
    this.items.clear();
  }

  /* ---------------- setup ---------------- */

  _register(el) {
    if (this.items.has(el)) return;
    if (el.dataset.lit === 'type') return this._registerType(el);
    const layer = document.createElement('span');
    layer.className = 'sl';
    layer.setAttribute('aria-hidden', 'true');
    const rim = document.createElement('span');
    rim.className = 'sl-rim';
    layer.append(rim);
    el.prepend(layer);
    el.classList.add('sl-on');
    const parentEl = el.parentElement?.closest('[data-lit]');
    const cs = getComputedStyle(el);
    const it = {
      el,
      layer,
      mat: MATERIALS[el.dataset.material] || MATERIALS.satin,
      depth: parseFloat(el.dataset.depth || '8'),
      opacity: parseFloat(el.dataset.opacity || '1'),
      parent: parentEl ? this.items.get(parentEl) || null : null,
      base: 0,
      fixed: cs.position === 'fixed',
      radius: parseFloat(cs.borderTopLeftRadius) || 0,
      doc: { x: 0, y: 0, w: 0, h: 0 },
      vr: { x: 0, y: 0, w: 0, h: 0 },
      visible: false,
      css: '',
      shadow: '',
      // A face with no text of its own can take a full pool of light; the contrast
      // guard only binds faces that carry text.
      bare: !el.textContent.trim(),
    };
    if (!it.parent && parentEl) {
      // Parent registered later in document order: resolve lazily.
      it.parentEl = parentEl;
    }
    it.cast = el.dataset.cast || (parentEl ? 'css' : 'floor');
    if (it.cast === 'css') el.classList.add('sl-css-cast');
    this.items.set(el, it);
    this.ro?.observe(el);
  }

  /* Lit type: a heading whose glyphs stand off the surface. No light layer; the
     light writes a cast shadow (contact + soft) and a thin light-side rim straight
     into text-shadow. The glyph fill never changes, so contrast is untouched. */
  _registerType(el) {
    const parentEl = el.parentElement?.closest('[data-lit]');
    const it = {
      el,
      kind: 'type',
      depth: parseFloat(el.dataset.depth || '8'),
      parent: parentEl ? this.items.get(parentEl) || null : null,
      parentEl,
      base: 0,
      fixed: getComputedStyle(el).position === 'fixed',
      doc: { x: 0, y: 0, w: 0, h: 0 },
      vr: { x: 0, y: 0, w: 0, h: 0 },
      visible: false,
      shadow: '',
      cast: 'type',
    };
    el.classList.add('sl-type');
    this.items.set(el, it);
    this.ro?.observe(el);
  }

  _shadeType(it, L, z) {
    const r = it.vr, p = this.params, T = this.theme;
    const own = it.depth * p.depth;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const E = this._irr(L, cx, cy, z);
    let ox, oy, pen, lx, ly;
    if (L.sun) {
      ox = -(L.dir[0] / L.dir[2]) * own; oy = -(L.dir[1] / L.dir[2]) * own;
      pen = (own / Math.max(L.dir[2], 0.08)) * L.ang * 1.2;
      lx = L.dir[0]; ly = L.dir[1];
    } else {
      const lz = Math.max(1, L.z - z);
      ox = ((cx - L.x) * own) / lz; oy = ((cy - L.y) * own) / lz;
      pen = (L.size * own) / lz;
      const d = Math.hypot(L.x - cx, L.y - cy) || 1;
      lx = (L.x - cx) / d; ly = (L.y - cy) / d;
    }
    const k = T.cast * clamp(p.shadow, 0, 1) * (L.sun ? 1 : 0.35 + 0.65 * E) * L.I;
    const blur = 2 * pen + own * 0.3 + 1;
    const rim = clamp(T.rim * p.material * L.I * (L.sun ? 1 : Math.sqrt(E)) * 0.55, 0, 0.9);
    const f = (n) => n.toFixed(1);
    const g = (n) => clamp(n, 0, 1).toFixed(3);
    const sh = `${f(lx * 0.9)}px ${f(ly * 0.9)}px 0 rgb(${L.lr} / ${g(rim)}), ${f(ox * 0.3)}px ${f(oy * 0.3)}px ${f(blur * 0.25 + 1)}px rgb(${T.shade} / ${g(k * 1.5)}), ${f(ox)}px ${f(oy)}px ${f(blur)}px rgb(${T.shade} / ${g(k)})`;
    if (sh !== it.shadow) { it.el.style.textShadow = sh; it.shadow = sh; }
  }

  /* The off switch: no floor, no light layers, no cast shadows. The page shows
     its own static token elevation, which is what a before/after compares against. */
  _applyEnabled() {
    const on = this.params.enabled !== false;
    const root = document.documentElement;
    root.classList.toggle('sill-off', !on);
    root.classList.toggle('sill-gl', on && !!this.floor);
    if (!on) {
      for (const it of this.items.values()) {
        if (it.kind === 'type') { it.el.style.textShadow = ''; it.shadow = ''; }
        else if (it.cast === 'css') { it.el.style.boxShadow = ''; it.shadow = ''; }
      }
    }
    this.dirty.light = true;
  }

  _bind() {
    this.abort = new AbortController();
    const sig = { signal: this.abort.signal, passive: true };
    const onPointer = (e) => {
      if (!this.params.follow) return;
      if (e.pointerType === 'touch' && e.type === 'pointermove' && !e.pressure) return;
      this.touchEase = e.pointerType !== 'mouse' && e.pointerType !== 'pen';
      this.target.x = e.clientX;
      this.target.y = e.clientY;
      this.dirty.light = true;
      this.kick();
    };
    addEventListener('pointermove', onPointer, sig);
    addEventListener('pointerdown', onPointer, sig);
    addEventListener('scroll', () => { this.dirty.scroll = true; this.kick(); }, sig);
    addEventListener('resize', () => { this.dirty.layout = true; this.kick(); }, sig);
    document.addEventListener('visibilitychange', () => this.kick(), sig);
    document.addEventListener('animationend', () => { this.dirty.layout = true; this.kick(); }, sig);
    document.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') { this.dirty.layout = true; this.kick(); } }, sig);
    this.reduced.addEventListener('change', () => { if (this.reduced.matches) this.set({ follow: false }); }, sig);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.dirty.theme = true; this.kick(); }, sig);
    new MutationObserver(() => { this.dirty.theme = true; this.kick(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.fonts?.ready.then(() => { this.dirty.layout = true; this.kick(); });
    this.ro = new ResizeObserver(() => { this.dirty.layout = true; this.kick(); });
    this.ro.observe(document.documentElement);
    for (const it of this.items.values()) this.ro.observe(it.el);
  }

  _pickTier() {
    let t = this.params.tier;
    if (t === 'auto') {
      const mem = navigator.deviceMemory || 8;
      const cores = navigator.hardwareConcurrency || 8;
      const save = navigator.connection?.saveData;
      t = save ? 'low' : this.coarse.matches || mem <= 4 || cores <= 4 ? 'low' : 'balanced';
      if (this.autoTier) t = this.autoTier;
    }
    this.tierName = t;
    this.tier = TIERS[t] || TIERS.balanced;
    this.stats.tier = t;
  }

  _initFloor() {
    const want = this.tier.floor > 0;
    if (!want) { this.floor?.destroy(); this.floor = null; this.stats.gl = false; return; }
    if (this.floor) return;
    try {
      this.floor = new FloorRenderer(this.root);
      this.stats.gl = true;
      document.documentElement.classList.add('sill-gl');
    } catch (err) {
      console.warn('[sill] floor renderer unavailable, CSS-only light', err);
      this.floor = null;
      this.stats.gl = false;
      this.tierName = 'static';
      this.tier = TIERS.static;
      document.documentElement.classList.remove('sill-gl');
    }
  }

  _readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => { const s = cs.getPropertyValue(n).trim(); return s || d; };
    const num = (n, d) => { const x = parseFloat(v(n, '')); return Number.isFinite(x) ? x : d; };
    const floor = parseColor(v('--sill-floor', '#f4f1ec'));
    const sky = parseColor(v('--sill-sky', '#dfe6f2'));
    const amb = num('--sill-amb', 1);
    const key = num('--sill-key', 0.62);
    const floorLin = floor.map(toLinear);
    const skyLin = sky.map(toLinear);
    const skyLum = 0.2126 * skyLin[0] + 0.7152 * skyLin[1] + 0.0722 * skyLin[2];
    // Calibrate so the floor at a typical distance from the light, with the
    // default ambient, reproduces the theme's floor token. The pool brightens
    // it toward the light and the far field settles just below it.
    const ref = num('--sill-ref', amb * DEFAULTS.ambient + key * 0.42);
    this.theme = {
      floorLin,
      skyLin: skyLin.map((c) => c / Math.max(skyLum, 1e-4)),
      floorAlbedo: floorLin.map((c) => Math.min(1, c / ref)),
      amb,
      key,
      wash: num('--sill-wash', 0.07),
      spec: num('--sill-spec', 0.22),
      rim: num('--sill-rim', 0.5),
      cast: num('--sill-cast', 0.2),
      pool: num('--sill-pool', 1),
      liftMax: num('--sill-lift-max', 0.3),
      liftMaxBare: num('--sill-lift-max-bare', 0.6),
      bareGain: num('--sill-bare-gain', 1),
      shade: v('--sill-shade', '24 32 72'),
      bump: num('--sill-bump', 9),
      grain: num('--sill-grain', 0.05),
      dark: floorLin[0] + floorLin[1] + floorLin[2] < 0.3,
    };
  }

  /* ---------------- frame ---------------- */

  _frame(t) {
    this.raf = 0;
    const dt = this.lastT ? Math.min(64, t - this.lastT) : 16.7;
    this.lastT = t;
    if (document.hidden) return;
    const t0 = performance.now();

    if (this.dirty.theme) { this._readTheme(); this.dirty.theme = false; this.dirty.light = true; for (const s of this.stages) s.themeChanged?.(); }
    const vw = innerWidth, vh = innerHeight;
    if (this.dirty.layout) {
      this._measure();
      if (this.floor) this.floor.resize(vw, vh, Math.min(this.tier.floor, devicePixelRatio || 1));
      this.dirty.layout = false;
      this.dirty.light = true;
    }

    // Ease the light toward the pointer. Frame-rate independent.
    const tau = Math.max(1, this.params.smoothing * (this.touchEase ? 3 : 1));
    const a = 1 - Math.exp(-dt / tau);
    const dx = this.target.x - this.cur.x, dy = this.target.y - this.cur.y;
    const moving = Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05;
    if (moving) {
      this.cur.x += dx * a;
      this.cur.y += dy * a;
      this.dirty.light = true;
    } else {
      this.cur.x = this.target.x; this.cur.y = this.target.y;
    }

    const scrolled = this.dirty.scroll;
    if (this.dirty.light || scrolled) {
      this.dirty.light = false;
      this.dirty.scroll = false;
      this._render(vw, vh, moving || scrolled);
      if (moving || scrolled) {
        // One refine pass once the light comes to rest (stages render at full quality).
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => { this.refine = true; this.dirty.light = true; this.kick(); }, 160);
      }
    }

    const ms = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.9 + ms * 0.1;
    this._adapt(dt, moving);
    if (this.onFrame) this.onFrame(this.stats);
    if (moving || this.dirty.light || this.dirty.layout || this.dirty.scroll) this.kick();
  }

  _adapt(dt, moving) {
    if (this.params.tier !== 'auto' || !moving) return;
    // Sustained missed frames while the light moves: step down one tier.
    if (dt > 26) this.slow++; else this.slow = Math.max(0, this.slow - 1);
    if (this.slow > 24) {
      const order = ['high', 'balanced', 'low'];
      const i = order.indexOf(this.tierName);
      if (i >= 0 && i < order.length - 1) {
        this.autoTier = order[i + 1];
        this._pickTier();
        this.dirty.layout = true;
        this._emit();
      }
      this.slow = 0;
    }
  }

  _measure() {
    const sx = scrollX, sy = scrollY;
    for (const it of this.items.values()) {
      if (it.parentEl && !it.parent) it.parent = this.items.get(it.parentEl) || null;
      const r = it.el.getBoundingClientRect();
      it.doc = it.fixed ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
      it.radius = parseFloat(getComputedStyle(it.el).borderTopLeftRadius) || 0;
    }
    for (const s of this.stages) {
      const r = s.el.getBoundingClientRect();
      s.doc = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
      s.resize?.(r.width, r.height, Math.min(devicePixelRatio || 1, this.tier.stage));
    }
  }

  /* Resolve the light for this frame: position, direction, colour, size. */
  _resolveLight(vw, vh) {
    const p = this.params;
    const k = kelvin(p.temperature);
    const lc = k.map(toSRGB).map((c) => Math.round(c * 255)).join(' ');
    const lr = k.map((c) => lerp(c, 1, 0.45)).map(toSRGB).map((c) => Math.round(c * 255)).join(' ');
    const I = p.intensity;
    if (p.mode === 'sun') {
      const cx = vw * 0.5, cy = vh * 0.45;
      let dx = this.cur.x - cx, dy = this.cur.y - cy;
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = -0.6; dy = -0.8; }
      const R = Math.hypot(vw, vh) * 0.55;
      const e = lerp(72, 15, smooth(clamp(len / R, 0, 1))) * DEG;
      const tanE = Math.tan(e) / clamp(p.shadowLength, 0.2, 4);
      const hl = Math.hypot(dx, dy);
      const dir = [dx / hl, dy / hl, tanE];
      const dl = Math.hypot(...dir);
      dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
      return {
        sun: true, dir, x: cx + dir[0] * SUN_FAR, y: cy + dir[1] * SUN_FAR, z: dir[2] * SUN_FAR,
        size: 0, ang: lerp(0.012, 0.16, p.softness), k, lc, lr, I,
        floorCol: k.map((c) => c * I * this.theme.key * this.theme.pool),
      };
    }
    const z = LAMP_BASE / clamp(p.shadowLength, 0.2, 4);
    const dirRaw = [this.cur.x - vw / 2, this.cur.y - vh / 2, z];
    const dl = Math.hypot(...dirRaw);
    return {
      sun: false, dir: dirRaw.map((c) => c / dl), x: this.cur.x, y: this.cur.y, z,
      size: lerp(10, 210, p.softness), ang: 0, k, lc, lr, I,
      floorCol: k.map((c) => c * I * this.theme.key * this.theme.pool),
    };
  }

  /* Irradiance at a point at height h, relative to directly under the light. */
  _irr(L, x, y, h) {
    if (L.sun) return 1;
    const dz = Math.max(1, L.z - h);
    const d2 = (L.x - x) ** 2 + (L.y - y) ** 2 + dz * dz;
    return Math.pow((dz * dz) / d2, 1.5 * this.params.falloff);
  }

  _render(vw, vh, moving) {
    const L = this._resolveLight(vw, vh);
    this.lightInfo = L;
    if (this.params.enabled === false) return;
    const p = this.params, T = this.theme;
    const sx = scrollX, sy = scrollY;
    const occluders = [];
    let maxH = 8;
    const margin = 220;

    for (const it of this.items.values()) {
      const d = it.doc;
      const vr = it.fixed ? d : { x: d.x - sx, y: d.y - sy, w: d.w, h: d.h };
      it.vr = vr;
      it.visible = vr.x < vw + margin && vr.x + vr.w > -margin && vr.y < vh + margin && vr.y + vr.h > -margin && vr.w > 0;
      if (!it.visible) continue;
      const z = (it.base + it.depth) * p.depth;
      if (it.kind === 'type') { this._shadeType(it, L, z); continue; }
      this._shade(it, L, vw, vh, z);
      if (it.cast === 'floor' && occluders.length < MAX_OCCLUDERS) {
        occluders.push(this._occluder(it, L, z));
        maxH = Math.max(maxH, z);
      }
    }

    if (this.floor) {
      this.floor.render({ light: L, occluders, scrollY: sy, theme: T, params: p, tier: this.tier, hazeH: maxH * 1.15 });
    }

    const refine = this.refine && !moving;
    this.refine = false;
    for (const s of this.stages) {
      const d = s.doc;
      if (!d) continue;
      const vr = { x: d.x - sx, y: d.y - sy, w: d.w, h: d.h };
      if (vr.y > vh || vr.y + vr.h < 0) continue;
      s.render(this._stageLight(L, vr), { moving: moving && !refine, steps: this.tier.stageSteps });
    }
    this.stats.renders++;
    this.stats.floorScale = this.floor ? this.floor.size.scale : 0;
  }

  /* The occluder record the floor shader consumes. */
  _occluder(it, L, z) {
    const r = it.vr;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const hw = r.w / 2, hh = r.h / 2;
    let pcx, pcy, s, pen;
    if (L.sun) {
      pcx = cx - (L.dir[0] / L.dir[2]) * z;
      pcy = cy - (L.dir[1] / L.dir[2]) * z;
      s = 1;
      // Penumbra grows with the path from edge to floor, which lengthens as the sun drops.
      pen = (z / Math.max(L.dir[2], 0.08)) * L.ang * 1.2 + 0.8;
    } else {
      s = L.z / Math.max(1, L.z - z);
      pcx = L.x + (cx - L.x) * s;
      pcy = L.y + (cy - L.y) * s;
      pen = (L.size * z) / Math.max(1, L.z - z) + 0.8;
    }
    const aoReach = 6 + z * 1.05;
    const aoStr = clamp(0.62 - z / 160, 0.22, 0.62);
    return {
      sr: [pcx, pcy, hw * s, hh * s],
      sp: [it.radius * s, pen, it.opacity, 0],
      f: [cx, cy, hw, hh],
      fp: [it.radius, z, aoReach, aoStr],
    };
  }

  /* CSS surface response for one element. */
  _shade(it, L, vw, vh, z) {
    const r = it.vr, m = it.mat, p = this.params, T = this.theme;
    const gain = p.material * L.I;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const E = this._irr(L, cx, cy, z);

    // Diffuse wash: the light's footprint on the face.
    let wx, wy, wr;
    if (L.sun) {
      wx = cx + L.dir[0] * 1800 - r.x; wy = cy + L.dir[1] * 1800 - r.y; wr = 2600;
    } else {
      wx = L.x - r.x; wy = L.y - r.y; wr = clamp((L.z - z) * 1.3, 160, 1600);
    }
    let wa = T.wash * m.wash * gain * (L.sun ? 0.6 : 1) * (it.bare ? T.bareGain : 1);
    const wf = T.wash * 0.55 * clamp(p.shadow, 0, 1) * (L.sun ? 0 : 1) * (T.dark ? 0.6 : 1);

    // Specular: where the light reflects toward a viewer above the screen centre.
    const Vx = vw / 2, Vy = vh / 2, vz = VIEWER_Z - z;
    let Rx, Ry;
    if (L.sun) {
      Rx = Vx + (L.dir[0] / L.dir[2]) * vz; Ry = Vy + (L.dir[1] / L.dir[2]) * vz;
    } else {
      const lz = Math.max(1, L.z - z);
      Rx = (L.x * vz + Vx * lz) / (vz + lz); Ry = (L.y * vz + Vy * lz) / (vz + lz);
    }
    const softK = L.sun ? lerp(0.7, 1.4, p.softness) : 0.55 + L.size / 180;
    const srx = lerp(26, 300, m.rough) * softK;
    let sa = T.spec * m.spec * gain * Math.sqrt(E) * (1 - m.rough * 0.55) * (it.bare ? T.bareGain : 1);
    // Contrast guard: wash and specular can peak at the same point, under text.
    // Their sum never exceeds the theme's lift ceiling, whatever the sliders say.
    const cap = it.bare ? T.liftMaxBare : T.liftMax;
    const lift = wa + sa;
    if (lift > cap) { const k = cap / lift; wa *= k; sa *= k; }

    // Rim: four bevel normals tilted 45 degrees out of the face.
    const edges = [
      [cx, r.y, 0, -1],
      [r.x + r.w, cy, 1, 0],
      [cx, r.y + r.h, 0, 1],
      [r.x, cy, -1, 0],
    ];
    const rim = [];
    for (const [ex, ey, nx, ny] of edges) {
      let lx, ly, lz;
      if (L.sun) { [lx, ly, lz] = L.dir; } else {
        lx = L.x - ex; ly = L.y - ey; lz = L.z - z;
        const l = Math.hypot(lx, ly, lz); lx /= l; ly /= l; lz /= l;
      }
      const b = Math.max(0, (nx * lx + ny * ly) * 0.7071 + lz * 0.7071);
      const Ee = L.sun ? 1 : Math.sqrt(this._irr(L, ex, ey, z));
      rim.push(T.rim * m.rim * gain * Ee * (0.12 + 0.88 * b * b));
    }

    const f = (n) => n.toFixed(1);
    const g = (n) => clamp(n, 0, 1).toFixed(3);
    const css = `--lc:${L.lc};--lr:${L.lr};--sc:${T.shade};--wx:${f(wx)}px;--wy:${f(wy)}px;--wr:${f(wr)}px;--wa:${g(wa)};--wf:${g(wf)};--sx:${f(Rx - r.x)}px;--sy:${f(Ry - r.y)}px;--srx:${f(srx)}px;--sry:${f(srx * 0.78)}px;--sa:${g(sa)};--rt:${g(rim[0])};--rr:${g(rim[1])};--rb:${g(rim[2])};--rl:${g(rim[3])}`;
    if (css !== it.css) { it.layer.style.cssText = css; it.css = css; }

    if (it.cast === 'css') {
      const own = it.depth * p.depth;
      const base = z - own;
      let ox, oy, pen;
      if (L.sun) {
        ox = -(L.dir[0] / L.dir[2]) * own; oy = -(L.dir[1] / L.dir[2]) * own; pen = (own / Math.max(L.dir[2], 0.08)) * L.ang * 1.2;
      } else {
        const lz = Math.max(1, L.z - z);
        ox = ((cx - L.x) * own) / lz; oy = ((cy - L.y) * own) / lz; pen = (L.size * own) / Math.max(1, L.z - base);
      }
      const k = T.cast * clamp(p.shadow, 0, 1) * (L.sun ? 1 : 0.35 + 0.65 * E) * L.I;
      const blur = 2 * pen + own * 0.35 + 1;
      const sh = `${f(ox * 0.3)}px ${f(oy * 0.3)}px ${f(blur * 0.3 + 1)}px rgb(${T.shade} / ${g(k * 1.4)}), ${f(ox)}px ${f(oy)}px ${f(blur)}px rgb(${T.shade} / ${g(k)}), inset 0 0 0 var(--sl-ring-w, 1px) var(--sl-ring, transparent)`;
      if (sh !== it.shadow) { it.el.style.boxShadow = sh; it.shadow = sh; }
    }
  }

  /* Map the page light into a stage's own 3D frame (x right, y up, z toward the camera). */
  _stageLight(L, vr) {
    const cx = vr.x + vr.w / 2, cy = vr.y + vr.h / 2;
    // Screen basis: x right, y up, z out of the screen toward the viewer.
    // The stage maps this through its own camera, so the screen is its image plane.
    let d;
    if (L.sun) d = [L.dir[0], -L.dir[1], L.dir[2]];
    else d = [L.x - cx, -(L.y - cy), L.z];
    const len = Math.hypot(...d);
    d = d.map((c) => c / len);
    const E = L.sun ? 1 : this._irr(L, cx, cy, 0);
    return {
      dir: d,
      color: L.k.map((c) => c * L.I * (0.55 + 0.45 * E)),
      softness: this.params.softness,
      ambient: this.params.ambient,
      dark: this.theme.dark,
      sky: this.theme.skyLin,
    };
  }

  _emit() { for (const fn of this.listeners) fn(this); }
}
