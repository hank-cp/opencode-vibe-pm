/**
 * 命令注册测试
 *
 * 测试文件: tests/core/commands.test.ts
 * 关联 Spec: vibe-pm-plugin-core.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Config, IPluginContext, ToolContext } from "../../src/core/types.js";
import { registerCommands, registerTools } from "../../src/core/commands.js";

// Mock FlowEngine for tool tests
function createMockEngine() {
  return {
    startTask: vi.fn().mockResolvedValue({
      sessionId: "test",
      flow: "research",
      currentStep: "S1",
      currentStepName: "就绪",
      summary: "测试任务",
      startAt: new Date().toISOString(),
    }),
    setStep: vi.fn().mockResolvedValue(undefined),
    closeTask: vi.fn().mockResolvedValue({
      sessionId: "test",
      flow: "research",
      currentStep: "S3",
      currentStepName: "测试步骤",
      summary: "测试任务",
      startAt: new Date().toISOString(),
      closed: true,
    }),
  } as any;
}

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
    const engine = createMockEngine();
    const tools = registerTools(mockCtx, engine);

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

  it("pm_task_start_creates_task: 任务创建返回成功消息", async () => {
    const engine = createMockEngine();
    const tools = registerTools(mockCtx, engine);

    const result = await tools.pm_task_start.execute(
      { flow: "research", summary: "测试摘要" },
      mockToolCtx,
    );
    expect(result).toContain("[vibe-pm] ✅ 任务已手动创建");
    expect(result).toContain("research");
    expect(result).toContain("测试任务");
    expect(engine.startTask).toHaveBeenCalledWith({
      sessionId: "test",
      flow: "research",
      summary: "测试摘要",
    });
  });

  it("pm_task_start_no_session: toolCtx 无 sessionID 时返回错误", async () => {
    const engine = createMockEngine();
    const tools = registerTools(mockCtx, engine);
    const noSessionCtx: ToolContext = { ...mockToolCtx, sessionID: "" };

    const result = await tools.pm_task_start.execute(
      { flow: "research", summary: "测试" },
      noSessionCtx,
    );
    expect(result).toContain("错误");
    expect(result).toContain("Session ID");
  });

  it("pm_task_refresh_returns_info: 刷新返回文件引用模式提示", async () => {
    const tools = registerTools(mockCtx, createMockEngine());
    const result = await tools.pm_task_refresh.execute({}, mockToolCtx);
    expect(result).toContain("文件引用模式");
    expect(result).toContain("docs/flow/");
  });

  it("pm_task_close_closes_task: 关闭任务返回摘要", async () => {
    const engine = createMockEngine();
    const tools = registerTools(mockCtx, engine);

    const result = await tools.pm_task_close.execute({}, mockToolCtx);
    expect(result).toContain("[vibe-pm] ✅ 任务已关闭");
    expect(result).toContain("research");
    expect(engine.closeTask).toHaveBeenCalledWith("test");
  });

  it("pm_task_close_no_active_task: 无活跃任务时返回提示", async () => {
    const engine = createMockEngine();
    engine.closeTask = vi.fn().mockResolvedValue(null);
    const tools = registerTools(mockCtx, engine);

    const result = await tools.pm_task_close.execute({}, mockToolCtx);
    expect(result).toContain("无需关闭");
  });
});
