import type { LanguagePack } from "./types.js";

const enUS = {
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

  isControlPromptPart(text: string): boolean {
    return text.includes("<protect>");
  },

  isWarningPromptPart(text: string): boolean {
    return text.includes("Flow Violation Detected");
  },

  tool: {
    unknownError: "Unknown error",
    noSessionId: "Cannot get current Session ID",
    setStepNoTask: "Step set successfully but unable to get task status",
    unknownSubCommand: (sub: string) => `[vibe-pm] ❌ Unknown sub-command: "${sub}". Supported: view, edit, write-dcp, setup-dcp, init`,
    editNeedKey: "[vibe-pm] ❌ edit requires key parameter",
    editNeedValue: "[vibe-pm] ❌ edit requires value parameter",
    configUpdated: (key: string, value: string) => `[vibe-pm] ✅ Config updated: ${key} = ${value}`,
    dcpWritten: "[vibe-pm] ✅ DCP config written",
    operationFailed: (msg: string) => `[vibe-pm] ❌ Operation failed: ${msg}`,
    installSuccess: (id: string) => `[vibe-pm] ✅ Flow "${id}" installed.\n\nInstalled to:\n- docs/flow/flow-${id}.md\n\n⚠️ Restart OpenCode then use \`/pm-${id}\`.`,
    installFailure: (msg: string) => `[vibe-pm] ❌ Install failed: ${msg}`,
    installStartHint: "Please translate template files (Read → Translate → Write):",
    translateDictNote: "dictionary.md: Keep English terms, translate descriptions to target language.",
    noTemplatesFound: "[vibe-pm] No templates found under docs/template/. Check template directory.",
    templateList: (lines: string) => `[vibe-pm] Available templates:\n\n${lines}\n\nTo install: \`\`\`\n/pm-install-flow templateId: <ID>\n\`\`\``,
    uninstallSuccess: (name: string) => `[vibe-pm] ✅ Flow "${name}" removed.\n\n⚠️ Restart OpenCode for changes to take effect.`,
    uninstallFailure: (msg: string) => `[vibe-pm] ❌ Uninstall failed: ${msg}`,
    noSessionIdShort: "Cannot get current Session ID",
    flowStartNoSession: "Cannot get current Session ID.",
  },

  buildInitInstructions(packs: LanguagePack[]): string {
    const languageOptions = packs.map((p) => ({ label: p.label, description: p.locale }));
    const languageOnAnswer: Record<string, { language: string }> = {};
    for (const p of packs) languageOnAnswer[p.label] = { language: p.locale };
    return JSON.stringify({
      flow: "pm-config-init",
      description: "vib-pm initialization wizard — guided project setup",
      steps: [
        { id: "scope", title: "Config Scope", type: "question", instruction: "Ask user where to write vib-pm config. OpenCode and integration plugin configs are always project-level.", params: { header: "Scope", question: "Where to write vib-pm config? (OpenCode & integration plugins always project-level `.opencode/`)", options: [{ label: "Project", description: "Write to `./vibe-pm/config.json`" }, { label: "Global", description: "Write to `~/.config/vibe-pm/config.json`" }] }, onAnswer: { "Project": { configPath: "./vibe-pm/config.json", scope: "project" }, "Global": { configPath: "~/.config/vibe-pm/config.json", scope: "global" } } },
        { id: "language", title: "Language", type: "question", instruction: "Write PluginConfig.language.", params: { header: "Language", question: "Choose vib-pm interactive language:", options: languageOptions }, onAnswer: languageOnAnswer },
        { id: "gitignore", title: ".gitignore", type: "question", instruction: "Ask whether to append entries to .gitignore. Skip if already exists. Use bash.", params: { header: ".gitignore", question: "Which directories to add to .gitignore?", multiple: true, options: [{ label: ".opencode/", description: "OpenCode config" }, { label: ".vibe-pm/", description: "vib-pm data dir" }, { label: ".omo/", description: "oh-my-openagent plans/config" }] }, skipIfExists: true },
        { id: "agents", title: "AGENTS.md", type: "question", instruction: `Generate AGENTS.md by strict priority:\n\n1. Locate template\n2. Scenario A — template exists:\na) Missing → generate\nb) Exists → ask user (Full Rewrite / Add Missing / Skip, MUST confirm before acting)\n3. Scenario B — missing:\na) Exists → append Constitution reference\nb) Missing → inform user\n4. Constitution: inform user of constraints`, params: { header: "AGENTS.md", question: "Generate AGENTS.md? Template requires only overview & features. Tech stack auto-detected.", options: [{ label: "Yes, generate", description: "Use template" }, { label: "No, skip", description: "Skip" }] }, checkExists: true },
        { id: "dictionary", title: "Term Dictionary", type: "question", instruction: `Create project term dictionary docs/regulation/dictionary.md (if not exists).\n1. Skip if exists\n2. Copy from template\n3. Generate ~20 initial terms (zh↔en)\n4. Remind user to maintain`, checkExists: true, templateFile: "dictionary-template.md", params: { header: "Dictionary", question: "Create term dictionary? Will generate initial terms from project analysis.", options: [{ label: "Yes, create", description: "Create with initial terms" }, { label: "No, skip", description: "Skip" }] } },
        { id: "integrations-dcp", title: "Integration: DCP", type: "question", instruction: `Configure DCP plugin.\n1. Check global & project configs for DCP dependency\n2. If missing, ask user. Write to .opencode/opencode.json`, checkInstalled: "opencode-dynamic-context-pruning", checkPaths: ["~/.config/opencode/opencode.json", ".opencode/opencode.json"], params: { header: "DCP Plugin", question: "Install DCP (Dynamic Context Pruning) plugin? Writes to .opencode/opencode.json.", options: [{ label: "Yes", description: "Install" }, { label: "No", description: "Skip" }] } },
        { id: "done", title: "Done", type: "info", instruction: "Tell user to install flow templates via /pm-install-flow.", message: "✅ Setup complete! Use `/pm-install-flow` to install flow templates (e.g. spec-driven-dev, bug-fix)." },
      ],
    });
  },
};

export default enUS;
