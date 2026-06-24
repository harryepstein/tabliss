import { AquariumConfig, WidgetPosition } from "../../../db/state";

/**
 * The aquarium motion engine.
 *
 * Each widget becomes a "fish" with a position, heading and depth. Every frame
 * it steers toward a smoothly wandering target heading (a sum of out-of-phase
 * sines, so the path meanders organically rather than oscillating), eases away
 * from the tank walls, and swims forward at a constant speed scaled by its
 * depth so distant widgets drift slower (parallax). Hovering or focusing a
 * widget "summons" it: motion eases to a stop and it rises to the front so it
 * can be read or interacted with — the tabliss analogue of aquarium-brain's
 * `summon` command.
 *
 * The maths lives here as plain functions operating on mutable `Fish` records;
 * the renderer owns the requestAnimationFrame loop and the DOM writes.
 */

const TAU = Math.PI * 2;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where each starting position seeds a fish, as a fraction of the tank. */
const ANCHORS: Record<WidgetPosition, [number, number]> = {
  topLeft: [0.22, 0.24],
  topCentre: [0.5, 0.18],
  topRight: [0.78, 0.24],
  middleLeft: [0.2, 0.5],
  middleCentre: [0.5, 0.5],
  middleRight: [0.8, 0.5],
  bottomLeft: [0.22, 0.78],
  bottomCentre: [0.5, 0.82],
  bottomRight: [0.78, 0.78],
};

