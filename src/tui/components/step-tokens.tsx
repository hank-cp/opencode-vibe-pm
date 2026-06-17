import type { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { StepTokenEntry, TokenData } from "../types.js";
import { compactTokens } from "../types.js";
import { Collapsible } from "./collapsible.js";

export interface StepTokensProps {
  data: TokenData;
  theme: {
    text: RGBA;
    textMuted: RGBA;
    success: RGBA;
  };
  defaultCollapsed?: boolean;
}

export function StepTokens(props: StepTokensProps): JSX.Element {
  const { data, theme, defaultCollapsed } = props;

  const steps = createMemo<StepTokenEntry[]>(() => {
    return [...data.stepBreakdown].sort((a, b) =>
      a.step.localeCompare(b.step),
    );
  });

  const body = createMemo(() => {
    if (data.stepBreakdown.length === 0) {
      return <text fg={theme.textMuted}>暂无数据</text>;
    }

    return (
      <box width="100%" flexDirection="column">
        {steps().map((step: StepTokenEntry) => (
          <box width="100%" flexDirection="row">
            <text fg={theme.text}>
              {step.step} — {step.stepName}
            </text>
            <box
              flexGrow={Math.max(1, step.tokensConsumed)}
              flexBasis={0}
              height={1}
              backgroundColor={theme.success}
            />
            <text fg={theme.textMuted}>
              {compactTokens(step.tokensConsumed)} ({step.stepInCount}次进入)
            </text>
          </box>
        ))}
      </box>
    );
  });

  return (
    <Collapsible
      title="步骤 Token"
      defaultCollapsed={defaultCollapsed}
      titleColor={theme.text}
    >
      {body()}
    </Collapsible>
  );
}
