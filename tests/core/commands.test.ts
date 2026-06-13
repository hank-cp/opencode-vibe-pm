/**
 * 命令注册测试
 *
 * 测试文件: tests/core/commands.test.ts
 * 关联 Spec: vibe-pm-plugin-core.md
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Config, IPluginContext, ToolContext } from "../../src/core/types.js";
import { registerCommands, registerTools } from "../../src/core/commands.js";

describe("registerCommands", () => {
  let config: Config;

  beforeEach(() => {
    config = {} as Config;
  });

  it("register_all_commands: 注册全部 8 个 /pm-* 命令", () => {
    registerCommands(config);

    const cmd = config.command as Record<string, { template: string; description?: string; agent?: string }> | undefined;
    expect(cmd).toBeDefined();
    const names = Object.keys(cmd!);
    expect(names).toHaveLength(8);
    expect(names).toContain("pm-install-flow");
    expect(names).toContain("pm-uninstall-flow");
    expect(names).toContain("pm-refine-flow");
    expect(names).toContain("pm-task-start");
    expect(names).toContain("pm-task-set-step");
    expect(names).toContain("pm-task-refresh");
    expect(names).toContain("pm-task-close");
    expect(names).toContain("pm-config");

    // 验证每个命令有 template 和 description
    for (const name of names) {
      expect(cmd![name].template).toBeTruthy();
      expect(cmd![name].description).toBeTruthy();
      expect(cmd![name].agent).toBe("build");
    }
  });

  it("command_no_duplicate_key: 重复注册后者覆盖前者", () => {
    (config as Record<string, unknown>).command = {
      "pm-task-start": {
        template: "old template",
        description: "old desc",
        agent: "build",
      },
    };

    registerCommands(config);

    const cmd = config.command as Record<string, { template: string; description?: string; agent?: string }> | undefined;
    // 后者覆盖，不抛异常
    expect(cmd!["pm-task-start"].template).not.toBe("old template");
    expect(Object.keys(cmd!)).toHaveLength(8);
  });
});

describe("registerTools", () => {
  const mockCtx: IPluginContext = {
    config: {
      language: "zh-CN",
      dataDir: ".vibe-pm",
      autoAnalyze: true,
      contextInjection: { maxStepTokens: 0, pruneIrrelevant: true },
    },
    projectDir: "/test",
    dataDir: "/test/.vibe-pm",
  };

  const mockToolCtx: ToolContext = {
    sessionID: "test",
    messageID: "msg1",
    agent: "build",
    directory: "/test",
    worktree: "/test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  };

  it("register_executable_tools: 注册 5 个可执行工具", () => {
    const tools = registerTools(mockCtx);

    const toolNames = Object.keys(tools);
    expect(toolNames).toHaveLength(5);
    expect(toolNames).toContain("pm_install_flow");
    expect(toolNames).toContain("pm_task_start");
    expect(toolNames).toContain("pm_task_set_step");
    expect(toolNames).toContain("pm_task_refresh");
    expect(toolNames).toContain("pm_task_close");

    // 声明式命令不在 tool 注册中
    expect(toolNames).not.toContain("pm_uninstall_flow");
    expect(toolNames).not.toContain("pm_refine_flow");
    expect(toolNames).not.toContain("pm_config");
  });

  it("stub_tool_returns_message: stub 工具返回占位消息", async () => {
    const tools = registerTools(mockCtx);

    const result = await tools.pm_task_start.execute({}, mockToolCtx);
    expect(result).toContain("[vibe-pm]");
    expect(result).toContain("/pm-task-start");
    expect(result).toContain("stub");
  });
});
