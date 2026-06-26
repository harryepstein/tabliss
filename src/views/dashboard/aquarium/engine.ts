import { AquariumConfig, WidgetPosition } from "../../../db/state";

/**
 * The aquarium motion engine — a port of aquarium-brain's 3D swim loop.
 *
 * The tank is a CSS `perspective` box (see Aquarium.sass), so the z axis is
 * genuine depth: each widget is a "fish" with a real 3D position (x, y, z) and
 * velocity, steered by layered sines and bouncing off the six walls. Far
 * widgets recede with true perspective (smaller, dimmer) and near ones loom;
 * they sort by their actual z. Widgets bank — yaw/pitch/roll — toward their
 * travel direction. A slow tank-wide current nudges everything. Hover / focus /
 * tap "summons" a widget: it eases forward to face the viewer, brightens and
 * holds still to be read, while the rest dim back.
 *
 * The maths lives here as plain functions over mutable `Fish` records; the
 * renderer owns the requestAnimationFrame loop and the DOM writes.
 */

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
/** Near clip, just behind the glass; the far wall sits at -cfg.depth. */
const ZMAX = 90;
/** How far forward a summoned widget swims to present itself. */
const FOCUS_Z = 130;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

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
  /** Top-left position in tank pixels; z is depth (-depth .. ZMAX) */
  x: number;
  y: number;
  z: number;
  /** 3D velocity */
  vx: number;
  vy: number;
  vz: number;
  /** Current and per-fish target swim speed */
  speed: number;
  speedFactor: number;
  /** Measured size, kept current by a ResizeObserver */
  w: number;
  h: number;
  // Per-fish steering wander (frequencies + phases), so no two swim alike.
  sfx: number;
  sfy: number;
  sfz: number;
  spx: number;
  spy: number;
  spz: number;
  // Per-fish rotation wobble.
  wrx: number;
  wry: number;
  wrz: number;
  pwx: number;
  pwy: number;
  pwz: number;
  // Breathing (subtle scale pulse).
  bs: number;
  bf: number;
  bp: number;
  /** Summon blend, eased 0..1 */
  fb: number;
  /** Eased opacity */
  aop: number;
  // Interaction.
  hover: boolean;
  focused: boolean;
  /** Sticky summon, toggled by tapping on touch devices */
  pinned: boolean;
  /** Summon target, 0 or 1 */
  engageTarget: number;
  /** Last opacity written to the DOM, so unchanged values are not rewritten */
  lastOpacity: number;
};

export type SwimEnv = { curX: number; curZ: number; someone: boolean };

export function seedFish(id: string, position: WidgetPosition): Fish {
  const [ax, ay] = ANCHORS[position] ?? [0.5, 0.5];
  const ang = rand(0, TAU);
  const pitch = (Math.random() - 0.5) * 1.1;
  const speedFactor = 0.7 + Math.random() * 0.6;
  const speed = 40 * speedFactor;
  const ch = Math.cos(ang);
  const sh = Math.sin(ang);
  const cz = Math.cos(pitch);
  return {
    id,
    anchorX: ax,
    anchorY: ay,
    placed: false,
    x: 0,
    y: 0,
    z: 0,
    vx: ch * cz * speed,
    vy: Math.sin(pitch) * speed * 0.6,
    vz: sh * cz * speed,
    speed,
    speedFactor,
    w: 0,
    h: 0,
    sfx: TAU / (7 + Math.random() * 6),
    sfy: TAU / (8 + Math.random() * 6),
    sfz: TAU / (9 + Math.random() * 7),
    spx: rand(0, TAU),
    spy: rand(0, TAU),
    spz: rand(0, TAU),
    wrx: TAU / (5 + Math.random() * 4),
    wry: TAU / (6 + Math.random() * 4),
    wrz: TAU / (4 + Math.random() * 4),
    pwx: rand(0, TAU),
    pwy: rand(0, TAU),
    pwz: rand(0, TAU),
    bs: 0.013 + Math.random() * 0.013,
    bf: TAU / (8 + Math.random() * 6),
    bp: rand(0, TAU),
    fb: 0,
    aop: 1,
    hover: false,
    focused: false,
    pinned: false,
    engageTarget: 0,
    lastOpacity: -1,
  };
}

/** Per-frame shared state: the tank current and whether anything is summoned. */
export function makeEnv(fishes: Iterable<Fish>, t: number): SwimEnv {
  const amp = 7;
  const wc = TAU / 55;
  let someone = false;
  for (const f of fishes) {
    if (f.engageTarget > 0) {
      someone = true;
      break;
    }
  }
  return { curX: amp * Math.cos(t * wc), curZ: amp * Math.sin(t * wc), someone };
}

