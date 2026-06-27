/**
 * 中文 ControlPrompt 模板
 *
 * 内容来源于 FlowEngine.buildControlPrompt() 和 buildFlowWarningPrompt() 的现有硬编码中文文本。
 */

import type { ControlPromptTemplate } from "./types.js";

const zhCN: ControlPromptTemplate = {
  locale: "zh-CN",

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
};

export default zhCN;
