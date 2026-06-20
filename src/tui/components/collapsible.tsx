import type { RGBA } from "@opentui/core";
import { createSignal, Show, type JSX } from "solid-js";

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

  return (
    <box width="100%" flexDirection="column">
      <box
        width="100%"
        flexDirection="row"
        height={1}
        onMouseUp={() => setCollapsed((prev) => !prev)}
      >
        <text fg={props.titleColor}>
          {collapsed() ? "▶" : "▼"} {props.title}
        </text>
      </box>
      <Show when={!collapsed()}>
        <box width="100%" flexDirection="column" marginLeft={2}>
          {props.children}
        </box>
      </Show>
    </box>
  );
}
