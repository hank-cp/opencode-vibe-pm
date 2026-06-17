import type { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { TokenData, TokenSourceEntry } from "../types.js";
import { SOURCE_COLORS, compactTokens } from "../types.js";
import { Collapsible } from "./collapsible.jsx";

const SOURCE_KEYS = Object.keys(SOURCE_COLORS) as Array<
  keyof typeof SOURCE_COLORS
>;

export interface TokenDetailProps {
  tokenData: () => TokenData;
  theme: {
    text: RGBA;
    textMuted: RGBA;
  };
  defaultCollapsed?: boolean;
}

export function TokenDetail(props: TokenDetailProps): JSX.Element {
  const data = () => props.tokenData();
  const theme = () => props.theme;
  const defaultCollapsed = () => props.defaultCollapsed;

  const sourceMap = createMemo(() => {
    const d = data();
    const map = new Map<string, TokenSourceEntry>();
    for (const entry of d.sourceBreakdown) {
      map.set(entry.source, entry);
    }
    return map;
  });

  const body = createMemo(() => {
    const d = data();
    if (d.sourceBreakdown.length === 0) {
      return <text fg={theme().textMuted}>暂无数据</text>;
    }

    return (
      <box width="100%" flexDirection="column">
        {SOURCE_KEYS.map((source) => {
          const entry = sourceMap().get(source);
          const tokens = entry?.tokens ?? 0;
          const percentage =
            d.totalTokens > 0
              ? Math.round((tokens / d.totalTokens) * 100)
              : 0;

          return (
            <box
              width="100%"
              flexDirection="row"
              justifyContent="space-between"
            >
              <text fg={SOURCE_COLORS[source]}>{source}</text>
              <text fg={theme().textMuted}>
                {compactTokens(tokens)} ({percentage}%)
              </text>
            </box>
          );
        })}
      </box>
    );
  });

  return (
    <Collapsible
      title="Token 分布详情"
      defaultCollapsed={defaultCollapsed()}
      titleColor={theme().text}
    >
      {body()}
    </Collapsible>
  );
}
