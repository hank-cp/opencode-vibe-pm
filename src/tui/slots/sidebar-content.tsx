import type { JSX } from 'solid-js';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import type { TaskStatusData, TokenData } from '../types.js';
import { SOURCE_COLORS, compactTokens, formatElapsed } from '../types.js';
import { Collapsible } from '../components/collapsible.jsx';
import { EmptyState } from '../components/empty-state.jsx';
import { RGBA } from '@opentui/core';

const SIDEBAR_WIDTH = 38;

interface SidebarContentProps {
  api: TuiPluginApi;
  taskStatus: () => TaskStatusData;
  tokenData: () => TokenData;
}

export function SidebarContent(props: SidebarContentProps): JSX.Element {
  const theme = () => props.api.theme.current;

  return (
    <box width="100%" flexDirection="column" paddingRight={1}>
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
            return '';
          })();

          const startTime = (() => {
            if (!data.startAt) return '';
            try {
              const date = new Date(data.startAt);
              if (isNaN(date.getTime())) return '';
              const hh = String(date.getHours()).padStart(2, '0');
              const mm = String(date.getMinutes()).padStart(2, '0');
              return `${hh}:${mm}`;
            } catch {
              return '';
            }
          })();

          if (data.type === 'active') {
            return (
              <box width="100%" flexDirection="column">
                <text fg={t.text}>Flow: {data.flow}</text>
                <text fg={t.warning}>
                  Step: {data.currentStep} — {data.currentStepName}
                </text>
                <text fg={t.textMuted}>
                  Started: {startTime} Elapsed: {elapsed}
                </text>
              </box>
            );
          }

          if (data.type === 'last') {
            return (
              <box width="100%" flexDirection="column">
                <text fg={t.text}>Flow: {data.flow}</text>
                <text fg={t.success}>Step: Completed</text>
                <text fg={t.textMuted}>
                  Started: {startTime} Elapsed: {elapsed}
                </text>
              </box>
            );
          }

          return <EmptyState mutedColor={t.textMuted} />;
        })()}
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        <text>Tokens</text>
        {(() => {
          const td = props.tokenData();
          if (td.totalTokens <= 0 || td.sourceBreakdown.length === 0)
            return (
              <box width="100%" flexDirection="row" height={1}>
                <text fg={RGBA.fromInts(89, 89, 89)}>{'█'.repeat(SIDEBAR_WIDTH - 2)} 0</text>
              </box>
            );
          const total = td.totalTokens;
          const segs = td.sourceBreakdown.map((s) => ({
            source: s.source,
            tokens: s.tokens,
            pct: Math.max(1, Math.round((s.tokens / total) * 100)),
            color:
              SOURCE_COLORS[s.source as keyof typeof SOURCE_COLORS] ?? RGBA.fromInts(128, 128, 128),
          }));
          const totalText = compactTokens(total);
          const barTotal = Math.max(1, SIDEBAR_WIDTH - totalText.length - 2);
          const counts = segs.map((s) => Math.max(1, Math.floor((s.tokens / total) * barTotal)));
          let sum = counts.reduce((a, b) => a + b, 0);
          const remainders = segs
            .map((s, i) => ({ r: (s.tokens / total) * barTotal - counts[i], i }))
            .sort((a, b) => b.r - a.r);
          for (let j = 0; sum < barTotal && j < remainders.length; j++) {
            counts[remainders[j].i]++;
            sum++;
          }
          return (
            <box width="100%" flexDirection="row" height={1}>
              {segs.map((s, i) => (
                <text fg={s.color}>{'█'.repeat(counts[i])}</text>
              ))}
              <text>{totalText}</text>
            </box>
          );
        })()}
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        <Collapsible title="Token Details" defaultCollapsed={true} titleColor={theme().text}>
          {(() => {
            const td = props.tokenData();
            if (td.sourceBreakdown.length === 0) return <text fg={theme().textMuted}>No data</text>;
            return (
              <box width="100%" flexDirection="column">
                {td.sourceBreakdown.map((entry) => {
                  const left = entry.source;
                  const pct =
                    td.totalTokens > 0 ? Math.round((entry.tokens / td.totalTokens) * 100) : 0;
                  const right = `${compactTokens(entry.tokens)} (${pct}%)`;
                  const color =
                    SOURCE_COLORS[entry.source as keyof typeof SOURCE_COLORS] ??
                    RGBA.fromInts(128, 128, 128);
                  return (
                    <box width="100%" height={1} flexDirection="row" justifyContent="space-between">
                      <text fg={color}>{left}</text>
                      <text fg={theme().textMuted}>{right}</text>
                    </box>
                  );
                })}
                {/* Cache */}
                {td.cachedTokens > 0 &&
                  (() => {
                    const cachePct = Math.round(
                      (td.cachedTokens / (td.cachedTokens + td.uncachedTokens)) * 100
                    );
                    const right = `${compactTokens(td.cachedTokens)} (${cachePct}%)`;
                    return (
                      <box
                        width="100%"
                        height={1}
                        flexDirection="row"
                        justifyContent="space-between"
                      >
                        <text fg={RGBA.fromInts(200, 200, 200)}>Cache</text>
                        <text fg={theme().textMuted}>{right}</text>
                      </box>
                    );
                  })()}
              </box>
            );
          })()}
        </Collapsible>
      </box>

      <box width="100%" flexDirection="column">
        <Collapsible title="Step Tokens" defaultCollapsed={true} titleColor={theme().text}>
          {(() => {
            const td = props.tokenData();
            if (td.stepBreakdown.length === 0) return <text fg={theme().textMuted}>No data</text>;
            const steps = [...td.stepBreakdown].sort(
              (a, b) =>
                (parseInt(a.step.replace('S', ''), 10) || 0) -
                (parseInt(b.step.replace('S', ''), 10) || 0)
            );
            const stepTokensTotal = steps.reduce((sum, s) => sum + s.tokensConsumed, 0);
            return (
              <box width="100%" flexDirection="column">
                {steps.map((step) => {
                  const pct =
                    stepTokensTotal > 0
                      ? Math.round((step.tokensConsumed / stepTokensTotal) * 100)
                      : 0;
                  const left = `${step.step} ${step.stepName}`;
                  const right = `${compactTokens(step.tokensConsumed)} - ${pct}% - x${step.stepInCount}`;
                  return (
                    <box width="100%" height={1} flexDirection="row" justifyContent="space-between">
                      <text fg={theme().text}>{left}</text>
                      <text fg={theme().textMuted}>{right}</text>
                    </box>
                  );
                })}
              </box>
            );
          })()}
        </Collapsible>
      </box>
    </box>
  );
}
