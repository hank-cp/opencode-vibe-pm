import type { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { TaskStatusData } from "../types.js";
import { formatElapsed } from "../types.js";
import { EmptyState } from "./empty-state.jsx";

export interface TaskStatusCardProps {
  taskStatus: () => TaskStatusData;
  theme: {
    text: RGBA;
    textMuted: RGBA;
    success: RGBA;
  };
}

export function TaskStatusCard(props: TaskStatusCardProps): JSX.Element {
  const data = createMemo(() => props.taskStatus());
  const theme = () => props.theme;

  const elapsed = createMemo(() => {
    const d = data();
    if (d.elapsed) return d.elapsed;
    if (d.startAt) return formatElapsed(d.startAt, d.endAt);
    return "";
  });

  const startTime = createMemo(() => {
    const d = data();
    if (!d.startAt) return "";
    try {
      const date = new Date(d.startAt);
      if (isNaN(date.getTime())) return "";
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "";
    }
  });

  return (
    <box width="100%" flexDirection="column">
      {data().type === "active" && (
        <box width="100%" flexDirection="column">
          <text fg={theme().text}>
            流程: {data().flow}
          </text>
          <text fg={theme().text}>
            步骤: {data().currentStep} — {data().currentStepName}
          </text>
          <text fg={theme().textMuted}>
            开始: {startTime()}  耗时: {elapsed()}
          </text>
          {data().specRef && (
            <text fg={theme().textMuted}>Spec: {data().specRef}</text>
          )}
          {data().planRef && (
            <text fg={theme().textMuted}>Plan: {data().planRef}</text>
          )}
        </box>
      )}
      {data().type === "last" && (
        <box width="100%" flexDirection="column">
          <text fg={theme().textMuted}>
            上一任务: {data().flow}，耗时 {elapsed()}
          </text>
          {data().endAt && (
            <text fg={theme().textMuted}>结束: {data().endAt}</text>
          )}
        </box>
      )}
      {data().type !== "active" && data().type !== "last" && (
        <EmptyState mutedColor={theme().textMuted} />
      )}
    </box>
  );
}
