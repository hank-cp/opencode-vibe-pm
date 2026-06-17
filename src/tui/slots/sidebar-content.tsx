import { createEffect, createSignal, on, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type {
  TuiPluginApi,
  TuiSlotPlugin,
} from "@opencode-ai/plugin/tui";
import type { IMemorySystem } from "../../memory/types.js";
import type { TaskStatusData, TokenData } from "../types.js";
import { SOURCE_COLORS, compactTokens } from "../types.js";
import { loadTaskStatus } from "../data/task-status.js";
import { loadTokenData } from "../data/token-data.js";
import { TaskStatusCard } from "../components/task-status.jsx";
import { Collapsible } from "../components/collapsible.jsx";
import { RGBA } from "@opentui/core";

const REFRESH_DEBOUNCE_MS = 150;
const POLL_INTERVAL_MS = 5000;
const SLOT_ORDER = 150;

interface SidebarContentProps {
  api: TuiPluginApi;
  sessionID: () => string;
  memory: IMemorySystem;
}

function SidebarContent(props: SidebarContentProps): JSX.Element {
  const [taskStatus, setTaskStatus] = createSignal<TaskStatusData>({
    type: "empty",
  });
  const [tokenData, setTokenData] = createSignal<TokenData>({
    totalTokens: 0,
    sourceBreakdown: [],
    stepBreakdown: [],
  });
  const [error, setError] = createSignal<string | null>(null);

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  async function refresh(): Promise<void> {
    try {
      const sid = props.sessionID();
      if (!sid) return;
      const [ts, td] = await Promise.all([
        loadTaskStatus(props.memory, sid),
        loadTokenData(props.memory, sid),
      ]);
      setTaskStatus(ts);
      setTokenData(td);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  function scheduleRefresh(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  }

  createEffect(
    on(
      props.sessionID,
      (sessionID: string) => {
        if (!sessionID) return;

        void refresh();

        const unsubs = [
          props.api.event.on("message.updated", (event) => {
            if (
              (event.properties.info as { sessionID?: string }).sessionID !==
              sessionID
            )
              return;
            scheduleRefresh();
          }),
          props.api.event.on("session.updated", (event) => {
            if (
              (event.properties.info as { id?: string }).id !== sessionID
            )
              return;
            scheduleRefresh();
          }),
        ];

        refreshTimer = setInterval(refresh, POLL_INTERVAL_MS);

        onCleanup(() => {
          for (const unsub of unsubs) unsub();
          if (refreshTimer) clearInterval(refreshTimer);
          if (debounceTimer) clearTimeout(debounceTimer);
        });
      },
      { defer: false },
    ),
  );

  const theme = () => props.api.theme.current;

  if (error()) {
    return (
      <box width="100%" flexDirection="column">
        <text fg={theme().error}>数据层不可用</text>
        <text fg={theme().textMuted}>{error()}</text>
      </box>
    );
  }

  return (
    <box width="100%" flexDirection="column">
      <box width="100%" flexDirection="row" marginBottom={1}>
        <text fg={theme().primary}>vibe-pm</text>
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        <TaskStatusCard taskStatus={taskStatus} theme={theme()} />
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        {(() => {
          const td = tokenData();
          if (td.totalTokens <= 0) return (<box width="100%" flexDirection="row" height={1}>
            <box backgroundColor={RGBA.fromInts(89,89,89)} flexGrow={1} flexBasis={0} height={1}/>
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
          const barTotal = 38;
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
            const td = tokenData();
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
            const td = tokenData();
            if (td.stepBreakdown.length === 0) return (<text fg={theme().textMuted}>暂无数据</text>);
            const steps = [...td.stepBreakdown].sort((a,b) => a.step.localeCompare(b.step));
            const maxTk = Math.max(...steps.map(s => s.tokensConsumed), 1);
            return (<box width="100%" flexDirection="column">
              {steps.map(step => {
                const barW = Math.max(1, Math.round(step.tokensConsumed/maxTk*20));
                return (<box width="100%" flexDirection="row" justifyContent="space-between">
                  <box flexDirection="row">
                    <text fg={theme().text}>{step.step}</text>
                    <text fg={theme().success}> {"█".repeat(barW)} </text>
                    <text fg={theme().textMuted}>{step.stepName}</text>
                  </box>
                  <text fg={theme().textMuted}>{compactTokens(step.tokensConsumed)} ({step.stepInCount}次)</text>
                </box>);
              })}
            </box>);
          })()}
        </Collapsible>
      </box>
    </box>
  );
}

export function createSidebarSlot(
  api: TuiPluginApi,
  memory: IMemorySystem,
): TuiSlotPlugin {
  return {
    order: SLOT_ORDER,
    slots: {
      sidebar_content: (ctx, value) => (
        <SidebarContent
          api={api}
          sessionID={() => (value as { session_id: string }).session_id}
          memory={memory}
        />
      ),
    },
  };
}
