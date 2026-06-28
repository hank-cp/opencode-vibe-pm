# Feature Spec Template

## Usage

When creating a new Feature Spec, follow the structure of this template, output to `/docs/spec/{feature-name}.md`, and fill in each section accordingly. Sections not applicable to the current feature may be removed.

For non-code-oriented features (process design, architecture design, rule definition, etc.), tailor the sections as appropriate.

---

# {Feature Title}

**Created Date**: {YYYY-MM-DD}
**Status**: Draft / Review / Final
**Input Source**: {User Request / Design Discussion / Technical Proposal / Task Requirement}

---

## Background & Requirements

<!-- Describe the target problem to solve, and the consequences of not solving it -->

{Background Description}

---

## Use Cases & User Stories

<!--
  User stories are ordered by priority (P1/P2/P3).
  Each user story must be independently testable and independently deliverable.
  P1 = core value; even if only this one is implemented, it should form a usable MVP.
  For non-interactive features (e.g., architecture, process, rules), user stories can be omitted;
  use "Use Case Scenarios" to describe system behavior instead.
-->

### User Story 1 — {Title} (Priority: P1)

{Brief description of the user journey}

**Priority Reason**: {Why it is P1}

**Independent Verification**: {How to independently test this story — e.g., "After running xxx command, xxx output should appear"}

**Acceptance Scenarios**:

1. **Given** {initial state}, **When** {action}, **Then** {expected result}
2. **Given** {initial state}, **When** {action}, **Then** {expected result}

---

### User Story 2 — {Title} (Priority: P2)

{Brief description of the user journey}

**Priority Reason**: {Why it is P2}

**Independent Verification**: {How to independently test this story}

**Acceptance Scenarios**:

1. **Given** {initial state}, **When** {action}, **Then** {expected result}

---

### User Story 3 — {Title} (Priority: P3)

{Brief description of the user journey}

**Priority Reason**: {Why it is P3}

**Independent Verification**: {How to independently test this story}

**Acceptance Scenarios**:

1. **Given** {initial state}, **When** {action}, **Then** {expected result}

---

## Design Highlights

### Domain Model

{Core entities/concepts involved, and the relationships between entities}

| Entity | Attributes | Relationships |
|--------|------------|---------------|
| {Entity Name} | {Key Attributes} | {Related entities and their relationships} |

### Critical Path

{Main flow description; may use step list or flow chart}

### Conditional Branches

{Behavior branches under different conditions}

### Interface Design

{Externally exposed interfaces, parameters, and return values}

### Interaction Design

{User-system interaction flow, key interface layouts, or operation sequences}

> Optionally use Mermaid sequence diagrams to describe interactions

### Configurable Items

| Config Item | Default Value | Description |
|-------------|---------------|-------------|
| {key} | {value} | {description} |

---

## Decomposition Index

<!--
  Use this section when the Spec scope is too large to describe all details in a single document.
  "Design Highlights" retains only the layered architecture (domain model, module relationships, critical path);
  detailed designs for individual feature points (domain models, interface designs, test cases, etc.)
  are decomposed into independent Specs.
  Remove this comment and table when not applicable.
-->

| Feature Point | Detailed Spec | Description |
|---------------|---------------|-------------|
| {Feature Point Name} | [`spec-{name}.md`](./{parent-feature}/spec-{name}.md) | {Brief description} |

---

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| {Empty input} | {How to handle} |
| {Extreme value input} | {How to handle} |
| {Concurrent access} | {How to handle} |
| {Dependency unavailable} | {Degradation strategy} |
| {Invalid operation} | {Error message} |

---

## Test Cases

### ${Test File Name}

- **Test File**: `[file name](/path/to/xxx_test.go)`
- **Associated Design Doc**: The associated Feature Spec document
- **Setup/Teardown**: What needs to be done for Setup/Teardown

| Action | Test Method | Given | When | Then | Notes |
|--------|-------------|-------|------|------|-------|
| ${Add/Modify/Deprecate} | `${testMethod}` | ${gherkin} | ${gherkin} | ${gherkin} | ${notes} |

---

## Constraints & Limitations

### Technical Constraints

{Dependency versions, performance requirements, compatibility requirements}

### Business Constraints

{Unbreakable business rules, compliance/security requirements}

### Known Risks

{Greatest uncertainties, most likely areas to go wrong}

### Impact Scope

{Which existing modules are affected, whether existing code needs modification}

---

## Implementation Plan

> This section is continuously updated during development. Break down by milestone granularity, associating each milestone with feature points and risks.

### [x] Milestone 1 — {Title}

- [x] {Feature Point 1}
  - Known Issues/Risks: {Issues/risks remaining at delivery time, to be resolved later}

### [ ] Milestone 2 — {Title}

- [x] {Feature Point 2}
  - Known Issues/Risks: {Same as above}
