# Sill

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/LE-VAI/sill/main/docs/media/hero-poster.png">
    <img src="https://raw.githubusercontent.com/LE-VAI/sill/main/docs/media/hero-loop.webp" width="800" alt="A dark interface lit by the mouse pointer. A large serif headline, Lit by the pointer, casts shadows that swing as the cursor moves, then a keypad of raised keys catches moving highlights.">
  </picture>
</p>
<p align="center"><sub>A 4.7-second loop from the live page, captured frame by frame. It shows a still frame if you prefer reduced motion. <a href="https://le-vai.github.io/sill/">Try it live</a>.</sub></p>

Real-time light for interfaces. The pointer is the light: cards, controls and
type cast shadows projected from it, catch highlights where a real surface
would, and light up on the edge facing it.

Your interface stays real HTML. Text, buttons, focus and screen readers work
exactly as before. Sill lights them.

Mark up what should take the light:

```html
<article class="card" data-lit data-material="satin" data-depth="16">
  <h2 data-lit="type" data-depth="10">Lit by the pointer.</h2>
  <button data-lit data-material="gloss" data-depth="6">Apply</button>
</article>
```

With a bundler (Vite, webpack, esbuild):

```bash
npm install @designesy/sill
```

```js
import '@designesy/sill/sill.css';
import { Sill } from '@designesy/sill';

new Sill({ params: { mode: 'lamp', temperature: 3200 } });
```

Without a build step, straight from a CDN:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@designesy/sill@0.1.2/src/sill.css">
<script type="module">
  import { Sill } from 'https://cdn.jsdelivr.net/npm/@designesy/sill@0.1.2/src/sill.js';
  new Sill({ params: { mode: 'lamp', temperature: 3200 } });
</script>
```

## What it does

- **Cast shadows.** One WebGL2 pass treats every lit card as a rounded rectangle at
  a known height and projects it from the light. The penumbra grows with
  elevation, so a button's shadow is crisp and a floating card's is soft.
  Overlapping shadows never darken twice.
- **Surfaces that answer the light.** Each lit element gets a light layer beneath
  its content: a soft wash, a highlight placed where the light would reflect
  toward your eye, and edge light worked out for each side.
- **Lit type.** `data-lit="type"` makes a heading stand off the page and cast
  shadows from the pointer, with a thin rim on the side facing the light.
- **Materials.** Matte, satin, gloss, metal, fabric, wood, stone and glass each
  reflect the same light differently.
- **Lamp or sun.** A lamp at the pointer, or a sun the pointer moves across the
  sky, with optional skylight mullions and haze.
- **Product stages.** Small signed-distance-field scenes lit by the same light
  (`@designesy/sill/stage.js`).

## Before and after

<p align="center">
  <img src="https://raw.githubusercontent.com/LE-VAI/sill/main/docs/media/before-after.png" width="800" alt="Split view of the same page. Left of a warm divider line, Sill: a pool of lamp light and shadows. Right, static shadows on a flat dark background.">
</p>

## Accessibility

- **Text never sits under the light.** The light layer paints between a surface
  and its content, so brightness changes never cover text.
- **Contrast is capped.** Wash and highlight over a face that carries text never
  exceed a theme ceiling (`--sill-lift-max`), whatever the sliders say. Faces with
  no text may take more light. Both are covered by tests.
- **Reduced motion parks the light.** Under `prefers-reduced-motion`, the light
  does not follow the pointer; a keyboard-operable position pad moves it on
  purpose.
- **`prefers-contrast: more`** lowers wash, highlight and rim.
- **No WebGL?** The page keeps its own token shadows. `enabled: false` turns the
  light off completely.
- **Touch** moves the light to the point of contact. There is no fake hover.

## Performance

Nothing renders while the pointer is still. In our measurements Sill held 60 fps
with the light moving and the page scrolling, with 0.29 to 0.39 ms of its own
script per frame, on one machine with an integrated GPU. Conditions and limits are in
[docs/PERFORMANCE.md](docs/PERFORMANCE.md). Five tiers (`auto`, `high`,
`balanced`, `low`, `static`) trade resolution for headroom, and `auto` steps down
on sustained missed frames.

## API

```js
import { Sill, PRESETS, MATERIALS } from '@designesy/sill';

