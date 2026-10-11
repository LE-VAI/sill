// Type definitions for @designesy/sill

export type LightMode = 'lamp' | 'sun';
export type Tier = 'auto' | 'high' | 'balanced' | 'low' | 'static';
export type MaterialName = 'matte' | 'satin' | 'gloss' | 'metal' | 'fabric' | 'wood' | 'stone' | 'glass';
export type PresetName = 'morning' | 'noon' | 'golden' | 'lamp';

export interface SillParams {
  /** 'lamp': an area light at the pointer. 'sun': directional; the pointer sets its place in the sky. */
  mode: LightMode;
  /** Light follows the pointer. Defaults to false under prefers-reduced-motion. */
  follow: boolean;
  /** Key light strength, 0 to 1.6. */
  intensity: number;
  /** Light colour in kelvin, 2200 to 7500. */
  temperature: number;
  /** Above 1 lowers the light: longer shadows. 0.4 to 2.6. */
  shadowLength: number;
  /** Light size, 0 to 1: penumbra width. */
  softness: number;
  /** Lamp inverse-square strength, 0.2 to 2. */
  falloff: number;
  /** Multiplies every element's elevation, 0 to 2.5. */
  depth: number;
  /** Multiplies specular, rim and wash response, 0 to 2. */
  material: number;
  /** Sky fill, 0.1 to 1. */
  ambient: number;
  /** Haze visibility, 0 to 1. */
  rays: number;
  /** Cast shadow strength, 0 to 1. */
  shadow: number;
  /** Sun mode: soft skylight mullions between the sun and the page. */
  aperture: boolean;
  /** Pointer easing time constant in ms (touch uses three times this). */
  smoothing: number;
  /** Performance tier. 'auto' picks from the device and steps down on missed frames. */
  tier: Tier;
  /** false: no light at all; the page shows its own static token shadows. */
  enabled: boolean;
}

export interface Material {
  spec: number;
  rough: number;
  rim: number;
  wash: number;
}

export interface TierSpec {
  floor: number;
  rays: boolean;
  hazeSteps: number;
  stage: number;
  stageSteps: number;
}

export interface SillStats {
  frameMs: number;
  renders: number;
  tier: Exclude<Tier, 'auto'>;
  floorScale: number;
  gl: boolean;
}

export declare const DEFAULTS: SillParams;
export declare const MATERIALS: Record<MaterialName, Material>;
export declare const PRESETS: Record<PresetName, Partial<SillParams>>;
export declare const TIERS: Record<Exclude<Tier, 'auto'>, TierSpec>;

/** Kelvin to linear RGB, normalised so the brightest channel is 1. */
export declare function kelvin(k: number): [number, number, number];
/** sRGB channel (0 to 1) to linear light. */
export declare function toLinear(c: number): number;
/** Any CSS colour to sRGB channels 0 to 1 (needs a DOM). */
export declare function parseColor(css: string): [number, number, number];

export interface SillOptions {
  /** Element whose [data-lit] descendants are lit; the floor canvas mounts here. Default document.body. */
  root?: HTMLElement;
  params?: Partial<SillParams>;
  onFrame?: ((stats: SillStats) => void) | null;
}

export declare class Sill {
  static defaults: SillParams;
  constructor(options?: SillOptions);
  readonly params: SillParams;
  readonly stats: SillStats;
  /** Current light position in viewport CSS px. */
  readonly light: { x: number; y: number };
  set(patch: Partial<SillParams>): void;
  preset(name: PresetName): void;
  /** Move the light to a viewport point; instant skips easing. */
  moveTo(x: number, y: number, instant?: boolean): void;
  subscribe(fn: (sill: Sill) => void): () => boolean;
  /** Register every [data-lit] under root. Safe to call again after DOM changes. */
  scan(): void;
  addStage(stage: StageLike): void;
  refresh(): void;
  kick(): void;
  destroy(): void;
}

export interface StageLike {
  el: HTMLElement;
  render(light: unknown, opts: { moving: boolean; steps: number }): void;
  resize?(w: number, h: number, dpr: number): void;
  themeChanged?(): void;
}
