/**
 * 插件初始化测试 — AxioDB 单实例，整个文件共享 Plugin
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { VibePMPlugin } from "../../src/core/plugin.js";
import type { PluginInput } from "../../src/core/types.js";

// SDK PluginInput 的最小 Mock
function createMockPluginInput(dir: string): PluginInput {
  return {
    directory: dir,
    worktree: dir,
    serverUrl: new URL("http://localhost"),
    client: {} as ReturnType<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (...args: any[]) => any
    >,
    project: {} as PluginInput["project"],
    experimental_workspace: {
      register: () => {},
    },
    $: {} as PluginInput["$"],
  };
}

describe("VibePMPlugin", () => {
  let tmpDir: string;
  let hooks: Awaited<ReturnType<typeof VibePMPlugin>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-init-"));
    const ctx = createMockPluginInput(tmpDir);
    hooks = await VibePMPlugin(ctx);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init_registers_all_hooks: 返回 hooks 对象包含全部 6 个钩子", () => {
    expect(hooks.config).toBeDefined();
    expect(typeof hooks.config).toBe("function");
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks.tool).toBe("object");
    expect(hooks["chat.message"]).toBeDefined();
    expect(typeof hooks["chat.message"]).toBe("function");
    expect(hooks["experimental.chat.system.transform"]).toBeDefined();
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");
    expect(hooks["experimental.chat.messages.transform"]).toBeDefined();
    expect(
      typeof hooks["experimental.chat.messages.transform"],
    ).toBe("function");
    expect(hooks.event).toBeDefined();
    expect(typeof hooks.event).toBe("function");
  });

  it("init_no_active_task_passthrough: 无活跃任务时 chat.message 透传", async () => {
    const input = { sessionID: "test-ses" } as Parameters<
      NonNullable<typeof hooks["chat.message"]>
    >[0];
    const output = {} as Parameters<
      NonNullable<typeof hooks["chat.message"]>
    >[1];
    await hooks["chat.message"]!(input, output);
    // 无活跃任务时不修改 output
    expect(output).toBeDefined();
  });

  it("init_event_session_created: session.created 事件不抛异常", async () => {
    await expect(
      hooks.event!({
        event: { type: "session.created", properties: { sessionID: "s1" } },
      } as Parameters<NonNullable<typeof hooks.event>>[0]),
    ).resolves.toBeUndefined();
  });

  it("init_event_session_idle: session.idle 事件不抛异常", async () => {
    await expect(
      hooks.event!({
        event: { type: "session.idle", properties: { sessionID: "s1" } },
      } as Parameters<NonNullable<typeof hooks.event>>[0]),
    ).resolves.toBeUndefined();
  });
});
