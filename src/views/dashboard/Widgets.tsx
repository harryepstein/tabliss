import React from "react";
import { selectWidgets } from "../../db/select";
import { db, WidgetPosition, WidgetState } from "../../db/state";
import { useSelector, useValue } from "../../lib/db/react";
import Aquarium from "./aquarium/Aquarium";
import Slot from "./Slot";
import "./Widgets.sass";

const Widgets: React.FC = () => {
  const focus = useValue(db, "focus");
  const aquarium = useValue(db, "aquarium");
  const widgets = useSelector(db, selectWidgets);

  // Focus mode hides every widget.
  if (focus) return <div className="Widgets fullscreen" />;

  // Aquarium mode: widgets swim freely instead of sitting in fixed slots.
  if (aquarium.enabled)
    return (
      <div className="Widgets fullscreen">
        <Aquarium widgets={widgets} config={aquarium} />
      </div>
    );

  // Classic layout: group widgets into the nine fixed positions.
  // TODO: one day we'll have `Array.groupBy` accepted by tc39
  const grouped = widgets.reduce<
    Partial<Record<WidgetPosition, WidgetState[]>>
  >(
    (carry, widget) => ({
      ...carry,
      [widget.display.position]: [
        ...(carry[widget.display.position] ?? []),
        widget,
      ],
    }),
    {},
  );

  const slots = Object.entries(grouped) as [WidgetPosition, WidgetState[]][];

  return (
    <div className="Widgets fullscreen">
      <div className="container">
        {slots.map(([position, widgets]) => (
          <Slot key={position} position={position} widgets={widgets} />
        ))}
      </div>
    </div>
  );
};

export default Widgets;
