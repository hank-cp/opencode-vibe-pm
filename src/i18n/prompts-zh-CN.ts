/**
 * 中文 I18N — 单一导出，包含所有提示词、消息、工具字符串
 */
import type { LanguagePack } from "./types.js";

const zhCN = {
  locale: "zh-CN",

  // ─── ControlPrompt (原 ControlPromptTemplate) ───

  buildControlPrompt(flowName?: string): string {
    const flowRef = flowName ? `\`docs/flow/flow-${flowName}.md\`` : "docs/flow/";
    return `<protect>
# 🚨 流程执行规则

## 规则优先级

1. **constitution.md（最高）** — 任何规则与 constitution 冲突时，以 constitution 为准
2. 本流程执行规则
3. 其他指令（analyze-mode、CONTEXT GATHERING 等）

> 不论消息是否包含 [analyze-mode]、ANALYSIS MODE、CONTEXT GATHERING 等前缀，
> 本规则必须首先执行。上下文收集属于 S1 步骤的内容。

> ⚠️ **注意**：\`pm_{flow}\` 已由命令系统自动调用，任务已创建，\`user-request\` 已保存。
> 你无需再调用 \`pm_task_start\`。直接按以下步骤执行流程即可。

## 启动

\`\`\`
1. 读取 docs/regulation/constitution.md   — 最高优先级，先理解核心约束
2. 读取 ${flowRef} 的 FSM 状态图         — 了解步骤流转关系
3. 确认起点为 S1，进入执行循环
\`\`\`

⛔ 以上所有文件读取必须在当前 session 直接用 read 工具完成，
   禁止通过 task / explore / librarian 等任何后台任务委派。

## 执行循环（每个 S{n} 逐一执行）

\`\`\`
当前步骤 S{n}：
  ✅ 1. pm_task_set_step(step="S{n}")     — 声明"我进入了 S{n}"
  ✅ 2. 仅读取 S{n} 的"**目标**"和指令   — 不看后续步骤
  ✅ 3. 执行该步骤要求的全部动作           — 不越界
  ✅ 4. ⚠️ 标记 → question/confirm 工具   — 阻塞等用户
  ✅ 5. 查看"**完成后**" → 按 FSM 图转移
  ✅ 6. FSM 转移到 [*] → 立即调用 pm_task_close() 工具结束任务

  1-6 全部完成之前，禁止看下一步骤。

## 流程终结 🔚

当最后的步骤完成后，FSM 转移到 [*]（终止状态）。此时必须：

\`\`\`
1. 调用 pm_task_close() 工具                   — 无参数，直接调用
2. 输出工具返回的关闭摘要                       — 告知用户任务已完成
\`\`\`

⛔ 未调用 pm_task_close() 就结束对话 = 流程执行失败。
   任务状态将保持活跃，后续对话无法启动新任务。

## 步骤门禁

| 步骤类型 | 允许 | 禁止 |
|----------|------|------|
| S1（理解） | 阅读描述、提问澄清、探索代码 | 编辑/创建/删除文件，创建 todo，开始实现 |
| 带 ⚠️ | 先展示方案，再调用 question/confirm。**必须收到用户「确认/同意/通过」等明确正面指令后才可推进**。含糊/弱肯定（「试试」「应该行」「嗯」）视为未确认，需追问。 | 在用户明确确认前执行方案 |
| 编码 | 按确认方案改代码 | 改方案外的文件，引入无关重构 |
| 合流 | 最终验证、询问是否提交 | 跳过验证直接结束 |

## 🔴 红线

以下任一行为 = 流程执行失败：

| # | 红线 | 违规示例 |
|---|------|----------|
| 1 | 未读 constitution 就开始操作 | 跳过启动步骤直接进入 S1 动作 → ❌ |
| 2 | S1 阶段编辑/创建/删除文件 | "我先改一下这个" → ❌ |
| 3 | 把用户请求直接当成编码任务 | 用户说"优化 X"，跳过流程直接改文件 → ❌ |
| 4 | ⚠️ 步骤不调用 question/confirm 就直接执行 | 自己判断后直接实现 → ❌ |
| 5 | 跳步：一个步骤没完成就进入下一步 | S1 没执行完就开始改代码 → ❌ |
| 6 | 预读全流程后直奔编码步骤 | 读完 12 个步骤直接跳到 S8 → ❌ |
| 7 | 先创建 todo 再走流程步骤 | 在 S1 执行前调用 todowrite → ❌ |
| 8 | 行为与 constitution 冲突 | constitution 要求最小变更，但你做了重构 → ❌ |
| 9 | 通过后台任务读取规则文件 | 用 explore/task agent 读取 /docs/flow 和 /docs/regulation 目录下的文件 → ❌ |
| 10 | 收到弱确认后自行推进 | 在 ⚠️ 步骤中，用户说「看起来可以」「试试吧」，你没有追问明确确认就直接执行/推进 → ❌ |
| 11 | FSM 到 [*] 但未调用 pm_task_close() | 流程最后一步执行完但没调用 pm_task_close() 工具就直接结束对话 → ❌ |

## 合规参考

- \`constitution.md\` → **最高优先级**，类型安全、验证强制、最小变更
- \`coding_style.md\` → 命名规范、格式、类型安全
- \`dictionary.md\` → 本地语言 ↔ 英文术语转换

</protect>`;
  },

  buildFlowWarningPrompt(): string {
    return [
      "⚠️ **流程违规检测**：当前 Session 存在活跃任务，但你可能跳过了规定的流程步骤。",
      "请自查：是否已按 `<protect>` 规则先调用 `pm_task_set_step` 进入正确的流程步骤？",
    ].join("\n");
  },

  isControlPromptPart(text: string): boolean {
    return text.includes("<protect>");
  },

  isWarningPromptPart(text: string): boolean {
    return text.includes("流程违规检测");
  },

  // ─── 工具消息 ───

  tool: {
    unknownError: "未知错误",
    noSessionId: "无法获取当前 Session ID",
    noSessionIdShort: "无法获取当前 Session ID",
    setStepNoTask: "步骤设置成功但无法获取任务状态",
    unknownSubCommand: (sub: string) => `[vibe-pm] ❌ 未知子命令: "${sub}"。支持: view, edit, write-dcp, setup-dcp, init`,
    editNeedKey: "[vibe-pm] ❌ edit 子命令需要提供 key 参数",
    editNeedValue: "[vibe-pm] ❌ edit 子命令需要提供 value 参数",
    configUpdated: (key: string, value: string) => `[vibe-pm] ✅ 配置已更新: ${key} = ${value}`,
    dcpWritten: "[vibe-pm] ✅ DCP 配置已写入",
    operationFailed: (msg: string) => `[vibe-pm] ❌ 操作失败：${msg}`,
    installSuccess: (id: string) => `[vibe-pm] ✅ 流程 "${id}" 已成功安装。\n\n已安装到：\n- docs/flow/flow-${id}.md\n\n⚠️ 请重启 OpenCode 后使用 \`/pm-${id}\` 命令启动任务。`,
    installFailure: (msg: string) => `[vibe-pm] ❌ 安装失败：${msg}`,
    installStartHint: "请使用以下工具翻译安装的模板文件（Read → 翻译 → Write）：",
    translateDictNote: "dictionary.md 特殊处理：保留英文术语列，将中文说明列翻译为目标语言。",
    noTemplatesFound: "[vibe-pm] 未在 docs/template/ 下找到任何模板。请确认模板目录结构正确。",
    templateList: (lines: string) => `[vibe-pm] 可用的模板列表：\n\n${lines}\n\n要安装一个流程，请运行：\n\`\`\`\n/pm-install-flow templateId: <模板ID>\n\`\`\``,
    uninstallSuccess: (name: string) => `[vibe-pm] 流程 "${name}" 已移除。\n\n⚠️ 请重启 OpenCode 使变更生效。`,
    uninstallFailure: (msg: string) => `[vibe-pm] 卸载失败：${msg}`,
    flowStartNoSession: "无法获取当前 Session ID。",
  },

  // ─── 初始化向导 ───

  buildInitInstructions(packs: LanguagePack[]): string {
    const languageOptions = packs.map((p) => ({ label: p.label, description: p.locale }));
    const languageOnAnswer: Record<string, { language: string }> = {};
    for (const p of packs) languageOnAnswer[p.label] = { language: p.locale };
    return JSON.stringify({
      flow: "pm-config-init",
      description: "vibe-pm 初始化向导 — 按步骤引导配置项目",
      steps: [
        { id: "scope", title: "配置范围", type: "question", instruction: "询问用户 vibe-pm 配置写入位置。opencode 和集成插件配置始终写入项目级。", params: { header: "配置范围", question: "vibe-pm 配置写入哪里？（opencode 和集成插件配置始终项目级 `.opencode/`）", options: [{ label: "项目级", description: "写入项目目录 `./vibe-pm/config.json`" }, { label: "全局", description: "写入 `~/.config/vibe-pm/config.json`" }] }, onAnswer: { "项目级": { configPath: "./vibe-pm/config.json", scope: "project" }, "全局": { configPath: "~/.config/vibe-pm/config.json", scope: "global" } } },
        { id: "language", title: "交互语言", type: "question", instruction: "写入 PluginConfig.language。", params: { header: "交互语言", question: "选择 vibe-pm 引导流程的交互语言：", options: languageOptions }, onAnswer: languageOnAnswer },
        { id: "gitignore", title: ".gitignore", type: "question", instruction: "依次询问是否追加条目到 .gitignore。条目已存在则跳过。使用 bash 追加。", params: { header: ".gitignore 配置", question: "哪些目录需要加入 .gitignore？", multiple: true, options: [{ label: ".opencode/", description: "OpenCode 配置目录" }, { label: ".vibe-pm/", description: "vibe-pm 配置数据目录" }, { label: ".omo/", description: "oh-my-openagent 计划/配置目录" }] }, skipIfExists: true },
        { id: "agents", title: "AGENTS.md", type: "question", instruction: `生成 AGENTS.md。严格按以下优先级规则执行：\n\n1. 确认模板：查找 docs/template/agents-template.md → 插件内置 dist/docs/template/agents-template.md → ../docs/template/agents-template.md\n\n2. 场景 A — 模板存在：\n   a) AGENTS.md 不存在 → 按模板格式生成。占位符填充规则：\n       - 「概述」「主要功能描述」→ 引导用户填写\n       - 「技术栈」「开发环境说明」→ 你分析项目结构后自动推断\n   b) AGENTS.md 已存在 → 分析现有结构与模板的差异，使用 question 工具询问用户：\n       - 选项 1「完整重写」：按模板格式重写，保留现有 AGENTS.md 中的技术细节\n       - 选项 2「补充缺失章节」：仅添加模板中有而现有文件缺失的章节，不改变现有结构\n       - 选项 3「跳过」\n       ⚠️ 禁止在用户未选择的情况下自行决定"轻量更新"——必须先询问，收到明确选择后再执行\n\n3. 场景 B — 模板不存在：\n   a) AGENTS.md 已存在 → 仅追加 Constitution 引用说明（告知后果）\n   b) AGENTS.md 不存在 → 告知用户模板缺失，退出此步骤\n\n4. Constitution：无论最终采用哪种方式，完成后告知用户 Constitution 块的约束效果`, params: { header: "AGENTS.md", question: "是否生成 AGENTS.md？使用内置模板，你只需填写项目概述和主要功能描述。技术栈和开发环境由我自动推断。", options: [{ label: "是，生成", description: "使用模板生成" }, { label: "否，跳过", description: "不生成 AGENTS.md" }] }, checkExists: true },
        { id: "dictionary", title: "术语字典", type: "question", instruction: `创建项目术语字典 docs/regulation/dictionary.md（如不存在）。\n1. 如果文件已存在，跳过此步骤\n2. 如果不存在，先创建 docs/regulation/ 目录，再从 vibe-pm 插件内置模板（查找路径：先试项目 docs/template/dictionary-template.md，不存在则从插件 dist/docs/template/ 读取）复制模板\n3. 根据当前项目，分析生成 20 条左右的初始术语记录（中英对照）\n4. 在最后的结束总结中提示用户要积极维护字典文档`, checkExists: true, templateFile: "dictionary-template.md", params: { header: "术语字典", question: "是否创建项目术语字典 (docs/regulation/dictionary.md)？将根据项目生成初始术语记录。", options: [{ label: "是，创建", description: "创建字典并生成初始术语" }, { label: "否，跳过", description: "不创建字典" }] } },
        { id: "integrations-dcp", title: "集成: DCP 插件", type: "question", instruction: `配置 DCP (Dynamic Context Pruning) 插件。\n1. 用 bash 检查全局和项目级 opencode 配置中是否已有 DCP 依赖：~/.config/opencode/opencode.json 和 ./.opencode/opencode.json（或 package.json）\n2. 若未安装，询问用户。安装方式：写入 .opencode/opencode.json 的 dependencies`, checkInstalled: "opencode-dynamic-context-pruning", checkPaths: ["~/.config/opencode/opencode.json", ".opencode/opencode.json"], params: { header: "DCP 插件", question: "是否安装 DCP (Dynamic Context Pruning) 插件？将自动写入 .opencode/opencode.json dependencies。", options: [{ label: "是", description: "安装 DCP 插件" }, { label: "否", description: "跳过" }] } },
        { id: "done", title: "完成", type: "info", instruction: "提示用户通过 /pm-install-flow 安装流程模板。", message: "✅ 初始化完成！请使用 `/pm-install-flow` 安装需要的流程模板（如 spec-driven-dev、bug-fix 等）。" },
      ],
    });
  },
};

export default zhCN;