const sill = new Sill({ root: document.body, params: { mode: 'sun' } });
sill.set({ intensity: 1.2, shadowLength: 1.6 });
sill.preset('golden');         // morning | noon | golden | lamp
sill.moveTo(640, 220, true);   // place the light; true skips easing
sill.subscribe((s) => console.log(s.params));
sill.scan();                   // after adding [data-lit] elements
sill.destroy();
```

| Param | Range | Controls |
|---|---|---|
| `mode` | `lamp`, `sun` | light source |
| `follow` | boolean | pointer tracking (off under reduced motion) |
| `intensity` | 0 to 1.6 | key strength |
| `temperature` | 2200 to 7500 K | key colour |
| `shadowLength` | 0.4 to 2.6 | lamp height or sun elevation |
| `softness` | 0 to 1 | light size, so penumbra width |
| `falloff` | 0.2 to 2 | lamp inverse-square strength |
| `depth` | 0 to 2.5 | multiplies every elevation |
| `material` | 0 to 2 | highlight, rim and wash response |
| `ambient` | 0.1 to 1 | sky fill |
| `rays` | 0 to 1 | haze visibility |
| `shadow` | 0 to 1 | cast shadow strength |
| `aperture` | boolean | sun skylight mullions |
| `smoothing` | ms | pointer easing |
| `tier` | `auto`, `high`, `balanced`, `low`, `static` | performance tier |
| `enabled` | boolean | the off switch |

| Attribute | Meaning |
|---|---|
| `data-lit` | light this element |
| `data-lit="type"` | lit type: glyph shadows and rim |
| `data-material` | `matte`, `satin`, `gloss`, `metal`, `fabric`, `wood`, `stone`, `glass` |
| `data-depth` | elevation in px above its parent surface |
| `data-opacity` | how much light it blocks (glass, 0 to 1) |
| `data-cast` | `floor` (WebGL) or `css` (box-shadow onto its parent); inferred by default |

Themes own the numbers through CSS tokens: `--sill-floor`, `--sill-sky`,
`--sill-shade`, `--sill-key`, `--sill-amb`, `--sill-wash`, `--sill-spec`,
`--sill-rim`, `--sill-cast`, `--sill-lift-max`, `--sill-lift-max-bare` and more.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

A ready-made control panel ships as `@designesy/sill/panel.js` with
`@designesy/sill/panel.css`.

## How it relates to prior art

| | Sill | vanilla-tilt.js | Shadow palette generators | Cursor-glow cards |
|---|---|---|---|---|
| Light source follows the pointer | yes | glare overlay | no, static light | glow only |
| Shadows move with the light | yes | no | no | no |
| Penumbra grows with elevation | yes | no | yes, fixed per elevation | no |
| Highlights at the reflection point | yes | no | no | no |
| Text contrast guard | yes | no | not applicable | no |
| Interface stays real HTML | yes | yes | yes | yes |

vanilla-tilt tilts elements in 3D and is lovely at it. Shadow palette
generators, such as Josh W. Comeau's, produce consistent static shadows from
one implied light. Sill adds the light itself, moving, with physically
derived shadows and an accessibility floor.

## Demos

Live at [le-vai.github.io/sill](https://le-vai.github.io/sill/): the specimen, the
furniture landing page, and the wordmark. To run them locally:

```bash
python -m http.server 4731
```

Then open `http://localhost:4731/`.

## Browser support

The floor shadows and product stages need WebGL2. The surface layer uses CSS
masks and `color-mix()`. All three demos render the same in Chrome 154 and
Firefox 152 on Windows, with no console errors. Safari is not yet tested, and
performance has only been measured in Chrome.

## License

MIT © 2026 LE-VAI. Part of the Designesy stack.
