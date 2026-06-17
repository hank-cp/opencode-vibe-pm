import type { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { StepTokenEntry, TokenData } from "../types.js";
import { compactTokens } from "../types.js";
import { Collapsible } from "./collapsible.jsx";

const BAR_MAX_WIDTH = 30;

export interface StepTokensProps {
  tokenData: () => TokenData;
  theme: {
    text: RGBA;
    textMuted: RGBA;
    success: RGBA;
  };
  defaultCollapsed?: boolean;
}

export function StepTokens(props: StepTokensProps): JSX.Element {
  const data = () => props.tokenData();
  const theme = () => props.theme;
  const defaultCollapsed = () => props.defaultCollapsed;

  const steps = createMemo<StepTokenEntry[]>(() => {
    const d = data();
    return [...d.stepBreakdown].sort((a, b) =>
      a.step.localeCompare(b.step),
    );
  });

  const maxTokens = createMemo(() =>
    Math.max(...steps().map((s) => s.tokensConsumed), 1),
  );

  const body = createMemo(() => {
    const d = data();
    if (d.stepBreakdown.length === 0) {
      return <text fg={theme().textMuted}>暂无数据</text>;
    }

    const max = maxTokens();

    return (
      <box width="100%" flexDirection="column">
        {steps().map((step: StepTokenEntry) => {
          const barWidth = Math.max(
            1,
            Math.round((step.tokensConsumed / max) * BAR_MAX_WIDTH),
          );

          return (
            <box width="100%" flexDirection="row" height={1}>
              <text fg={theme().text}>
                {step.step} {step.stepName}
              </text>
              <text fg={theme().success}>{"█".repeat(barWidth)}</text>
              <text fg={theme().textMuted}>
                {" "}
                {compactTokens(step.tokensConsumed)} ({step.stepInCount}次)
              </text>
            </box>
          );
        })}
      </box>
    );
  });

  return (
    <Collapsible
      title="步骤 Token"
      defaultCollapsed={defaultCollapsed()}
      titleColor={theme().text}
    >
      {body()}
    </Collapsible>
  );
}
