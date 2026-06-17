import { createEffect, createSignal, on, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type {
  TuiPluginApi,
  TuiSlotPlugin,
} from "@opencode-ai/plugin/tui";
import type { IMemorySystem } from "../../memory/types.js";
import type { TaskStatusData, TokenData } from "../types.js";
import { loadTaskStatus } from "../data/task-status.js";
import { loadTokenData } from "../data/token-data.js";
import { TaskStatusCard } from "../components/task-status.js";
import { TokenBar } from "../components/token-bar.js";
import { TokenDetail } from "../components/token-detail.js";
import { StepTokens } from "../components/step-tokens.js";

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
        <TaskStatusCard data={taskStatus()} theme={theme()} />
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        <TokenBar data={tokenData()} />
      </box>

      <box width="100%" flexDirection="column" marginBottom={1}>
        <TokenDetail
          data={tokenData()}
          theme={theme()}
          defaultCollapsed={true}
        />
      </box>

      <box width="100%" flexDirection="column">
        <StepTokens
          data={tokenData()}
          theme={theme()}
          defaultCollapsed={true}
        />
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
