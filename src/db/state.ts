import { DB, Storage } from "../lib";
import { defaultLocale } from "../locales";

/**
 * Database state
 */
export interface State {
  /** Background state */
  background: BackgroundState;
  /** Widget state */
  [key: `widget/${string}`]: WidgetState | null;
  /** Plugin data */
  [key: `data/${string}`]: unknown;
  /** Whether focus has been activated */
  focus: boolean;
  /** Aquarium (swimming widgets) configuration */
  aquarium: AquariumConfig;
  /** Locale selected */
  locale: string;
  /** Time zone selected, if any */
  timeZone: string | null;
}

/**
 * Aquarium mode — widgets drift around the dashboard like fish in a tank.
 * The motion parameters mirror a steering-behaviour simulation:
 * widgets swim at `speed`, turn with `steer` sharpness, bob through a depth
 * axis (`depth`, which drives the parallax of far vs. near widgets) and roam
 * `spread` past the frame edges before easing back into the tank.
 */
export interface AquariumConfig {
  /** When false, widgets fall back to the classic fixed nine-slot layout */
  enabled: boolean;
  /** Base swim speed in px/s */
  speed: number;
  /** Steering strength — how sharply widgets turn */
  steer: number;
  /** Tank depth in px — larger values deepen the parallax */
  depth: number;
  /** How far past the frame edges widgets roam (0..0.3) */
  spread: number;
}

export const defaultAquarium: AquariumConfig = {
  enabled: true,
  speed: 40,
  steer: 20,
  depth: 640,
  spread: 0.12,
};

export interface BackgroundState {
  id: string;
  key: string;
  display: BackgroundDisplay;
}

export interface BackgroundDisplay {
  blur?: number;
  luminosity?: number;
}

export interface WidgetState {
  id: string;
  key: string;
  order: number;
  display: WidgetDisplay;
}

export interface WidgetDisplay {
  colour?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  position: WidgetPosition;
}

export type WidgetPosition =
  | "topLeft"
  | "topCentre"
  | "topRight"
  | "middleLeft"
  | "middleCentre"
  | "middleRight"
  | "bottomLeft"
  | "bottomCentre"
  | "bottomRight";

// Init data for the store
const initData: State = {
  background: {
    id: "default-unsplash",
    key: "background/unsplash",
    display: {
      luminosity: -0.2,
      blur: 0,
    },
  },
  "widget/default-time": {
    id: "default-time",
    key: "widget/time",
    order: 0,
    display: {
      position: "middleCentre",
    },
  },
  "widget/default-greeting": {
    id: "default-greeting",
    key: "widget/greeting",
    order: 1,
    display: {
      position: "middleCentre",
    },
  },
  focus: false,
  aquarium: defaultAquarium,
  locale: defaultLocale,
  timeZone: null,
};

// Database storage
export const db = DB.init<State>(initData);

// Cache storage
export const cache = DB.init<Record<string, unknown | undefined>>();

// Persist data
export const dbStorage =
  BUILD_TARGET === "web"
    ? Storage.indexeddb(db, "tabliss/config")
    : Storage.extension(db, "tabliss/config", "sync");

export const cacheStorage =
  BUILD_TARGET === "firefox"
    ? Storage.extension(cache, "tabliss/cache", "local")
    : Storage.indexeddb(cache, "tabliss/cache");
