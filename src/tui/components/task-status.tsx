import type { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { TaskStatusData } from "../types.js";
import { formatElapsed } from "../types.js";
import { EmptyState } from "./empty-state.js";

export interface TaskStatusCardProps {
  data: TaskStatusData;
  theme: {
    text: RGBA;
    textMuted: RGBA;
    success: RGBA;
  };
}

export function TaskStatusCard(props: TaskStatusCardProps): JSX.Element {
  const { data, theme } = props;

  const elapsed = createMemo(() => {
    if (data.elapsed) return data.elapsed;
    if (data.startAt) return formatElapsed(data.startAt, data.endAt);
    return "";
  });

  const startTime = createMemo(() => {
    if (!data.startAt) return "";
    try {
      const d = new Date(data.startAt);
      if (isNaN(d.getTime())) return "";
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "";
    }
  });

  if (data.type === "active") {
    return (
      <box width="100%" flexDirection="column">
        <text fg={theme.text}>
          流程: {data.flow}
        </text>
        <text fg={theme.text}>
          步骤: {data.currentStep} — {data.currentStepName}
        </text>
        <text fg={theme.textMuted}>
          开始: {startTime()}  耗时: {elapsed()}
        </text>
        {data.specRef && (
          <text fg={theme.textMuted}>Spec: {data.specRef}</text>
        )}
        {data.planRef && (
          <text fg={theme.textMuted}>Plan: {data.planRef}</text>
        )}
      </box>
    );
  }

  if (data.type === "last") {
    return (
      <box width="100%" flexDirection="column">
        <text fg={theme.textMuted}>
          上一任务: {data.flow}，耗时 {elapsed()}
        </text>
        {data.endAt && (
          <text fg={theme.textMuted}>结束: {data.endAt}</text>
        )}
      </box>
    );
  }

  return <EmptyState mutedColor={theme.textMuted} />;
}
