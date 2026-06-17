import { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { ColorSegment, TokenData } from "../types.js";
import { SOURCE_COLORS, compactTokens } from "../types.js";

const BAR_EMPTY_COLOR = RGBA.fromInts(89, 89, 89);

export interface TokenBarProps {
  data: TokenData;
}

export function TokenBar(props: TokenBarProps): JSX.Element {
  const { data } = props;

  const segments = createMemo<ColorSegment[]>(() => {
    const total = data.totalTokens;
    if (total <= 0) return [];
    return data.sourceBreakdown
      .filter((s) => s.tokens > 0)
      .map((s) => ({
        source: s.source,
        tokens: s.tokens,
        percentage: Math.round((s.tokens / total) * 100),
        color: SOURCE_COLORS[s.source],
      }));
  });

  const totalStr = createMemo(() => compactTokens(data.totalTokens));

  if (data.totalTokens <= 0) {
    return (
      <box width="100%" flexDirection="row" height={1}>
        <box
          backgroundColor={BAR_EMPTY_COLOR}
          flexGrow={1}
          flexBasis={0}
          height={1}
        />
        <text fg={BAR_EMPTY_COLOR}>{totalStr()}</text>
      </box>
    );
  }

  return (
    <box width="100%" flexDirection="row" height={1}>
      {segments().map((seg: ColorSegment) => (
        <box
          backgroundColor={seg.color}
          flexGrow={Math.max(1, seg.tokens)}
          flexBasis={0}
          height={1}
        />
      ))}
      <text>{totalStr()}</text>
    </box>
  );
}
