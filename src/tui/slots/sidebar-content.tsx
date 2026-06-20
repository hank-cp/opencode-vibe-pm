import type { JSX } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { TaskStatusData, TokenData } from "../types.js";
import { SOURCE_COLORS, compactTokens, visualWidth, formatElapsed } from "../types.js";
import { Collapsible } from "../components/collapsible.jsx";
import { EmptyState } from "../components/empty-state.jsx";
import { RGBA } from "@opentui/core";

const SIDEBAR_WIDTH = 38;

interface SidebarContentProps {
  api: TuiPluginApi;
  taskStatus: () => TaskStatusData;
  tokenData: () => TokenData;
}

export function SidebarContent(props: SidebarContentProps): JSX.Element {
  const theme = () => props.api.theme.current;

  return (
    <box width="100%" flexDirection="column">
      <box width="100%" flexDirection="row" marginBottom={1}>
        <text fg={theme().primary}>vibe-pm</text>
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        {(() => {
          const data = props.taskStatus();
          const t = theme();

          const elapsed = (() => {
            if (data.elapsed) return data.elapsed;
            if (data.startAt) return formatElapsed(data.startAt, data.endAt);
            return "";
          })();

          const startTime = (() => {
            if (!data.startAt) return "";
            try {
              const date = new Date(data.startAt);
              if (isNaN(date.getTime())) return "";
              const hh = String(date.getHours()).padStart(2, "0");
              const mm = String(date.getMinutes()).padStart(2, "0");
              return `${hh}:${mm}`;
            } catch {
              return "";
            }
          })();

          if (data.type === "active") {
            return (
              <box width="100%" flexDirection="column">
                <text fg={t.text}>流程: {data.flow}</text>
                <text fg={t.text}>
                  步骤: {data.currentStep} — {data.currentStepName}
                </text>
                <text fg={t.textMuted}>
                  开始: {startTime}  耗时: {elapsed}
                </text>
                {data.specRef && (
                  <text fg={t.textMuted}>Spec: {data.specRef}</text>
                )}
                {data.planRef && (
                  <text fg={t.textMuted}>Plan: {data.planRef}</text>
                )}
              </box>
            );
          }

          if (data.type === "last") {
            return (
              <box width="100%" flexDirection="column">
                <text fg={t.textMuted}>
                  上一任务: {data.flow}，耗时 {elapsed}
                </text>
                {data.endAt && (
                  <text fg={t.textMuted}>结束: {data.endAt}</text>
                )}
              </box>
            );
          }

          return <EmptyState mutedColor={t.textMuted} />;
        })()}
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        {(() => {
          const td = props.tokenData();
          if (td.totalTokens <= 0) return (<box width="100%" flexDirection="row" height={1}>
            <text fg={RGBA.fromInts(89,89,89)}>{"█".repeat(SIDEBAR_WIDTH)}</text>
            <text fg={RGBA.fromInts(89,89,89)}>{compactTokens(td.totalTokens)}</text>
          </box>);
          const total = td.totalTokens;
          const srcOrder = Object.keys(SOURCE_COLORS) as Array<keyof typeof SOURCE_COLORS>;
          const map = new Map(td.sourceBreakdown.map(s => [s.source, s.tokens]));
          const segs = srcOrder.filter(k => (map.get(k) ?? 0) > 0).map(k => ({
            source: k, tokens: map.get(k)!,
            pct: Math.max(1, Math.round((map.get(k)! / total) * 100)),
            color: SOURCE_COLORS[k]
          }));
          const barTotal = SIDEBAR_WIDTH;
          const counts = segs.map(s => Math.max(1, Math.floor((s.tokens / total) * barTotal)));
          let sum = counts.reduce((a,b)=>a+b,0);
          const remainders = segs.map((s,i)=>({r:(s.tokens/total)*barTotal - counts[i], i})).sort((a,b)=>b.r-a.r);
          for (let j=0; sum<barTotal && j<remainders.length; j++) { counts[remainders[j].i]++; sum++; }
          return (
            <box width="100%" flexDirection="row" height={1}>
              {segs.map((s,i) => (<text fg={s.color}>{"█".repeat(counts[i])}</text>))}
              <text>{compactTokens(total)}</text>
            </box>
          );
        })()}
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        <Collapsible title="Token 分布详情" defaultCollapsed={true} titleColor={theme().text}>
          {(() => {
            const td = props.tokenData();
            if (td.sourceBreakdown.length === 0) return (<text fg={theme().textMuted}>暂无数据</text>);
            return (<box width="100%" flexDirection="column">
              {Object.keys(SOURCE_COLORS).map(source => {
                const entry = td.sourceBreakdown.find(e => e.source === source);
                const tokens = entry?.tokens ?? 0;
                const pct = td.totalTokens > 0 ? Math.round(tokens/td.totalTokens*100) : 0;
                return (<box width="100%" flexDirection="row">
                  <text fg={SOURCE_COLORS[source as keyof typeof SOURCE_COLORS]}>{source.slice(0,2)}</text>
                  <text fg={theme().textMuted}> {compactTokens(tokens)} ({pct}%)</text>
                </box>);
              })}
            </box>);
          })()}
        </Collapsible>
      </box>

      <box width="100%" flexDirection="column">
        <Collapsible title="步骤 Token" defaultCollapsed={true} titleColor={theme().text}>
          {(() => {
            const td = props.tokenData();
            if (td.stepBreakdown.length === 0) return (<text fg={theme().textMuted}>暂无数据</text>);
            const steps = [...td.stepBreakdown].sort((a,b) => a.step.localeCompare(b.step));
            const maxTk = Math.max(...steps.map(s => s.tokensConsumed), 1);
            return (<box width="100%" flexDirection="column">
              {steps.map(step => {
                const barW = Math.max(1, Math.round(step.tokensConsumed/maxTk*20));
                const left = `${step.step} ${"█".repeat(barW)} ${step.stepName}`;
                const right = `${compactTokens(step.tokensConsumed)} (${step.stepInCount}次)`;
                const pad = Math.max(1, SIDEBAR_WIDTH - visualWidth(left) - visualWidth(right));
                return (
                  <box width="100%" flexDirection="row">
                    <text fg={theme().text}>{left}</text>
                    <text fg={theme().textMuted}>{" ".repeat(pad)}{right}</text>
                  </box>
                );
              })}
            </box>);
          })()}
        </Collapsible>
      </box>
    </box>
  );
}
