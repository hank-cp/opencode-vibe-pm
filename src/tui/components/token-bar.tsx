import { RGBA } from "@opentui/core";
import { createMemo, type JSX } from "solid-js";
import type { ColorSegment, TokenData } from "../types.js";
import { SOURCE_COLORS, compactTokens } from "../types.js";

const BAR_EMPTY_COLOR = RGBA.fromInts(89, 89, 89);
const BAR_TOTAL_WIDTH = 38;

const SOURCE_ABBREV: Record<string, string> = {
  System: "Sy",
  FlowControl: "Fl",
  User: "Us",
  Assistant: "As",
  Tool: "To",
  Reasoning: "Re",
};

export interface TokenBarProps {
  tokenData: () => TokenData;
}

function distributeBar(segs: ColorSegment[], total: number, width: number) {
  const counts = segs.map((seg) =>
    Math.max(1, Math.floor((seg.tokens / total) * width)),
  );
  let sum = counts.reduce((a, b) => a + b, 0);
  const remainders = segs.map(
    (seg, i) => (seg.tokens / total) * width - counts[i],
  );
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r);
  for (let j = 0; sum < width && j < order.length; j++) {
    counts[order[j].i]++;
    sum++;
  }
  return segs.map((seg, i) => ({
    source: seg.source,
    chars: counts[i],
    color: seg.color,
  }));
}

export function TokenBar(props: TokenBarProps): JSX.Element {
  const data = () => props.tokenData();

  const segments = createMemo<ColorSegment[]>(() => {
    const d = data();
    const total = d.totalTokens;
    if (total <= 0) return [];
    return d.sourceBreakdown
      .filter((s) => s.tokens > 0)
      .map((s) => ({
        source: s.source,
        tokens: s.tokens,
        percentage: Math.round((s.tokens / total) * 100),
        color: SOURCE_COLORS[s.source],
      }));
  });

  const barChars = createMemo(() => {
    const segs = segments();
    const d = data();
    if (segs.length === 0) return [];
    return distributeBar(segs, d.totalTokens, BAR_TOTAL_WIDTH);
  });

  const totalStr = createMemo(() => compactTokens(data().totalTokens));

  if (data().totalTokens <= 0) {
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
    <box width="100%" flexDirection="column">
      <box width="100%" flexDirection="row" height={1}>
        {barChars().map((seg) => (
          <text fg={seg.color}>{"█".repeat(seg.chars)}</text>
        ))}
        <text>{totalStr()}</text>
      </box>
      <box width="100%" flexDirection="row">
        <text>LEG:</text>
        {(() => {
          const d = data();
          if (d.totalTokens <= 0) return <text>no-data</text>;
          return d.sourceBreakdown.filter((s) => s.tokens > 0).map((s, i) => (
            <text fg={SOURCE_COLORS[s.source]}>
              {i > 0 ? " " : ""}{SOURCE_ABBREV[s.source] ?? s.source.slice(0, 2)}{Math.round((s.tokens / d.totalTokens) * 100)}%
            </text>
          ));
        })()}
      </box>
    </box>
  );
}
