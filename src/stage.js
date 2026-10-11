/*
  Sill stages: small signed-distance scenes for product shots, lit by the
  page light. A stage renders only when the light (or its own options)
  changes, at reduced step counts while the light moves and at full quality
  once it settles.

  Scenes are tiny SDF programs: a few rounded boxes, cylinders and capsules,
  so a stage stays cheap enough to re-light at pointer rate.
*/
import { linkProgram, uniformLocations, fullScreenTriangle, parseColor, toLinear } from './sill.js';

const lerp = (a, b, t) => a + (b - a) * t;

const SCENES = {
  lounge: {
    cam: [-1.75, 1.08, 2.45], target: [0.02, 0.33, 0], focal: 2.55,
    bmin: [-0.56, 0, -0.5], bmax: [0.56, 0.84, 0.46],
    map: `
      vec3 q = p; q.x = abs(q.x) - 0.5;
      float side = sdRoundBox(q - vec3(0., 0.24, 0.), vec3(0.03, 0.24, 0.4), 0.022);
      float rail = sdRoundBox(p - vec3(0., 0.165, 0.), vec3(0.48, 0.028, 0.35), 0.012);
      float wood = min(side, rail);
      float seat = sdRoundBox(p - vec3(0., 0.27, 0.035), vec3(0.462, 0.078, 0.355), 0.075);
      vec3 b = p - vec3(0., 0.555, -0.3); b.yz = rot(-0.22) * b.yz;
      float back = sdRoundBox(b, vec3(0.462, 0.235, 0.08), 0.078);
      float fab = smin(seat, back, 0.05);
      return fab < wood ? vec2(fab, 4.) : vec2(wood, 1.);`,
  },
  stool: {
    cam: [-0.95, 0.92, 1.7], target: [0, 0.24, 0], focal: 2.35,
    bmin: [-0.24, 0, -0.24], bmax: [0.24, 0.48, 0.24],
    map: `
      float seat = sdCyl(p - vec3(0., 0.455, 0.), 0.21, 0.022, 0.012);
      float legs = 1e9;
      for (int i = 0; i < 3; i++) {
        float a = float(i) * 2.0944 + 0.52;
        vec2 dr = vec2(cos(a), sin(a));
        legs = min(legs, sdCapsule(p, vec3(dr.x * 0.12, 0.44, dr.y * 0.12), vec3(dr.x * 0.205, 0.0, dr.y * 0.205), 0.017));
      }
      float ring = sdTorus(p - vec3(0., 0.17, 0.), vec2(0.172, 0.0085));
      return vec2(min(seat, min(legs, ring)), 1.);`,
  },
  table: {
    cam: [-0.95, 1.0, 1.75], target: [0, 0.26, 0], focal: 2.3,
    bmin: [-0.28, 0, -0.28], bmax: [0.28, 0.53, 0.28],
    map: `
      float top = sdCyl(p - vec3(0., 0.5, 0.), 0.27, 0.028, 0.009);
      float stem = sdCyl(p - vec3(0., 0.25, 0.), 0.068, 0.23, 0.004);
      float base = sdCyl(p - vec3(0., 0.022, 0.), 0.19, 0.022, 0.009);
      return vec2(min(top, min(stem, base)), 3.);`,
  },
  bench: {
    cam: [-1.25, 1.02, 2.3], target: [0.04, 0.22, 0], focal: 2.9,
    bmin: [-0.64, 0, -0.19], bmax: [0.64, 0.45, 0.19],
    map: `
      float seat = sdRoundBox(p - vec3(0., 0.415, 0.), vec3(0.62, 0.028, 0.17), 0.011);
      vec3 q = p; q.x = abs(q.x) - 0.5;
      float legs = sdRoundBox(q - vec3(0., 0.2, 0.), vec3(0.026, 0.2, 0.155), 0.008);
      return vec2(min(seat, legs), 2.);`,
  },
};

const VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0., 1.); }`;

const FS = (scene) => `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uL;
uniform vec3 uLC;
uniform vec3 uSky;
uniform vec3 uBounce;
uniform vec3 uBack;
uniform vec3 uFloorC;
uniform vec3 uFabric;
uniform float uK;
uniform vec3 uCam;
uniform vec3 uTgt;
uniform float uFocal;
uniform vec3 uBMin;
uniform vec3 uBMax;
uniform int uSteps;
uniform int uShSteps;
out vec4 outColor;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r; }
float sdCyl(vec3 p, float r, float h, float rr){ vec2 d = vec2(length(p.xz) - r + rr, abs(p.y) - h + rr); return min(max(d.x, d.y), 0.) + length(max(d, 0.)) - rr; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * 0.25; }

vec2 map(vec3 p){ ${scene.map} }

float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec2 box(vec3 ro, vec3 rd){
  vec3 inv = 1. / rd;
  vec3 t0 = (uBMin - 0.02 - ro) * inv, t1 = (uBMax + 0.02 - ro) * inv;
  vec3 mn = min(t0, t1), mx = max(t0, t1);
  return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}

vec3 normal(vec3 p){
  const vec2 e = vec2(1., -1.) * 0.0007;
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float shadow(vec3 ro, vec3 rd){
  vec2 b = box(ro, rd);
  if (b.y < max(b.x, 0.)) return 1.;
  float res = 1., t = max(b.x, 0.012), ph = 1e10;
  for (int i = 0; i < 64; i++) {
    if (i >= uShSteps) break;
    float h = map(ro + rd * t).x;
    float y = h * h / (2. * ph);
    float d = sqrt(max(h * h - y * y, 0.));
    res = min(res, uK * d / max(0.0001, t - y));
    ph = h;
    t += clamp(h, 0.006, 0.12);
    if (res < 0.002 || t > b.y) break;
  }
  res = clamp(res, 0., 1.);
  return res * res * (3. - 2. * res);
}

float ao(vec3 p, vec3 n){
  float o = 0., s = 1.;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.13 * float(i) / 4.;
    o += (h - map(p + h * n).x) * s;
    s *= 0.92;
  }
  return clamp(1. - 2.6 * o, 0., 1.);
}

vec3 material(float id, vec3 p, inout vec3 n, out float rough, out float spec, out float sheen){
  sheen = 0.;
  if (id < 1.5) {           // oiled white oak
    float w = p.y * 150. + p.z * 70. + p.x * 18. + n3(p * vec3(5., 24., 24.)) * 7.;
    float g = 0.5 + 0.5 * sin(w);
    rough = 0.52; spec = 0.5;
    return mix(vec3(0.5, 0.31, 0.15), vec3(0.36, 0.21, 0.09), g * 0.35 + n3(p * 40.) * 0.2);
  }
  if (id < 2.5) {           // smoked walnut
    float w = p.x * 26. + p.y * 160. + n3(p * vec3(3., 30., 30.)) * 8.;
    float g = 0.5 + 0.5 * sin(w);
    rough = 0.42; spec = 0.6;
    return mix(vec3(0.115, 0.06, 0.032), vec3(0.07, 0.036, 0.02), g * 0.5 + n3(p * 50.) * 0.25);
  }
  if (id < 3.5) {           // honed travertine
    float v = n3(p * vec3(7., 46., 7.)) * 0.6 + n3(p * 22.) * 0.4;
    float pit = smoothstep(0.74, 0.8, n3(p * 150.));
    rough = 0.66; spec = 0.35;
    return mix(vec3(0.66, 0.56, 0.43), vec3(0.52, 0.42, 0.31), v * 0.45) * (1. - pit * 0.3);
  }
  // wool boucle
  float b = n3(p * 230.);
  n = normalize(n + (vec3(n3(p * 230. + 3.1), n3(p * 230. + 7.7), n3(p * 230. + 13.3)) - 0.5) * 0.45);
  rough = 0.95; spec = 0.06; sheen = 0.5;
  return uFabric * (0.86 + 0.26 * b);
}

