import type { RGBA } from "@opentui/core";
import type { JSX } from "solid-js";

export interface EmptyStateProps {
  message?: string;
  mutedColor: RGBA;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <box width="100%" flexDirection="row" justifyContent="center">
      <text fg={props.mutedColor}>
        {props.message ?? "No active vibe-pm tasks"}
      </text>
    </box>
  );
}
