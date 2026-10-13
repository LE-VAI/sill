# Performance

Sill renders only when something changes. Pointer input sets a target; one
`requestAnimationFrame` loop eases the light toward it, renders while it moves,
and stops when it settles. At rest it does no work.

## Measured

One machine, one browser, so treat these as a data point rather than a guarantee.

| Condition | Result |
|---|---|
| Pointer circling the page for 3 s, every tier | 95th-percentile frame 17.1 to 17.2 ms (60 fps), 0 frames over 20 ms on balanced |
| High tier, the one frame where the tier switched | 33.6 ms (shader warm-up), once |
| Scrolling 2400 px in 2.5 s, every tier | 95th-percentile frame 17.2 ms or better |
| Sill's own script per frame | 0.29 to 0.39 ms |

Conditions: Chrome 154 on Windows, a 1440x900 window at 80% page zoom
(1800x1125 CSS px), the demo page with 31 lit surfaces and 4 product stages.
The machine's GPU is an Intel UHD integrated part. The harness dispatches
synthetic pointer events every frame and records `requestAnimationFrame`
intervals, so it reports missed frames, not GPU time.

## Not measured

- GPU time directly (no timer query).
- Firefox performance (it renders the demos the same as Chrome, but frame times were not measured there).
- Safari.
- Real phones (touch was emulated).

## Tiers

| Tier | Floor resolution | Haze | Product stages |
|---|---|---|---|
| high | 0.75x | 12 steps | up to 2x DPR |
| balanced | 0.5x | 8 steps | up to 1.5x DPR |
| low | 0.34x | off | 1.5x DPR, fewer steps |
| static | no WebGL floor | off | 1.5x DPR |

`tier: 'auto'` starts on balanced (low on coarse pointers, small memory or
data saver) and steps down one tier after sustained missed frames while the
light moves.
