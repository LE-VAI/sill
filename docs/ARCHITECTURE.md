# Sill: real-time light for interfaces

Status: 0.1.0. Demos: `demo/specimen/` and `demo/furniture/`.

## Decision

**A hybrid system: the DOM stays the interface; light is computed analytically.**
One light model, three renderers that read the same resolved light each frame.

| Option considered | Verdict | Why |
|---|---|---|
| CSS only (computed box-shadows, gradients) | Rejected as the core, kept as a layer | Stacked shadows multiply where they overlap (the "muddy" failure), there is no penumbra that grows with height, no volumetrics. |
| Render the UI into WebGL (DOM-to-texture, Three.js scene) | Rejected | Loses text crispness, selection, find-in-page, screen readers, native controls. The interface would become a picture of an interface. |
| Shadow maps (Three.js lights) | Rejected | Rasterises occluders it already knows exactly; costs a depth pass per light for an approximation of a rectangle. |
| **Analytic occluders + CSS surface layer + SDF stages** | **Chosen** | Every card is a known rounded rectangle at a known height, so shadows, AO and haze are closed-form per pixel. No depth pass, no texture readback, no text in the GPU path. |

## The light model (`src/sill.js`)

Coordinates: viewport CSS px, x right, y down, z out of the screen. Floor z = 0; a lit
element floats at `z = base + data-depth` (nested depths add up).

- **Lamp:** an area light at the pointer, height `660 / shadowLength`, radius from `softness`.
- **Sun:** directional. Pointer azimuth relative to the viewport centre sets azimuth;
  distance from centre sets elevation (72° → 15°). An optional skylight aperture casts
  soft mullion bars.
- Colour from kelvin (Tanner Helland fit), intensity and ambient from params, gains from
  theme tokens (`--sill-*`).

## Renderer 1: floor (WebGL2, one full-screen pass)

Per pixel, for up to 32 visible occluders:

- **Cast shadow:** the footprint projected from the light (`s = Lz / (Lz − z)`), evaluated as a
  rounded-box SDF with penumbra `size · z / (Lz − z)`. Contact hardening comes from the
  physics, not from a tuning curve. Overlaps combine with `max`, so two shadows never
  darken twice.
- **Ambient occlusion:** quadratic falloff from the real footprint, reach ∝ elevation.
- **Volumetric haze:** an exact slab test of the column between the floor and the card,
  giving the occluded height of the air above each pixel. Rays read as soft shadow
  shafts, never as a glow on the cursor.
- **Plaster:** a faint height field. Grazing light reveals it, overhead light hides it.
- Linear light, soft-clip shoulder (no bloom), sRGB encode, dither against banding.
- Rendered at 0.34–0.75× resolution (tier). The canvas is absolutely positioned and
  re-anchored on each render, so between renders it scrolls with the content and
  shadows stay glued to their cards.

## Renderer 2: surfaces (CSS, `src/sill.css`)

Each `[data-lit]` element gets one injected `.sl` layer between its face and its content
(`isolation: isolate` + `z-index: -1`). Text is never under the light.

- **Wash:** the light's footprint on the face (inverse-square).
- **Specular:** placed at the true reflection point toward a virtual eye 1500 px above the
  screen centre. It sits between the pointer and the centre, not under the cursor.
- **Rim:** four 45° bevel normals, each `N·L`, on a 1 px ring. The edge facing the light
  catches it.
- **Nested casts:** controls on a card cast through a `box-shadow` derived from the same
  light (offset, penumbra, contact layer), on their own compositing layer so the card's
  text is not repainted.
- **Contrast guard:** wash + specular alpha is capped at `--sill-lift-max` per theme, so no
  slider can push text below 4.5:1.

## Renderer 3: stages (`src/stage.js`)

Small SDF scenes (lounge chair, stool, side table, bench) in their own WebGL2 canvases.
The page light maps through each stage camera's basis, so the screen is the stage's image
plane. Soft shadows use iq's improved penumbra; there is bounding-box early-out for both
primary and shadow rays, hemisphere ambient with AO, and a GGX-like specular with an
environment term. Stages render only when the light changes: reduced steps while it
moves, full quality 160 ms after it settles.

