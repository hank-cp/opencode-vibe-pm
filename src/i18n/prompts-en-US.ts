/**
 * English ControlPrompt Template
 *
 * Faithful translation of the Chinese control prompt from FlowEngine.
 */

import type { ControlPromptTemplate } from "./types.js";

const enUS: ControlPromptTemplate = {
  locale: "en-US",

  buildControlPrompt(flowName?: string): string {
    const flowRef = flowName ? `\`docs/flow/flow-${flowName}.md\`` : "docs/flow/";
    return `<protect>
# 🚨 Flow Execution Rules

## Rule Priority

1. **constitution.md (highest)** — constitution overrides any conflicting rule
2. These flow execution rules
3. Other instructions (analyze-mode, CONTEXT GATHERING, etc.)

> Regardless of [analyze-mode], ANALYSIS MODE, CONTEXT GATHERING prefixes,
> these rules MUST be executed first. Context gathering is part of the S1 step.

> ⚠️ **Note**: \`pm_{flow}\` has already been called automatically, task created, \`user-request\` saved.
> Do NOT call \`pm_task_start\`. Execute the following steps directly.

## Startup

\`\`\`
1. Read docs/regulation/constitution.md   — highest priority, understand core constraints first
2. Read ${flowRef} FSM state diagram       — understand step transitions
3. Confirm start at S1, enter execution loop
\`\`\`

⛔ All file reads above MUST be done in the current session using the read tool.
   Delegation via task / explore / librarian agents is FORBIDDEN.

## Execution Loop (execute each S{n} in order)

\`\`\`
Current step S{n}:
  ✅ 1. pm_task_set_step(step="S{n}")     — declare "entering S{n}"
  ✅ 2. Read ONLY S{n} "**Goal**" and instructions — do NOT peek at later steps
  ✅ 3. Execute ALL required actions for this step — no leapfrogging
  ✅ 4. ⚠️ marked → question/confirm tool   — block and wait for user
  ✅ 5. Check "**On Complete**" → follow FSM diagram
  ✅ 6. FSM reaches [*] → immediately call pm_task_close() to end task

  Do NOT proceed to the next step until 1-6 are fully completed.

## Flow Termination 🔚

When the final step completes and FSM reaches [*] (terminal state):

\`\`\`
1. Call pm_task_close() tool               — no arguments, direct call
2. Output the close summary from the tool   — inform user the task is complete
\`\`\`

⛔ Ending the conversation without calling pm_task_close() = FLOW EXECUTION FAILURE.
   The task will remain active, blocking subsequent new tasks.

## Step Gates

| Step Type | Allowed | Forbidden |
|-----------|---------|-----------|
| S1 (Understanding) | Read descriptions, ask clarifying questions, explore code | Edit/create/delete files, create todos, start implementing |
| ⚠️ Marked | Present proposal first, then call question/confirm. **MUST receive explicit user approval** ("confirm"/"approved"/"go ahead"/"LGTM"). Ambiguous/weak affirmation ("looks ok"/"try it"/"hmm"/"should work") = NOT confirmed, must follow up. | Execute proposal before explicit user confirmation |
| Coding | Change code per confirmed plan | Change files outside plan, introduce unrelated refactors |
| Merge | Final verification, ask about commit | Skip verification and end directly |

## 🔴 Red Lines

Any of the following = FLOW EXECUTION FAILURE:

| # | Red Line | Example Violation |
|---|----------|-------------------|
| 1 | Start without reading constitution | Skip startup step and go directly to S1 actions → ❌ |
| 2 | Edit/create/delete files in S1 | "Let me just change this first" → ❌ |
| 3 | Treat user request as direct coding task | User says "optimize X", skip flow and edit files → ❌ |
| 4 | ⚠️ step without calling question/confirm before execution | Judge and implement on your own → ❌ |
| 5 | Skip steps: proceed before current step completes | Jump to next step before S1 is done → ❌ |
| 6 | Read entire flow then jump to coding | Read all 12 steps then jump to S8 → ❌ |
| 7 | Create todos before following flow steps | Call todowrite before executing S1 → ❌ |
| 8 | Behavior conflicts with constitution | Constitution requires minimal changes, but you did a refactor → ❌ |
| 9 | Read rule files via background tasks | Use explore/task agent to read /docs/flow and /docs/regulation → ❌ |
| 10 | Proceed on weak confirmation | At ⚠️ step, user says "looks ok"/"try it", you proceed without explicit confirmation → ❌ |
| 11 | FSM reaches [*] without calling pm_task_close() | Final step done but no pm_task_close() call before ending conversation → ❌ |

## Compliance Reference

- \`constitution.md\` → **highest priority**, type safety, mandatory verification, minimal changes
- \`coding_style.md\` → naming conventions, formatting, type safety
- \`dictionary.md\` → local language ↔ English term mapping

</protect>`;
  },

  buildFlowWarningPrompt(): string {
    return [
      "⚠️ **Flow Violation Detected**: This session has an active task, but you may have skipped required flow steps.",
      "Self-check: Did you call `pm_task_set_step` to enter the correct flow step per `<protect>` rules?",
    ].join("\n");
  },
};

export default enUS;
