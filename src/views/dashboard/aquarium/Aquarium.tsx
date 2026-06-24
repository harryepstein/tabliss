import React from "react";
import { AquariumConfig, db, WidgetState } from "../../../db/state";
import { getConfig } from "../../../plugins";
import Plugin from "../../shared/Plugin";
import Widget from "../Widget";
import "./Aquarium.sass";
import {
  applyFish,
  applyStill,
  Fish,
  prefersReducedMotion,
  seedFish,
  step,
} from "./engine";

type Props = {
  widgets: WidgetState[];
  config: AquariumConfig;
};

/**
 * Renders every widget as a free-swimming "fish". The same
 * `<Widget><Plugin/></Widget>` tree used by the classic slot layout is wrapped
 * in an absolutely positioned node whose transform is driven each frame by the
 * motion engine. React is kept out of the per-frame path: the animation loop
 * mutates element styles directly through refs, so widgets only re-render when
 * their own data changes.
 */
const Aquarium: React.FC<Props> = ({ widgets, config }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fishes = React.useRef(new Map<string, Fish>());
  const elements = React.useRef(new Map<string, HTMLDivElement>());
  const observer = React.useRef<ResizeObserver | null>(null);
  const refCallbacks = React.useRef(
    new Map<string, (el: HTMLDivElement | null) => void>(),
  );
  const relayoutStill = React.useRef<(() => void) | null>(null);

  // Live config for the animation loop, without restarting it.
  const configRef = React.useRef(config);
  configRef.current = config;

  const reduced = React.useMemo(prefersReducedMotion, []);

  const ids = widgets.map((w) => w.id).join(",");

  // Keep the fish set in sync with the widget set.
  React.useEffect(() => {
    const present = new Set<string>();
    for (const widget of widgets) {
      present.add(widget.id);
      if (!fishes.current.has(widget.id)) {
        fishes.current.set(
          widget.id,
          seedFish(widget.id, widget.display.position),
        );
      }
    }
    for (const id of [...fishes.current.keys()]) {
      if (!present.has(id)) {
        fishes.current.delete(id);
        refCallbacks.current.delete(id);
      }
    }
    // Re-place static fish if the set changed under reduced motion.
    relayoutStill.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // A single ResizeObserver tracks every fish's measured size.
  React.useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const id = el.dataset.fishId;
        const fish = id && fishes.current.get(id);
        if (fish) {
          fish.w = el.offsetWidth;
          fish.h = el.offsetHeight;
        }
      }
    });
    observer.current = ro;
    elements.current.forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, []);

  // Stable ref callback per widget id, so React does not detach/observe on
  // every render.
  const getRef = (id: string) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) {
          el.dataset.fishId = id;
          elements.current.set(id, el);
          const fish = fishes.current.get(id);
          if (fish) {
            fish.w = el.offsetWidth;
            fish.h = el.offsetHeight;
          }
          observer.current?.observe(el);
        } else {
          const prev = elements.current.get(id);
          if (prev) observer.current?.unobserve(prev);
          elements.current.delete(id);
        }
      };
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };

  const setHover = (id: string, value: boolean) => {
    const fish = fishes.current.get(id);
    if (fish) {
      fish.hover = value;
      fish.engageTarget = fish.hover || fish.focused ? 1 : 0;
    }
  };
  const setFocused = (id: string, value: boolean) => {
    const fish = fishes.current.get(id);
    if (fish) {
      fish.focused = value;
      fish.engageTarget = fish.hover || fish.focused ? 1 : 0;
    }
  };

  // The simulation: a rAF loop while animated, or a static layout pass when the
  // user prefers reduced motion.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (reduced) {
      const layout = () => {
        const W = container.clientWidth;
        const H = container.clientHeight;
        fishes.current.forEach((fish) => {
          const el = elements.current.get(fish.id);
          if (el) applyStill(el, fish, configRef.current, W, H);
        });
      };
      relayoutStill.current = layout;
      layout();
      const ro = new ResizeObserver(layout);
      ro.observe(container);
      return () => {
        ro.disconnect();
        relayoutStill.current = null;
      };
    }

    let raf = 0;
    let last = performance.now();
    const start = last;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      const cfg = configRef.current;
      const W = container.clientWidth;
      const H = container.clientHeight;
      fishes.current.forEach((fish) => {
        const el = elements.current.get(fish.id);
        if (!el) return;
        step(fish, cfg, W, H, dt, t);
        applyFish(el, fish, cfg, t);
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Re-place static fish when the config changes under reduced motion.
  React.useEffect(() => {
    if (reduced) relayoutStill.current?.();
  }, [reduced, config]);

  return (
    <div ref={containerRef} className={`Aquarium${reduced ? " is-still" : ""}`}>
      {widgets.map(({ display, id, key }) => (
        <div
          key={id}
          ref={getRef(id)}
          className="Fish"
          onPointerEnter={() => setHover(id, true)}
          onPointerLeave={() => setHover(id, false)}
          onPointerDown={() => setHover(id, true)}
          onFocusCapture={() => setFocused(id, true)}
          onBlurCapture={() => setFocused(id, false)}
        >
          <Widget {...display}>
            <Plugin id={id} component={getConfig(key).dashboardComponent} />
          </Widget>
        </div>
      ))}
    </div>
  );
};

export default Aquarium;