/**
 * Advance one fish by `dt` seconds (`t` is elapsed seconds) and write its 3D
 * transform + opacity straight to the element.
 */
export function swimFish(
  el: HTMLElement,
  f: Fish,
  cfg: AquariumConfig,
  W: number,
  H: number,
  dt: number,
  t: number,
  env: SwimEnv,
): void {
  const depth = cfg.depth || 640;
  const ZMIN = -depth;
  const steerK = (cfg.steer || 20) / 20;
  const spread = cfg.spread == null ? 0.12 : cfg.spread;

  if (!f.placed) {
    f.x = f.anchorX * W - f.w / 2;
    f.y = f.anchorY * H - f.h / 2;
    f.z = ZMIN + Math.random() * (ZMAX - ZMIN);
    f.placed = true;
  }

  // Ease swim speed toward this fish's share of the configured speed.
  f.speed += ((cfg.speed || 40) * f.speedFactor - f.speed) * 0.05;

  // Steer the heading with layered sines, then renormalise to a constant speed.
  f.vx += Math.sin(t * f.sfx + f.spx) * 22 * steerK * dt;
  f.vy += Math.cos(t * f.sfy + f.spy) * 15 * steerK * dt;
  f.vz += Math.sin(t * f.sfz + f.spz) * 20 * steerK * dt;
  const mag = Math.hypot(f.vx, f.vy, f.vz) || 1;
  f.vx = (f.vx / mag) * f.speed;
  f.vy = (f.vy / mag) * f.speed;
  f.vz = (f.vz / mag) * f.speed;

  // Freeze swimming the instant a widget is summoned, so it holds still to be
  // read instead of drifting out from under the pointer.
  const move = f.engageTarget ? 0 : 1;
  f.x += (f.vx + env.curX) * dt * move;
  f.y += f.vy * dt * move;
  f.z += (f.vz + env.curZ) * dt * move;

  // Bounce off the six tank walls (roam box extends `spread` past each edge).
  const ox = W * spread;
  const oy = H * spread;
  const minX = -ox;
  const maxX = W - f.w + ox;
  const minY = -oy;
  const maxY = H - f.h + oy;
  if (f.x < minX) {
    f.x = minX;
    f.vx = Math.abs(f.vx);
  } else if (f.x > maxX) {
    f.x = maxX;
    f.vx = -Math.abs(f.vx);
  }
  if (f.y < minY) {
    f.y = minY;
    f.vy = Math.abs(f.vy);
  } else if (f.y > maxY) {
    f.y = maxY;
    f.vy = -Math.abs(f.vy);
  }
  if (f.z < ZMIN) {
    f.z = ZMIN;
    f.vz = Math.abs(f.vz);
  } else if (f.z > ZMAX) {
    f.z = ZMAX;
    f.vz = -Math.abs(f.vz);
  }

  // Bank toward the travel direction, like a fish, plus a little idle wobble.
  const fry =
    clamp(Math.atan2(f.vx, Math.abs(f.vz) + 40) * DEG * 0.85, -44, 44) +
    3 * Math.sin(t * f.wry + f.pwy);
  const frx =
    clamp(-Math.atan2(f.vy, Math.abs(f.vz) + 40) * DEG * 0.85, -34, 34) +
    2.5 * Math.sin(t * f.wrx + f.pwx);
  const frz = clamp(-f.vx * 0.42, -18, 18) + 3 * Math.sin(t * f.wrz + f.pwz);
  const fsc = 1 + f.bs * Math.sin(t * f.bf + f.bp);
  const zN = (f.z - ZMIN) / (ZMAX - ZMIN);

  // Summon: ease forward to present, flatten to face the viewer, brighten.
  f.fb += (f.engageTarget - f.fb) * 0.1;
  const b = f.fb;
  const pz = f.z + (FOCUS_Z - f.z) * b;
  const RX = frx * (1 - b);
  const RY = fry * (1 - b);
  const RZ = frz * (1 - b);
  const SC = fsc + (1.16 - fsc) * b;
  const targetOp = f.engageTarget ? 1 : env.someone ? 0.5 : 0.3 + 0.7 * zN;
  f.aop += (targetOp - f.aop) * 0.08;

  el.style.transform =
    `translate3d(${f.x.toFixed(1)}px,${f.y.toFixed(1)}px,${pz.toFixed(1)}px) ` +
    `rotateX(${RX.toFixed(2)}deg) rotateY(${RY.toFixed(2)}deg) rotateZ(${RZ.toFixed(2)}deg) ` +
    `scale(${SC.toFixed(3)})`;

  const op = Math.round(f.aop * 100) / 100;
  if (op !== f.lastOpacity) {
    el.style.opacity = op.toFixed(2);
    f.lastOpacity = op;
  }
}
