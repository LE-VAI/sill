# Changelog

## 0.1.2 (2026-10-13)

- Fix: when a theme does not set `--sill-bump` or `--sill-grain`, surfaces fall
  back to a fine satin texture (1.4 and 0.03). They fell back to 9 and 0.05,
  which rendered as stucco on any page that relied on the defaults. The values
  are exported as `THEME_FALLBACKS` and covered by a test.
- Demos: moved to the Designesy identity v1 palette (Azure, Deep Azure, ink on
  Azure, Atkinson Hyperlegible Mono), with a CI test that fails on any retired
  brand colour.
- Demos: the landing page, Specimen and Wordmark use 5600 K neutral daylight
  with haze off. Warm light remains available through presets and parameters;
  library defaults are unchanged.

## 0.1.1 (2026-10-13)

Fixes only; the library code is unchanged.

- README: the quickstart no longer links the stylesheet by a bare package path,
  which only a bundler can resolve. It now shows a bundler setup and a no-build
  CDN setup, both of which load the styles.
- README: images use absolute URLs, so they render wherever the README is shown.
- Tested in Firefox 152: all three demos render the same as in Chrome, with no
  console errors. The browser support notes say so.
- Live demos at https://le-vai.github.io/sill/, now the package homepage.

## 0.1.0 (2026-10-11)

First release: cast shadows (WebGL2), surface light layer (CSS), lit type,
product stages, lamp and sun modes, five performance tiers, the off switch, and
the text-scoped contrast guard.
