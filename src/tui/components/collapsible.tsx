import type { RGBA } from "@opentui/core";
import { createSignal, type JSX } from "solid-js";

export interface CollapsibleProps {
  title: string;
  defaultCollapsed?: boolean;
  titleColor?: RGBA;
  children: JSX.Element;
}

export function Collapsible(props: CollapsibleProps): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(
    props.defaultCollapsed ?? true,
  );

  const arrow = () => (collapsed() ? "▶" : "▼");

  return (
    <box width="100%" flexDirection="column">
      <box
        width="100%"
        flexDirection="row"
        height={1}
        onMouseDown={() => setCollapsed((prev) => !prev)}
      >
        <text fg={props.titleColor}>
          {arrow()} {props.title}
        </text>
      </box>
      {!collapsed() && (
        <box width="100%" flexDirection="column" marginLeft={2}>
          {props.children}
        </box>
      )}
    </box>
  );
}
