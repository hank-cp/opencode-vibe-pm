/**
 * 插件初始化测试
 *
 * 测试文件: tests/core/plugin.test.ts
 * 关联 Spec: vibe-pm-plugin-core.md
 * Setup: 创建临时项目目录，Mock OpenCode PluginContext
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { VibePMPlugin } from "../../src/core/plugin.js";
import type { OpenCodePluginContext } from "../../src/core/types.js";

describe("VibePMPlugin", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-init-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMockCtx(dir: string): OpenCodePluginContext {
    return { directory: dir };
  }

  it("init_creates_data_dir: 首次初始化时创建 .vibe-pm/ 和 data.json", async () => {
    const ctx = createMockCtx(tmpDir);

    const hooks = await VibePMPlugin(ctx);

    const dataDir = path.join(tmpDir, ".vibe-pm");
    expect(fs.existsSync(dataDir)).toBe(true);

    const dataFile = path.join(dataDir, "data.json");
    expect(fs.existsSync(dataFile)).toBe(true);
    expect(hooks).toBeDefined();
  });

  it("init_registers_all_hooks: 返回 hooks 对象包含全部 6 个钩子", async () => {
    const ctx = createMockCtx(tmpDir);
    const hooks = await VibePMPlugin(ctx);

    expect(hooks.config).toBeDefined();
    expect(typeof hooks.config).toBe("function");

    expect(hooks.tool).toBeDefined();
    expect(typeof hooks.tool).toBe("object");

    expect(hooks["chat.message"]).toBeDefined();
    expect(typeof hooks["chat.message"]).toBe("function");

    expect(hooks["experimental.chat.system.transform"]).toBeDefined();
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");

    expect(hooks["experimental.chat.messages.transform"]).toBeDefined();
    expect(typeof hooks["experimental.chat.messages.transform"]).toBe("function");

    expect(hooks.event).toBeDefined();
    expect(typeof hooks.event).toBe("function");
  });

  it("init_no_active_task_passthrough: 无活跃任务时 chat.message 透传", async () => {
    const ctx = createMockCtx(tmpDir);
    const hooks = await VibePMPlugin(ctx);

    const input = { messages: [{ role: "user", content: "hello" }] };
    const output = {};

    hooks["chat.message"]!(input, output as any);

    // 无活跃任务时，output 不应被修改
    expect(output).toEqual({});
  });

  it("init_event_session_created: session.created 事件不抛异常", async () => {
    const ctx = createMockCtx(tmpDir);
    const hooks = await VibePMPlugin(ctx);

    expect(() => {
      hooks.event!({ event: { type: "session.created", properties: { sessionID: "ses_001" } } });
    }).not.toThrow();
  });

  it("init_event_session_idle: session.idle 事件不抛异常", async () => {
    const ctx = createMockCtx(tmpDir);
    const hooks = await VibePMPlugin(ctx);

    expect(() => {
      hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_001" } } });
    }).not.toThrow();
  });
});