vec3 light(vec3 p, vec3 n, vec3 rd, vec3 alb, float rough, float spec, float sheen, float sh, float o){
  float ndl = max(dot(n, uL), 0.);
  vec3 h = normalize(uL - rd);
  float shin = mix(6., 180., (1. - rough) * (1. - rough));
  float sp = pow(max(dot(n, h), 0.), shin) * (shin + 8.) / 25.13;
  float nv = max(dot(n, -rd), 0.);
  float fr = 0.04 + 0.96 * pow(1. - nv, 5.);
  vec3 amb = mix(uBounce, uSky, 0.5 + 0.5 * n.y) * o;
  vec3 c = alb * (uLC * ndl * sh + amb);
  c += uLC * sp * spec * ndl * sh * mix(0.25, 1., fr);
  vec3 r = reflect(rd, n);
  vec3 env = mix(uBounce, uSky * 1.15, smoothstep(-0.25, 0.7, r.y)) * o;
  env += uLC * pow(max(dot(r, uL), 0.), mix(3., 70., 1. - rough)) * 0.7 * sh;
  c += env * fr * (1. - rough) * spec;
  c += uLC * alb * sheen * pow(1. - nv, 3.) * (0.3 + 0.7 * ndl) * sh;
  return c;
}

vec3 encode(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 softclip(vec3 c){ vec3 k = 0.82 + 0.18 * (1. - exp(-(c - 0.82) / 0.18)); return mix(c, k, step(0.82, c)); }

void main(){
  vec2 uv = (2. * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 ww = normalize(uTgt - uCam), uu = normalize(cross(ww, vec3(0, 1, 0))), vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + uFocal * ww);
  vec3 ro = uCam;

  // Backdrop: the stage's sweep, lightly answering the key.
  vec3 back = uBack * (0.72 + 0.28 * (uLC.r + uLC.g + uLC.b) / 3.) ;
  vec3 col = back;

  float tf = rd.y < 0. ? -ro.y / rd.y : 1e9;
  float hit = -1., t = 0.;
  vec2 b = box(ro, rd);
  if (b.y > max(b.x, 0.) && b.x < tf) {
    t = max(b.x, 0.);
    float tm = min(b.y, tf);
    for (int i = 0; i < 160; i++) {
      if (i >= uSteps) break;
      vec2 h = map(ro + rd * t);
      if (h.x < 0.0004 * t) { hit = h.y; break; }
      t += h.x;
      if (t > tm) break;
    }
  }

  if (hit > 0.) {
    vec3 p = ro + rd * t;
    vec3 n = normal(p);
    float rough, spec, sheen;
    vec3 alb = material(hit, p, n, rough, spec, sheen);
    float sh = shadow(p + n * 0.003, uL);
    col = light(p, n, rd, alb, rough, spec, sheen, sh, ao(p, n));
  } else if (tf < 1e8) {
    vec3 p = ro + rd * tf;
    float sh = shadow(p + vec3(0., 0.002, 0.), uL);
    vec3 bc = uBMin + (uBMax - uBMin) * 0.5;
    float near = length(max(abs(p - bc) - (uBMax - uBMin) * 0.5, 0.));
    float o = near < 0.4 ? ao(p, vec3(0., 1., 0.)) : 1.;
    vec3 fl = uFloorC * (uSky * o * 0.9 + uLC * max(uL.y, 0.) * sh);
    float fade = smoothstep(1.2, 3.4, length(p.xz * vec2(0.8, 1.)));
    col = mix(fl, back, fade);
  }

  col = encode(softclip(max(col, 0.)));
  col += (h2(gl_FragCoord.xy) - 0.5) / 255.;
  outColor = vec4(col, 1.);
}`;

export class Stage {
  constructor(el, sceneName, opts = {}) {
    this.el = el;
    this.scene = SCENES[sceneName];
    if (!this.scene) throw new Error(`unknown stage scene ${sceneName}`);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sill-stage';
    this.canvas.setAttribute('aria-hidden', 'true');
    el.append(this.canvas);
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2 unavailable');
    this.gl = gl;
    this.prog = linkProgram(gl, VS, FS(this.scene));
    this.loc = uniformLocations(gl, this.prog);
    this.vao = fullScreenTriangle(gl, this.prog);
    this.opts = { fabric: '#cfc6b6', ...opts };
    this.fabricLin = parseColor(this.opts.fabric).map(toLinear);
    this.w = 0; this.h = 0;
    this.themeChanged();
  }

  themeChanged() {
    const cs = getComputedStyle(this.el);
    const back = parseColor(cs.getPropertyValue('--stage-back') || '#efebe5').map(toLinear);
    const floor = parseColor(cs.getPropertyValue('--stage-floor') || '#f1ede7').map(toLinear);
    this.back = back;
    // The stage floor reproduces its token under the default key + sky (about 0.68).
    this.floorAlb = floor.map((c) => Math.min(1, c / 0.68));
    this.last = null;
  }

  set(opts) {
    Object.assign(this.opts, opts);
    if (opts.fabric) this.fabricLin = parseColor(opts.fabric).map(toLinear);
    if (this.lastLight) this.render(this.lastLight, { moving: false, steps: this.lastSteps || 1 });
  }

  resize(w, h, dpr) {
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (W === this.w && H === this.h) return;
    this.w = W; this.h = H;
    this.canvas.width = W;
    this.canvas.height = H;
  }

  /* Screen-basis light direction to world, through the camera's axes. */
  toWorld([x, y, z]) {
    const { cam, target } = this.scene;
    const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
    const ww = norm(target.map((c, i) => c - cam[i]));
    const uu = norm([-ww[2], 0, ww[0]]);
    const vv = [uu[1] * ww[2] - uu[2] * ww[1], uu[2] * ww[0] - uu[0] * ww[2], uu[0] * ww[1] - uu[1] * ww[0]];
    let d = [0, 1, 2].map((i) => x * uu[i] + y * vv[i] - z * ww[i]);
    d = norm(d);
    // Keep the key above the horizon: furniture is not lit from under the floor.
    if (d[1] < 0.16) d[1] = 0.16 + (d[1] - 0.16) * 0.1;
    return norm(d);
  }

  render(L, { moving = false, steps = 1 } = {}) {
    this.lastLight = L;
    this.lastSteps = steps;
    const { gl, loc, scene } = this;
    if (!this.w) return;
    const q = moving ? steps * 0.6 : 1;
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.prog);
    gl.uniform2f(loc.uRes, this.w, this.h);
    gl.uniform3fv(loc.uL, this.toWorld(L.dir));
    gl.uniform3fv(loc.uLC, L.color.map((c) => c * 0.95));
    const amb = L.ambient * 0.85;
    const sky = L.sky.map((c) => c * amb * 0.55);
    gl.uniform3fv(loc.uSky, sky);
    gl.uniform3fv(loc.uBounce, this.back.map((c, i) => c * amb * 0.5 * (0.6 + 0.4 * L.color[i])));
    gl.uniform3fv(loc.uBack, this.back);
    gl.uniform3fv(loc.uFloorC, this.floorAlb);
    gl.uniform3fv(loc.uFabric, this.fabricLin);
    gl.uniform1f(loc.uK, lerp(42, 5, L.softness));
    gl.uniform3fv(loc.uCam, scene.cam);
    gl.uniform3fv(loc.uTgt, scene.target);
    gl.uniform1f(loc.uFocal, scene.focal);
    gl.uniform3fv(loc.uBMin, scene.bmin);
    gl.uniform3fv(loc.uBMax, scene.bmax);
    gl.uniform1i(loc.uSteps, Math.round(110 * Math.max(0.5, q)));
    gl.uniform1i(loc.uShSteps, Math.round(56 * Math.max(0.4, q)));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
