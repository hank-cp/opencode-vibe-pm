/**
 * 命令注册测试
 *
 * 测试文件: tests/core/commands.test.ts
 * 关联 Spec: vibe-pm-plugin-core.md
 */

import {beforeEach, describe, expect, it, mock} from "bun:test";
import type {Config, IPluginContext, ToolContext} from "../../src/core/types.js";
import {registerCommands, registerTools} from "../../src/core/commands.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {MemorySystem} from "../../src/memory";

// Mock FlowEngine for tool tests
function createMockEngine() {
  const taskId = "task-mock-001";
  return {
    startTask: mock(() => Promise.resolve({
      id: taskId,
      sessionId: "test",
      flow: "research",
      currentStep: "S1",
      currentStepName: "就绪",
      summary: "测试任务",
      startAt: new Date().toISOString(),
    })),
    getCurrentStep: mock(() => Promise.resolve({
      id: taskId,
      sessionId: "test",
      flow: "research",
      currentStep: "S3",
      currentStepName: "测试步骤",
      summary: "测试任务",
      startAt: new Date().toISOString(),
    })),
    setStep: mock(() => Promise.resolve(undefined)),
    closeTask: mock(() => Promise.resolve({
      id: taskId,
      sessionId: "test",
      flow: "research",
      currentStep: "S3",
      currentStepName: "测试步骤",
      summary: "测试任务",
      startAt: new Date().toISOString(),
      closed: true,
    })),
  } as any;
}

async function createTempMemory() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-task-"));
  const memory = new MemorySystem();
  await memory.init(tmpDir);
  return memory;
}

async function seedTask(memory: MemorySystem, sessionId: string) {
  await memory.createTask({
    sessionId,
    flow: "research",
    currentStep: "S3",
    currentStepName: "测试步骤",
    startAt: new Date().toISOString(),
    summary: "测试任务",
  });
}

describe("registerCommands", () => {
  let config: Config;

  beforeEach(() => {
    config = {} as Config;
  });

  it("register_all_commands: 注册全部 7 个 /pm-* 命令", () => {
    registerCommands(config);

    const cmd = config.command as Record<string, { template: string; description?: string; agent?: string }> | undefined;
    expect(cmd).toBeDefined();
    const names = Object.keys(cmd!);
    expect(names).toHaveLength(7);
    expect(names).toContain("pm-install-flow");
    expect(names).toContain("pm-uninstall-flow");
    expect(names).toContain("pm-refine-flow");
    expect(names).toContain("pm-task-set-step");
    expect(names).toContain("pm-task-close");
    expect(names).toContain("pm-task-current-step");
    expect(names).toContain("pm-config");

    for (const name of names) {
      expect(cmd![name].description).toBeTruthy();
    }
  });

  it("command_no_duplicate_key: 重复注册后者覆盖前者", () => {
    (config as Record<string, unknown>).command = {
      "pm-install-flow": {
        template: "old template",
        description: "old desc",
        agent: "build",
      },
    };

    registerCommands(config);

    const cmd = config.command as Record<string, { template: string; description?: string; agent?: string }> | undefined;
    expect(cmd!["pm-install-flow"].template).toBe("");
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
    client: {} as any,
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

  it("register_executable_tools: 注册 6 个可执行工具", async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const tools = registerTools(mockCtx, engine, memory);

    const toolNames = Object.keys(tools);
    expect(toolNames).toHaveLength(6);
    expect(toolNames).toContain("pm_install_flow");
    expect(toolNames).toContain("pm_uninstall_flow");
    expect(toolNames).toContain("pm_config");
    expect(toolNames).toContain("pm_task_set_step");
    expect(toolNames).toContain("pm_task_close");
    expect(toolNames).toContain("pm_task_current_step");
  });

  it("pm_task_set_step_jumps: 跳转步骤返回 JSON", async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    await seedTask(memory, mockToolCtx.sessionID);
    const tools = registerTools(mockCtx, engine, memory);

    const result = await tools.pm_task_set_step.execute(
      { step: "S3" },
      mockToolCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.step).toBeTruthy();
    expect(parsed.sessionId).toBe("test");
    expect(parsed.taskId).toBeTruthy();
    expect(engine.setStep).toHaveBeenCalledWith("test", "S3");
  });

  it("pm_task_close_closes_task: 关闭任务返回 JSON", async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const tools = registerTools(mockCtx, engine, memory);

    const result = await tools.pm_task_close.execute({}, mockToolCtx);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.flow).toBe("research");
    expect(parsed.step).toBe("S3");
    expect(parsed.taskId).toBe("task-mock-001");
    expect(engine.closeTask).toHaveBeenCalledWith("test");
  });

  it("pm_task_close_no_active_task: 无活跃任务时返回 {ok:false}", async () => {
    const engine = createMockEngine();
    engine.closeTask = mock(() => Promise.resolve(null));
    const memory = await createTempMemory();
    const tools = registerTools(mockCtx, engine, memory);

    const result = await tools.pm_task_close.execute({}, mockToolCtx);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(false);
  });

  it("pm_task_current_step_returns_step: 有任务时返回步骤 JSON", async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    await seedTask(memory, mockToolCtx.sessionID);
    const tools = registerTools(mockCtx, engine, memory);

    const result = await tools.pm_task_current_step.execute({}, mockToolCtx);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.step).toBeTruthy();
    expect(parsed.stepName).toBeTruthy();
    expect(parsed.sessionId).toBe("test");
    expect(parsed.taskId).toBeTruthy();
  });

  it("pm_task_current_step_no_task: 无任务时返回 {ok:false}", async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const tools = registerTools(mockCtx, engine, memory);

    const result = await tools.pm_task_current_step.execute({}, mockToolCtx);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(false);
  });

  it("pm_task_current_step_no_session: 无 sessionID 时返回 JSON 错误", async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const tools = registerTools(mockCtx, engine, memory);
    const noSessionCtx: ToolContext = { ...mockToolCtx, sessionID: "" };

    const result = await tools.pm_task_current_step.execute({}, noSessionCtx);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Session ID");
  });
});
