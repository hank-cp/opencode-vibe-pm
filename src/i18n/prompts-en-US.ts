import type { LanguagePack } from './types.js';

const enUS = {
  locale: 'en-US',

  buildControlPrompt(flowName?: string): string {
    const flowRef = flowName ? `\`docs/flow/flow-${flowName}.md\`` : 'docs/flow/';
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
      '⚠️ **Flow Violation Detected**: This session has an active task, but you may have skipped required flow steps.',
      'Self-check: Did you call `pm_task_set_step` to enter the correct flow step per `<protect>` rules?',
    ].join('\n');
  },

  isControlPromptPart(text: string): boolean {
    return text.includes('<protect>');
  },

  isWarningPromptPart(text: string): boolean {
    return text.includes('Flow Violation Detected');
  },

  tool: {
    unknownError: 'Unknown error',
    noSessionId: 'Cannot get current Session ID',
    setStepNoTask: 'Step set successfully but unable to get task status',
    unknownSubCommand: (sub: string) =>
      `[vibe-pm] ❌ Unknown sub-command: "${sub}". Supported: view, edit, init`,
    editNeedKey: '[vibe-pm] ❌ edit requires key parameter',
    editNeedValue: '[vibe-pm] ❌ edit requires value parameter',
    configUpdated: (key: string, value: string) => `[vibe-pm] ✅ Config updated: ${key} = ${value}`,
    dcpWritten: '[vibe-pm] ✅ DCP config written',
    operationFailed: (msg: string) => `[vibe-pm] ❌ Operation failed: ${msg}`,
    installSuccess: (id: string) =>
      `[vibe-pm] ✅ Flow "${id}" installed.\n\nInstalled to:\n- docs/flow/flow-${id}.md\n\n⚠️ Restart OpenCode then use \`/pm-${id}\`.`,
    installFailure: (msg: string) => `[vibe-pm] ❌ Install failed: ${msg}`,
    installStartHint:
      'Translate using the dictionary-template.md terminology table (Read → Translate → Write). Do NOT translate: FSM, Human-in-loop.',
    noTemplatesFound:
      '[vibe-pm] No templates found under docs/template/. Check template directory.',
    templateList: (lines: string) =>
      `[vibe-pm] Available templates:\n\n${lines}\n\nTo install: \`\`\`\n/pm-install-flow templateId: <ID>\n\`\`\``,
    uninstallSuccess: (name: string) =>
      `[vibe-pm] ✅ Flow "${name}" removed.\n\n⚠️ Restart OpenCode for changes to take effect.`,
    uninstallFailure: (msg: string) => `[vibe-pm] ❌ Uninstall failed: ${msg}`,
    noSessionIdShort: 'Cannot get current Session ID',
    flowStartNoSession: 'Cannot get current Session ID.',
    commandDesc: {
      'pm-install-flow': 'Install a flow from template library',
      'pm-uninstall-flow': 'Remove an installed flow',
      'pm-refine-flow': 'Iteratively refine a flow definition',
      'pm-task-set-step': 'Manually jump to a specific step',
      'pm-task-close': 'Close the current task and trigger analysis',
      'pm-task-current-step': 'Get current step of active task',
      'pm-config': 'View or modify plugin configuration',
    },
  },

  codingStyle: {
    generateIndex: (languagesStr: string, tableRows: string) =>
      `# Coding Style

> ⚠️ **Important — Must Read**: The language-specific coding style files below are mandatory standards for this project.
> Before writing or modifying any code, you **must** read the specific file for the current language.
>
> Detected languages: ${languagesStr}

## General Rules

- Always use UTF-8 encoding with LF line endings
- Use English for code comments
- Validate input at system boundaries (user input, external APIs)
- All errors must be handled explicitly
- Prefer early returns to reduce nesting depth

## Language-Specific Standards

Make sure to read the coding standard files for the languages used in this project:

| Language | Standard |
|----------|----------|
${tableRows}
`,
  },

  error: {
    duplicateActiveTask: (
      flow: string,
      step: string,
      stepName: string,
      summary: string,
      startAt: string,
    ) => `
This session already has an active task:
- Flow: ${flow}
- Current Step: ${step} - ${stepName}
- Summary: ${summary}
- Started: ${startAt}

Please run /pm-task-close to close the current task before starting a new one.`,
  },

  buildInitInstructions(packs: LanguagePack[]): string {
    const languageOptions = packs.map((p) => ({ label: p.label, description: p.locale }));
    const languageOnAnswer: Record<string, { language: string }> = {};
    for (const p of packs) languageOnAnswer[p.label] = { language: p.locale };
    return JSON.stringify({
      flow: 'pm-config-init',
      description: 'vib-pm initialization wizard — guided project setup',
      steps: [
        {
          id: 'language',
          title: 'Language',
          type: 'question',
          instruction:
            'Ask user to choose interactive language. DO NOT auto-provide language parameter — use question tool first. After user answers, call pm_config init with language=<locale> to get remaining steps in the chosen language.',
          params: {
            header: 'Language / 语言',
            question: 'Choose vib-pm interactive language / 选择交互语言:',
            options: languageOptions,
          },
          onAnswer: languageOnAnswer,
          nextAction: 'call pm_config init subCommand=init language=<locale>',
        },
      ],
    });
  },

  buildInitRemainingSteps(_packs: LanguagePack[]): string {
    return JSON.stringify({
      flow: 'pm-config-init',
      description: 'vib-pm initialization wizard — remaining setup steps',
      steps: [
        {
          id: 'scope',
          title: 'Config Scope',
          type: 'question',
          instruction:
            'Ask user where to write vib-pm config. OpenCode and integration plugin configs are always project-level.',
          params: {
            header: 'Scope',
            question:
              'Where to write vib-pm config? (OpenCode & integration plugins always project-level `.opencode/`)',
            options: [
              { label: 'Project', description: 'Write to `.vibe-pm/config.json`' },
              {
                label: 'Global',
                description: 'Write to `~/.config/vibe-pm/config.json`',
              },
            ],
          },
          onAnswer: {
            Project: { configPath: '.vibe-pm/config.json', scope: 'project' },
            Global: { configPath: '~/.config/vibe-pm/config.json', scope: 'global' },
          },
        },
        {
          id: 'gitignore',
          title: '.gitignore',
          type: 'question',
          instruction:
            'Ask whether to append entries to .gitignore. Skip if already exists. Use bash.',
          params: {
            header: '.gitignore',
            question: 'Which directories to add to .gitignore?',
            multiple: true,
            options: [
              { label: '.opencode/', description: 'OpenCode config' },
              {
                label: '.vibe-pm/',
                description: 'vib-pm data dir',
              },
              { label: '.omo/', description: 'oh-my-openagent plans/config' },
            ],
          },
          skipIfExists: true,
        },
        {
          id: 'agents',
          title: 'AGENTS.md',
          type: 'question',
          instruction: `
Generate or update AGENTS.md. Why update?
- Unify interaction language (Thinking/Reply language) for consistent AI output
- Reduce irrelevant context injection and noise, improving AI reasoning efficiency

Follow strictly:
1. Locate template at these paths (search in order):
  - docs/template/agents-template.md
  - .opencode/node_modules/@laxture/vibe-pm/dist/docs/template/agents-template.md
  - ${import.meta.dirname}/docs/template/agents-template.md
  - Fallback: use glob "**/agents-template.md" to find the file
2. Scenario A — template found:
  a) AGENTS.md does not exist → generate using template. Placeholder rules:
    - "Overview" & "Main Features" → ask user to fill in
    - "Tech Stack" & "Development Environment" → auto-detect from project
  b) AGENTS.md exists → analyze diff between existing structure and template, then ask user via question tool:
    - Option 1 "Full Rewrite": rewrite in template format, preserve tech details from existing AGENTS.md
    - Option 2 "Add Missing Sections": only add sections from template that are missing, do not change existing structure
    - Option 3 "Skip"
    ⚠️ FORBIDDEN to decide "light update" without user confirmation — MUST ask with 3 options and wait for explicit choice
3. Scenario B — template NOT found:
  a) AGENTS.md exists → only append Constitution reference note (inform user of implications)
  b) AGENTS.md does not exist → inform user template is missing, exit this step
4. Constitution reference confirmation: regardless of approach, additionally ask user via question tool:
    "Reference /docs/regulation/constitution.md in AGENTS.md?"
    - Option 1 "Yes, reference": add Constitution reference block at the top of AGENTS.md. Constitution constraints auto-apply in flow tasks
    - Option 2 "No, skip": inform user: without referencing, constitution.md is only read during flow tasks; its constraints do NOT auto-apply in non-flow tasks`,
          checkExists: true,
          templateFile: 'agents-template.md',
          params: {
            header: 'AGENTS.md',
            question:
              'Generate AGENTS.md? Template requires only overview & features. Tech stack auto-detected.',
            options: [
              {
                label: 'Yes, generate',
                description: 'Use template (unified language + noise reduction)',
              },
              {
                label: 'No, skip',
                description: 'Skip',
              },
            ],
          },
        },
        {
          id: 'dictionary',
          title: 'Term Dictionary',
          type: 'question',
          instruction: `
Create project term dictionary docs/regulation/dictionary.md (if not exists).
1. Skip if exists
2. Copy from template
3. ⚠️ Extract real terms from existing project code/docs, FORBIDDEN to invent terms or translations
4. Generate ~20 initial terms (zh↔en)
5. Remind user to maintain`,
          checkExists: true,
          templateFile: 'dictionary-template.md',
          params: {
            header: 'Dictionary',
            question: 'Create term dictionary? Will generate initial terms from project analysis.',
            options: [
              { label: 'Yes, create', description: 'Create with initial terms' },
              {
                label: 'No, skip',
                description: 'Skip',
              },
            ],
          },
        },
        {
          id: 'integrations-dcp',
          title: 'Integration: DCP',
          type: 'question',
          instruction: `
Configure DCP (Dynamic Context Pruning) plugin.
1. Use bash to check global and project-level opencode configs for the plugin "@tarquinen/opencode-dcp":
  - ~/.config/opencode/opencode.json (global config)
  - ./.opencode/opencode.json (project config)
2. If not installed → suggest installation. Command: "opencode plugin @tarquinen/opencode-dcp@latest --global"
3. Configure DCP: merge the following config into "~/.config/opencode/dcp.jsonc" or "~/.config/opencode/dcp.json"
   (if neither exists, create dcp.jsonc)
\`\`\`json
{
  "compress": {
    "protectTags": true
  },
  "protectedFilePatterns": [
    "docs/flow/*",
    "docs/regulation/*",
    "docs/spec/*"
  ]
}
\`\`\``,
          checkInstalled: 'opencode-dynamic-context-pruning',
          checkPaths: ['~/.config/opencode/opencode.json', '.opencode/opencode.json'],
          params: {
            header: 'DCP Plugin',
            question:
              'Install DCP (Dynamic Context Pruning) plugin? Writes to .opencode/opencode.json.',
            options: [
              { label: 'Yes', description: 'Install' },
              { label: 'No', description: 'Skip' },
            ],
          },
        },
        {
          id: 'integrations-vision',
          title: 'Integration: Vision Agent',
          type: 'question',
          instruction: `
Configure Vision Agent (multimodal image-reading subagent).
1. Write agent config to .opencode/agents/vision-helper.md. Template: ${import.meta.dirname}/docs/template/visual-helper-template.md
2. Skip if agent config already exists`,
          checkInstalled: 'vision-helper',
          params: {
            header: 'Vision Agent',
            question: 'Configure Vision Agent (multimodal image-reading subagent)?',
            options: [
              { label: 'Yes', description: 'Configure Vision Agent' },
              { label: 'No', description: 'Skip' },
            ],
          },
        },
        {
          id: 'integrations-code-review',
          title: 'Integration: Code Review Skill',
          type: 'question',
          instruction: `
Install Code Review Skill.
1. Check if installed: look for ~/.agents/skills/code-review-skill/SKILL.md, ~/.claude/skills/code-review-skill/SKILL.md
2. If missing, ask user. Install via:
   git clone https://github.com/awesome-skills/code-review-skill ~/.agents/skills/code-review-skill
3. Inform user to restart OpenCode and use /code-review-skill`,
          checkInstalled: 'code-review-skill',
          params: {
            header: 'Code Review Skill',
            question:
              'Install Code Review Skill? Provides comprehensive code review capabilities. (https://github.com/awesome-skills/code-review-skill)',
            options: [
              { label: 'Yes, install', description: 'Clone to ~/.agents/skills/code-review-skill' },
              { label: 'No, skip', description: 'Skip' },
            ],
          },
        },
        {
          id: 'done',
          title: 'Done',
          type: 'question',
          instruction: 'Tell user to install flow templates via /pm-install-flow.',
          params: {
            header: 'Install Flow Templates',
            question:
              'Setup is almost complete! Use `/pm-install-flow` to install flow templates (e.g. spec-driven-dev, bug-fix).',
            options: [{ label: 'Got it', description: 'Finish setup' }],
          },
        },
      ],
    });
  },
};

export default enUS;
