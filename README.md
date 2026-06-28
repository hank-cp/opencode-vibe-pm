# vibe-pm

![NPM Version](https://img.shields.io/npm/v/@laxture/vibe-pm)
![Test](https://github.com/hank-cp/opencode-vibe-pm/workflows/CI%20Test/badge.svg)
![GitHub](https://img.shields.io/github/license/hank-cp/opencode-vibe-pm)
![GitHub last commit](https://img.shields.io/github/last-commit/hank-cp/opencode-vibe-pm.svg)

> **Structured development workflows for OpenCode.**
>
> vibe-pm is a OpenCode plugin. It keeps vibe-coding on rails.

[中文文档](README.zh-CN.md)

## Why vibe-pm?

The problem:

- `AGENTS.md` and `rules/*.md` are force-loaded into every message, **wasting context window**
- Existing auto-trimming tools are **opaque** — you never know what was dropped or why
- Forgetting gets worse, not better — important context vanishes silently

vibe-pm solves this by injecting **only what the current step needs** — no more, no less. Every task is driven by three artifacts:

| Artifact | Answers |
|----------|---------|
| **Spec** | What to build |
| **Task Plan** | How to build it |
| **Task State** | Where we are now |

Key checkpoints require human approval. No silent drift.

## Features

1. Inject workflow control into LLM context — the plugin ensures **stable, controlled** vibe-coding sessions
2. Teams **customize their own workflows** and continuously refine them over time
3. **Spec + Task-driven**: every session is anchored by Spec → Plan → State
4. Key steps enforce **human approval** — your Coding Agent never drifts off-course
5. **Native language support** — vibe-code in your own language with a unified dictionary to eliminate naming ambiguity
6. Collect **real-time Token usage statistics**, and display in TUI sidebar

This project is built entirely with vibe-pm and Chinese as the development language.

## Installation

```bash
# Install globally
opencode plugin @laxture/vibe-pm@latest --global
```

## Quick Start

```
# Initialize configuration
/pm-config init

# Install a workflow template
/pm-install-flow bug-fix

# Start a task
/pm-bug-fix "Login returns 500 after password reset"
```

## Use Cases

```
# Research a topic
/pm-research Analyze migration from REST to GraphQL

# Write a Spec
/pm-design-spec Add bank card payment support

# New feature (full spec-driven workflow)
/pm-spec-driven-dev Implement feature per @docs/spec/spec-new-feature.md

# Modify existing feature
/pm-spec-driven-dev Check inventory before payment, block if stock insufficient

# Bug fix (with root cause analysis)
/pm-bug-fix Login returns 500 after password reset

# Large-scale refactor (with impact assessment)
/pm-large-refactor Extract payment module into microservice

# Refine a workflow
/pm-refine-flow Modify the bug-fix flow to require a bug ID if not provided
```

## Who's It For?

- **Detail-oriented control freaks** — you want precise control over every technical decision, not leaving everything to the LLM
- **Experienced software engineers and architects** — you likely need traditional project management experience to effectively project your management philosophy onto your Coding Agent (treat it as your loyal but dim-witted employee)

If you've been haunted by "did the AI skip a step?" or "where did that decision come from?" — vibe-pm is for you.

## Built-in Flow Templates

| Template | Command | Use Case |
|----------|---------|----------|
| `design-spec` | `/pm-design-spec` | Progressive Spec design |
| `spec-driven-dev` | `/pm-spec-driven-dev` | New feature development & feature changes (sync Spec) |
| `bug-fix` | `/pm-bug-fix` | Bug fix with root cause analysis and fix plan review |
| `large-refactor` | `/pm-large-refactor` | Large-scale refactoring |
| `side-job` | `/pm-side-job` | Quick turnaround (must confirm plan before execution) |
| `research` | `/pm-research` | General research — output findings first, then decide next steps |

## Commands

| Command | Purpose |
|---------|---------|
| `/pm-config` | View / edit plugin config; `init` to start setup wizard |
| `/pm-install-flow` | Install a workflow from the template library |
| `/pm-uninstall-flow` | Remove a workflow |
| `/pm-task-set-step` | Jump to a specific step |
| `/pm-task-close` | Close task → trigger analysis |
| `/pm-task-current-step` | Show current step |
| `/pm-task-refresh` | Re-inject context for the current step |

Workflow-specific commands (e.g. `/pm-research`, `/pm-bug-fix`) are auto-generated when you install a flow template.

## License

Apache 2.0
