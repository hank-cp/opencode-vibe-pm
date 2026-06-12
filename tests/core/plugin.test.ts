/**
 * 插件初始化测试 — AxioDB 单实例，整个文件共享 Plugin
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { VibePMPlugin } from "../../src/core/plugin.js";
import type { OpenCodePluginContext } from "../../src/core/types.js";

describe("VibePMPlugin", () => {
  let tmpDir: string;
  let hooks: Awaited<ReturnType<typeof VibePMPlugin>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-init-"));
    const ctx: OpenCodePluginContext = { directory: tmpDir };
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

  it("init_no_active_task_passthrough: 无活跃任务时 chat.message 透传", () => {
    const input = { messages: [{ role: "user", content: "hello" }] };
    const output = {};
    hooks["chat.message"]!(input, output as any);
    expect(output).toEqual({});
  });

  it("init_event_session_created: session.created 事件不抛异常", () => {
    expect(() => {
      hooks.event!({
        event: { type: "session.created", properties: { sessionID: "s1" } },
      });
    }).not.toThrow();
  });

  it("init_event_session_idle: session.idle 事件不抛异常", () => {
    expect(() => {
      hooks.event!({
        event: { type: "session.idle", properties: { sessionID: "s1" } },
      });
    }).not.toThrow();
  });
});