## Scheduling

Nothing renders at rest. Pointer input sets a target; one rAF loop eases toward it
(frame-rate independent, τ = 36 ms mouse, 108 ms touch), renders while it moves, and
stops when it settles. Layout is read once per change (ResizeObserver, fonts, animation
end), never per frame.

## Public API

```js
import { Sill, PRESETS, MATERIALS } from '@designesy/sill';
import { Stage } from '@designesy/sill/stage.js';
import { mountPanel } from '@designesy/sill/panel.js';

const sill = new Sill({ root: document.body, params: { mode: 'lamp', temperature: 3900 } });
sill.set({ intensity: 1.2, shadowLength: 1.6 });   // any param below
sill.preset('golden');                              // morning | noon | golden | lamp
sill.moveTo(x, y, instant);                         // place the light (follow off)
sill.addStage(new Stage(el, 'lounge'));
mountPanel(sill, { onTheme });
```

Markup: `data-lit`, `data-material` (matte, satin, gloss, metal, fabric, wood, stone, glass),
`data-depth` (px), `data-opacity` (glass), `data-cast` (floor | css).

| Param | Range | Controls |
|---|---|---|
| mode | lamp / sun | source type |
| follow | bool | pointer tracking |
| intensity | 0–1.6 | key strength |
| temperature | 2200–7500 K | key colour |
| shadowLength | 0.4–2.6 | lamp height / sun elevation |
| softness | 0–1 | light size → penumbra |
| falloff | 0.2–2 | lamp inverse-square |
| depth | 0–2.5 | multiplies every elevation |
| material | 0–2 | specular, rim and wash response |
| ambient | 0.1–1 | sky fill |
| rays | 0–1 | haze visibility |
| shadow | 0–1 | cast strength |
| aperture | bool | sun skylight mullions |
| smoothing | ms | pointer easing |
| tier | auto / high / balanced / low / static | performance tier |

Theme tokens: `--sill-floor --sill-sky --sill-shade --sill-key --sill-amb --sill-ref --sill-wash
--sill-spec --sill-rim --sill-cast --sill-ring --sill-bump --sill-grain --sill-lift-max`.

## Accessibility

- `prefers-reduced-motion`: follow defaults off and the light is parked; the panel's position
  pad (arrow keys, Shift for bigger steps) moves it on purpose.
- Touch: the light moves to the point of contact with heavier easing; no fake hover.
- `prefers-contrast: more` lowers wash, specular and rim. The contrast guard holds at every
  slider value.
- All canvases are `aria-hidden`; each stage carries `role="img"` and a description.
- No WebGL: CSS-only light plus token elevation shadows; the page stays complete.

## Lit type, the off switch and the scoped contrast guard

- **Lit type** (`data-lit="type"`): a heading whose glyphs stand off the surface. Sill writes
  a contact shadow, a soft cast shadow, and a 1 px light-side rim straight into
  `text-shadow`, all derived from the same light. The glyph fill never changes, so contrast
  is untouched. The element gets its own layer, so only its glyphs repaint.
- **Off switch** (`sill.set({ enabled: false })`): no floor, no light layers, no casts. The
  page falls back to its own token elevation. This is the honest "before" for a comparison,
  and a kill switch for accessibility or performance.
- **Text-scoped contrast guard**: `--sill-lift-max` binds only faces that carry text. Bare
  faces (key trays, material swatches) use `--sill-lift-max-bare` and `--sill-bare-gain`,
  so they can take a real pool of light without any risk to text contrast.
- **`src/panel.css`**: the light panel's styles ship with the system, with token fallbacks.
- **`demo/specimen/`**: a purpose-built surface for Sill to perform on: lit headline, key field
  of stepped heights, console with live controls, material quartet, floating glass card,
  plus `end.html` (the lit wordmark).

## Next increments

1. A frustum-style culling list so pages with more than 32 visible lit surfaces degrade gracefully (today they are capped).
2. A GPU timer query (`EXT_disjoint_timer_query_webgl2`) where available, feeding tier adaptation.
3. Stage G-buffer caching (primary rays computed once; only lighting per frame).
