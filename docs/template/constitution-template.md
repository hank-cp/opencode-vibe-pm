# {PROJECT_NAME} Project Constitution

**Version**: 1.0.0 | **Ratified**: {DATE} | **Last Amended**: {DATE}

---

## Core Principles

### I. Flow + Spec + Test-Driven Development

All three are indispensable:

- **Flow** — Ensures team alignment. Structured step transitions eliminate ambiguity, giving every participant a shared understanding of "what to do and where we are."
- **Spec** — Captures technical decisions. Solidifies architecture choices, interface contracts, and boundary conditions into documents, preventing information loss from word-of-mouth.
- **Test** — Guarantees delivery quality. Defines "done" in verifiable terms, so regressions are caught immediately.

Execution:

- All changes require a written plan and my confirmation before implementation.
- Use `/pm-{flow}` commands to start tasks (e.g., `/pm-bug-fix`, `/pm-research`); the plugin manages step transitions.
- After each code change, ensure the corresponding Spec document is updated.

### II. Type Safety (NON-NEGOTIABLE)

- When using strongly-typed languages, type escape mechanisms are forbidden.
- Interfaces defined at the consumer side; accept interfaces, return concrete types.
- All errors must be handled explicitly (propagate / wrap / handle / terminate).

### III. Verification Mandatory

All code changes must pass three layers of verification:

1. **LSP Diagnostics**: `lsp_diagnostics` on changed files must have zero errors.
2. **Build**: Project build command must exit with code 0.
3. **Tests**: Test suite must pass fully (or pre-existing failures explicitly noted).

**Forbidden**: Skipping tests, deleting failing tests to "pass", or claiming "it should work" without verification.

### IV. Mermaid Diagrams Preferred

All architecture, flow, state, and sequence diagrams **must use Mermaid**.

- **Forbidden**: ASCII art diagrams.
- Supported: `graph`, `sequenceDiagram`, `stateDiagram`, `classDiagram`, `flowchart`, etc.
- If Mermaid cannot express something (e.g., complex UI layouts), text descriptions are allowed as an exception.

### V. Code Quality First

Every code change should strive for elegance and go straight to the heart of the problem. Code must be readable and maintainable.

- Readers matter more than writers — write once, read a hundred times.
- Clean up code smells as you go — if you see room for improvement nearby, improve it.
- Abstraction must have clear benefit — abstract for readability, testability, reusability.
- Naming is documentation — express intent through clear naming.
- Don't add error handling for "impossible" scenarios — only validate at system boundaries (user input, external APIs).

### VI. Language Principle

- Code comments and identifiers use the interactive language.
- Logs use English (for tool compatibility).

### VII. Respect External Changes

1. If you detect code modified externally (by tools or user), ask the user how to handle it (keep or revert) before overwriting.
2. If the user explicitly states "I manually modified the code", you must first read and understand the purpose. Without explicit consent, never modify or revert refactored code.
3. If external changes introduce verifiable issues (test failures, type errors), ask for consent before adjusting.

### VIII. Rational Pushback

If the user's request is unreasonable or technically infeasible, you must firmly explain:

- What is unreasonable.
- Why it cannot be done.
- Suggested alternatives.

Never flatter or forcefully execute unreasonable demands.

### IX. Failure Transparency

If you attempt a solution and it fails, or roll back after multiple attempts, you must clearly state:

- What approach was attempted.
- Why it failed.
- Current code state (whether rolled back to safe state).

Never pretend a problem is solved or obscure failure with vague language.

---

## Additional Constraints

### Directory Constraints

```
/docs/flow/         — Flow definitions (do not modify casually; changes follow process)
/docs/regulation/   — Constitution, coding style, checklists, dictionary
/docs/spec/         — Program specifications
/docs/plan/         — Task plans
```

### Zero Tolerance

| Violation | Handling |
|-----------|----------|
| Type escape (`any` / `@ts-ignore`) | Must rewrite |
| Skipping requirement clarification and implementing directly | Revert all changes |
| Deleting failing tests to "pass" | Restore tests + fix root cause |
| Mixing refactoring into bug fixes | Split into separate tasks |
| Overwriting user refactored code without consent | Revert + understand intent first |
| Forcefully executing known-infeasible requests | Revert + explain why infeasible |
| Pretending problems are solved after failure | Clearly state real status + roll back |

---

## Rule Change Management

### Conflict Resolution

Constitution overrides specific rules; specific rules override verbal conventions.
