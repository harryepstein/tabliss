import React from "react";
import { setAquarium } from "../../db/action";
import { AquariumConfig, db } from "../../db/state";
import { useValue } from "../../lib/db/react";

type Slider = {
  key: keyof Omit<AquariumConfig, "enabled">;
  label: string;
  min: number;
  max: number;
  step: number;
};

const sliders: Slider[] = [
  { key: "speed", label: "Swim speed", min: 0, max: 120, step: 2 },
  { key: "steer", label: "Turning", min: 0, max: 60, step: 1 },
  { key: "depth", label: "Depth (parallax)", min: 0, max: 1280, step: 20 },
  { key: "spread", label: "Roam past edges", min: 0, max: 0.3, step: 0.01 },
];

const Aquarium: React.FC = () => {
  const config = useValue(db, "aquarium");

  return (
    <div>
      <h2>Aquarium</h2>

      <label>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => setAquarium({ enabled: event.target.checked })}
        />{" "}
        Let widgets swim around like fish in a tank
      </label>

      {config.enabled && (
        <>
          {sliders.map((slider) => (
            <label key={slider.key}>
              {slider.label} <br />
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={config[slider.key]}
                onChange={(event) =>
                  setAquarium({
                    [slider.key]: Number(event.target.value),
                  } as Record<Slider["key"], number>)
                }
              />
            </label>
          ))}

          <p className="text--grey">
            Widgets drift gently across the dashboard. Hover (or tab to) a widget
            to bring it forward and hold it still while you read or use it.
          </p>
        </>
      )}
    </div>
  );
};

export default Aquarium;