export type Fish = {
  id: string;
  /** Seed location, as a fraction of the tank (from the widget's position) */
  anchorX: number;
  anchorY: number;
  /** Set true once placed into pixel space on the first frame */
  placed: boolean;
  /** Centre position, in tank pixels */
  x: number;
  y: number;
  /** Depth, 0 (far) .. 1 (near/front) */
  z: number;
  /** Travel direction, radians */
  heading: number;
  /** Measured size, kept current by a ResizeObserver */
  w: number;
  h: number;
  /** Time (s) the fish was first placed, for the intro fade-in */
  born: number;
  // Per-fish wander seeds, so no two widgets swim alike.
  s1: number;
  s2: number;
  s3: number;
  f1: number;
  f2: number;
  zPhase: number;
  zFreq: number;
  /** Static depth used by the reduced-motion layout */
  zSeed: number;
  // Interaction state.
  hover: boolean;
  focused: boolean;
  /** Current summon amount, 0..1 (eased) */
  engage: number;
  /** Summon target, 0 or 1 */
  engageTarget: number;
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function seedFish(id: string, position: WidgetPosition): Fish {
  const [ax, ay] = ANCHORS[position] ?? [0.5, 0.5];
  return {
    id,
    anchorX: ax,
    anchorY: ay,
    placed: false,
    x: 0,
    y: 0,
    z: rand(0.4, 0.8),
    heading: rand(0, TAU),
    w: 0,
    h: 0,
    born: 0,
    s1: rand(0, TAU),
    s2: rand(0, TAU),
    s3: rand(0, TAU),
    f1: rand(0.08, 0.18),
    f2: rand(0.13, 0.27),
    zPhase: rand(0, TAU),
    zFreq: rand(0.05, 0.12),
    zSeed: Math.random(),
    hover: false,
    focused: false,
    engage: 0,
    engageTarget: 0,
  };
}

/** Smallest signed rotation from `a` to `b`, in (-PI, PI]. */
function shortAngle(a: number, b: number): number {
  return ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Advance one fish by `dt` seconds. `t` is elapsed seconds since the loop began. */
export function step(
  f: Fish,
  cfg: AquariumConfig,
  W: number,
  H: number,
  dt: number,
  t: number,
): void {
  if (!f.placed) {
    f.x = f.anchorX * W;
    f.y = f.anchorY * H;
    f.born = t;
    f.placed = true;
  }

  // Ease the summon amount toward its target (hover / focus).
  f.engage += (f.engageTarget - f.engage) * (1 - Math.exp(-dt * 9));

  // Depth gently bobs; a summoned fish rises fully to the front.
  const baseZ = 0.5 + 0.5 * Math.sin(t * f.zFreq + f.zPhase);
  f.z = lerp(baseZ, 1, f.engage);

  // A smoothly wandering target heading.
  const wander =
    TAU *
    (Math.sin(t * f.f1 + f.s1) +
      0.5 * Math.sin(t * f.f2 + f.s2) +
      0.25 * Math.sin(t * f.f1 * 0.5 + f.s3));

  // Soft tank walls: the roam box extends `spread` past each edge. As a fish
  // nears a wall, bias its heading back toward open water.
  const halfW = f.w / 2;
  const halfH = f.h / 2;
  const marginX = cfg.spread * W;
  const marginY = cfg.spread * H;
  const loX = halfW - marginX;
  const hiX = W - halfW + marginX;
  const loY = halfH - marginY;
  const hiY = H - halfH + marginY;
  const padX = Math.max(48, W * 0.14);
  const padY = Math.max(48, H * 0.14);

  let pushX = 0;
  let pushY = 0;
  if (f.x < loX + padX) pushX = (loX + padX - f.x) / padX;
  else if (f.x > hiX - padX) pushX = -(f.x - (hiX - padX)) / padX;
  if (f.y < loY + padY) pushY = (loY + padY - f.y) / padY;
  else if (f.y > hiY - padY) pushY = -(f.y - (hiY - padY)) / padY;

  let target = wander;
  const pushMag = Math.hypot(pushX, pushY);
  if (pushMag > 0.001) {
    const inward = Math.atan2(pushY, pushX);
    target = wander + shortAngle(wander, inward) * clamp(pushMag, 0, 1);
  }

  // Rotate toward the target, capped by the steering strength.
  const maxTurn = (0.35 + cfg.steer * 0.05) * dt;
  f.heading += clamp(shortAngle(f.heading, target), -maxTurn, maxTurn);
  f.heading %= TAU;

  // Swim forward: constant speed, slowed by depth (parallax) and stilled while
  // summoned so the widget holds steady to be read.
  const swim = cfg.speed * lerp(0.45, 1, f.z) * (1 - f.engage);
  f.x += Math.cos(f.heading) * swim * dt;
  f.y += Math.sin(f.heading) * swim * dt;

  // Hard stop at the roam box, as a safety net for resizes.
  f.x = clamp(f.x, Math.min(loX, hiX), Math.max(loX, hiX));
  f.y = clamp(f.y, Math.min(loY, hiY), Math.max(loY, hiY));
}

/** Derive visuals from a fish's depth/summon state and write them to the DOM. */
export function applyFish(
  el: HTMLElement,
  f: Fish,
  cfg: AquariumConfig,
  t: number,
): void {
  const par = clamp(cfg.depth / 1280, 0, 0.85);
  const intro = clamp((t - f.born) * 1.6, 0, 1);

  const depthScale = lerp(1 - par * 0.55, 1.04, f.z);
  const scale = depthScale * (1 + 0.1 * f.engage) * lerp(0.9, 1, intro);
  const opacity = lerp(1 - par * 0.5, 1, f.z) * intro;
  const blur = (1 - f.z) * par * 2 * (1 - f.engage);
  const zIndex = 1 + Math.round(f.z * 200) + Math.round(f.engage * 500);

  const tx = f.x - f.w / 2;
  const ty = f.y - f.h / 2;
  el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
  el.style.opacity = opacity.toFixed(3);
  el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
  el.style.zIndex = String(zIndex);
}

/**
 * Reduced-motion layout: place each fish statically at its anchor with a fixed
 * depth. Positioning uses left/top so the stylesheet's `:hover` scale (and its
 * transition) can take over — no animation loop runs.
 */
export function applyStill(
  el: HTMLElement,
  f: Fish,
  cfg: AquariumConfig,
  W: number,
  H: number,
): void {
  const par = clamp(cfg.depth / 1280, 0, 0.85);
  const z = 0.55 + 0.4 * f.zSeed;
  const scale = lerp(1 - par * 0.55, 1.04, z);
  const opacity = lerp(1 - par * 0.5, 1, z);
  el.style.left = `${(f.anchorX * W).toFixed(1)}px`;
  el.style.top = `${(f.anchorY * H).toFixed(1)}px`;
  el.style.setProperty("--fish-scale", scale.toFixed(3));
  el.style.opacity = opacity.toFixed(3);
  el.style.zIndex = String(1 + Math.round(z * 200));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
