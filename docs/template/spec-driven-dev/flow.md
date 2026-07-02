# Spec-Driven Development

**Template ID**: `spec-driven-dev`
**Category**: development
**Description**: Spec-driven standardized development workflow (Understand/Design/Code/Test/Accept/Merge, 12 steps)
**Command**: `/pm-spec-driven-dev`
**Version**: 1.2.0

---

## Applicable Scenarios

- Medium-to-large new feature development
- Tasks involving multi-module interaction
- Complex tasks requiring requirement clarification

---

## Input Requirements

| Input Item | Required | Description |
|--------|------|------|
| Spec Document | Yes | Existing specification document |
| Change Request | Yes | What to change and why |

---

## Default Deliverables

- Updated Spec document
- Code implementation + test code
- Delivery report

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> S1_Understand_Requirements_and_Current_State: Trigger
    S1_Understand_Requirements_and_Current_State --> S2_Identify_Gaps
    S2_Identify_Gaps --> S3_Progressive_Interview
    S3_Progressive_Interview --> S3_Progressive_Interview: Continue inquiry
    S3_Progressive_Interview --> S2_Identify_Gaps: Re-analyze based on clarified answers
    S2_Identify_Gaps --> S3_Progressive_Interview: New questions discovered
    S2_Identify_Gaps --> S4_Modify_Spec: No more questions
    S4_Modify_Spec --> S5_Review_Spec_Changes: Auto
    S5_Review_Spec_Changes --> S4_Modify_Spec: Revisions needed
    S5_Review_Spec_Changes --> S6_Design_Implementation_Plan: Approved
    S6_Design_Implementation_Plan --> S7_Review_Plan: Auto
    S7_Review_Plan --> S6_Design_Implementation_Plan: Revisions needed
    S7_Review_Plan --> S8_Write_Code: Approved
    S8_Write_Code --> S9_Write_Tests
    S9_Write_Tests --> S9_Write_Tests: Tests fail
    S9_Write_Tests --> S10_Self_Check: All passed
    S10_Self_Check --> S11_Review_Confirmation: Self-check passed, no high-risk items
    S10_Self_Check --> S8_Write_Code: High-risk items need fixing
    S11_Review_Confirmation --> S12_Deliver_and_Merge: Approved
    S11_Review_Confirmation --> S8_Write_Code: Fixes needed
    S11_Review_Confirmation --> S4_Modify_Spec: Design issue
    S12_Deliver_and_Merge --> [*]

    note right of S3_Progressive_Interview: ⚠️ User intervention required
    note right of S5_Review_Spec_Changes: ⚠️ User intervention required
    note right of S7_Review_Plan: ⚠️ User intervention required
    note right of S11_Review_Confirmation
        ⚠️ User intervention required
        Design issue → Fall back to S4
    end note
```

---

## Task Steps

### S1: Understand Requirements and Current State

**Goal**: Accurately understand the change intent and the current code state.

1. Read the user-submitted change request
2. Extract core intent — what needs to change? why?
3. Locate and read the corresponding Spec document from the `docs/spec/` directory (do NOT skip this step), then read related source code
4. Mark covered, vague, and missing information
5. Assess whether the Spec document's technical approach is clear enough to directly guide execution — flag any vague, underspecified, or ambiguous technical decisions that would block implementation

**On completion**: Automatically proceed to S2

---

### S2: Identify Information Gaps and Contradictions

**Goal**: Systematically identify vague, missing, and conflicting items.

1. Cross-reference the Spec against the change request, marking missing items, vague items, and contradictions
2. Sort by impact level
3. Prepare a list of interview questions, one per topic
4. **Re-analyze after interview**: Upon returning from S3, re-examine the original S2 gap list based on clarified answers:
   - Do the clarified answers introduce new ambiguities?
   - Do the clarified conclusions conflict with the Spec or change request?
   - Are there previously undiscovered missing items?
5. If new questions are found → compile a new question list and return to S3 to continue interviewing; if no new questions → proceed to S4

**On completion**: No new questions → automatically proceed to S4; new questions found → return to S3

---

### S3: [Human-in-loop] Progressive Interview ⚠️

> **⚠️ This step requires user intervention.** Ask only 1 question at a time.

**Goal**: Clarify ambiguities one question at a time.

1. Use the question / confirm blocking tool
2. Ask only 1 question at a time
3. Loop until the user confirms "no more questions"

**On completion**: User confirms "no more questions" → return to S2 for re-analysis

---

### S4: Modify Spec Design

**Goal**: Based on the requirements clarified through S3 interviews, directly modify the Spec documents to reflect the clarified requirements. Every change must be traceable to an S3 interview conclusion.

1. **Review S3 interview results**: Revisit all Q&A sessions, distill the clarified core requirements
2. **Locate and read relevant Spec documents**: List the involved Spec documents (`docs/spec/`), understand the existing chapter structure
3. **Apply Spec changes directly**: For each chapter, determine and execute the change:
   - **Modify** — Content is outdated, inaccurate, or needs supplementation → edit the file
   - **Add** — New concepts, interfaces, constraints, or flows → write new sections
   - **Delete** — Deprecated design → remove or mark as deprecated
   - **Affected** — Cross-references or dependencies impacted by other changes → update links and references
4. **Annotate traceability**: Each change should include a brief note linking back to the specific S3 interview conclusion that motivated it
5. **Keep Spec consistent**: Ensure no contradictions between sections after modifications

> ⚠️ **Important**: This step modifies Spec documents ONLY. Do NOT write code or create implementation plans yet. Changes must be minimal and directly traceable to interview conclusions.

**On completion**: Automatically proceed to S5

---

### S5: [Human-in-loop] Review Spec Changes ⚠️

> **⚠️ This step requires user intervention.** Present the Spec modifications to the user for review before proceeding to the implementation plan.

**Goal**: User reviews the Spec changes to confirm they correctly capture the clarified requirements.

1. Call `pm_task_set_step(step="S5")` to declare entry
2. Present a summary of Spec changes:
   - Which Spec documents were modified
   - Summary of each change (chapter/section, change type, brief rationale)
   - Diff highlights for key modifications
3. ⚠️ Use the `confirm` tool to wait for user approval:
   - **Must** receive **strongly affirmative** instructions such as "confirm / agree / approved / no problem / go ahead / LGTM" before proceeding
   - Vague or weak affirmative responses ("looks OK", "let's try", "mm", "should be fine") are treated as **unconfirmed**; must follow up for explicit approval
4. **Strictly prohibited** from writing implementation plans or code before receiving explicit confirmation
5. If the user requests revisions → return to S4 to modify the Spec

**State transitions**:
- User explicitly approves → S6
- User requests revisions → return to S4

**On completion**: Explicitly confirmed → S6

---

### S6: Design Implementation Plan

**Goal**: Based on the confirmed Spec changes (from S5), design the code implementation plan, perform Spec vs Code conflict analysis, and **save the Plan as a file** for S7 review.

> ⚠️ **Critical**: This step MUST save the Plan as a file `docs/plan/plan-{taskId}.md`. The S7 review step depends on this file.

#### Analysis Steps

##### Phase 1: Code Change Analysis

1. **Read relevant source code**: Locate affected source files and understand existing implementations
2. **Design code change points**: Map each confirmed Spec change point to an implementation path at the code level
3. **Design test cases**: Design verification plans for each change point

##### Phase 2: Conflict Analysis

4. **Spec vs Code cross-comparison**: Compare the confirmed Spec changes against code change points item by item, identifying inconsistencies:
   - Spec-defined interface signatures don't match code implementations
   - Spec-described constraints are not enforced or are implemented oppositely in code
   - Spec and code use different terminology for the same concept
   - Code contains implicit behaviors not covered by the Spec
5. **Annotate alignment direction**: Provide a recommendation for each conflict (align to Spec / align to Code / compromise), for the user to decide during S7

#### Plan Document Format

```markdown
# Implementation Plan

> Related Spec: [spec document path]
> Based on S3 interview results: [one-sentence summary of core conclusion]
> Goal: [one-sentence goal summary]

---

## 1. Code Changes

### File List

| File | Operation | Description |
|------|------|------|
| path/to/file.ts | Modify | ... |
| path/to/new.ts | Add | ... |

### Change Details

#### CHG-C1: [File/Module Name] — [Operation Type]

- **Related Spec**: [corresponding Spec section]
- **Goal**: [what to change]
- **Approach**: [how to change, brief technical path]
- **Impact**: [which other modules are affected]
- **Test Points**: [what needs to be verified]

#### CHG-C2: ...

### Configuration Items (if applicable)

| Config Item | Location | Change Description |
|--------|------|----------|
| ... | ... | ... |

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|------|----------|
| ... | ... | ... |

### Test Plan

| Test Type | Test Content | Expected Result |
|----------|----------|----------|
| Unit test | ... | ... |
| Integration test | ... | ... |

---

## 2. Spec vs Code Conflicts ⚠️

> Listed below are inconsistencies between the confirmed Spec and code implementation.
> Each conflict includes a **recommended alignment direction**. Please decide during S7 review.

| # | Conflict Description | Spec Definition | Code Status | Impact Scope | Recommended Alignment |
|------|----------|-----------|----------|----------|-------------|
| CF-1 | [brief conflict description] | [what Spec says] | [how code is implemented] | [affected modules] | Align to Spec / Align to Code / Compromise: [brief plan] |
| CF-2 | ... | ... | ... | ... | ... |

> If no conflicts, write "None — Spec and Code are consistent".
```

#### Self-Check Checklist

After saving the Plan file, confirm the following item by item:

- [ ] **Code section**: File list is complete; each CHG-C is linked to a corresponding Spec section
- [ ] **Conflict section**: Spec vs Code compared item by item; no missed implicit inconsistencies
- [ ] Plan file saved to `docs/plan/plan-{taskId}.md`
- [ ] Risks have corresponding mitigations
- [ ] Test plan covers all change points

**On completion**: Plan file saved → automatically proceed to S7

---

### S7: [Human-in-loop] Review Plan ⚠️

**Goal**: User reviews the implementation Plan (Code changes + Conflicts) in one pass, and makes alignment decisions on conflict points.

1. Present the two sections of the Plan document
2. ⚠️ For each CF-* entry in the "Spec vs Code Conflicts" table, use the `question` tool to ask the user for the alignment direction item by item:
   - Options: `Align to Spec` / `Align to Code` / `Compromise`
   - If the user chooses Compromise, follow up to ask for specific compromise details
3. After collecting all decisions, use the `confirm` tool to wait for the user's final confirmation of the overall Plan:
    - **Must** receive **strongly affirmative** instructions from the user such as "confirm / agree / approved / no problem / go ahead / LGTM" before proceeding
    - Vague or weak affirmative responses ("looks OK", "let's try", "mm", "should be fine") are treated as **unconfirmed**; must follow up for explicit approval
4. **Strictly prohibited** from performing any code modifications, file edits, or todo creation before receiving explicit confirmation

**On completion**: Explicitly confirmed → S8; revisions needed → S6; new ambiguities → S3

---

### S8: Write Code

**Goal**: Implement according to the Plan.
**Referenced Regulation**: coding_style.md

1. Implement change points from the Plan one by one
2. Run build/type-check after each change
3. Follow code quality-first principles

**On completion**: All implemented → S9.

> ⚠️ **Iteration Counter**: Each execution of S8 (including re-executions after being sent back from S10 for fixes or from S11 for fixes) increments the S8 iteration count by 1. This count is read by S10 during self-check to determine whether to trigger deep iteration review (threshold: > 5 rounds).

---

### S9: Write Tests and Fix

**Goal**: Write test code and ensure all pass.
**Referenced Regulation**: coding_style.md

1. Write tests according to the Plan's test cases
2. Run tests, fix failures
3. Do NOT delete failing tests

**On completion**: All passed → S10

---

### S10: Self-Check and Code Review

**Goal**: Perform a comprehensive self-check and use code review tools to discover potential issues.

> ⚠️ **Deep Iteration Review Trigger Condition**: If S8 iteration count > 5 rounds, the code review phase automatically upgrades to "Deep Review", additionally checking for ineffective modifications and excessive refactoring.

#### Phase 1: Basic Self-Check

1. Are all Plan tasks fully implemented
2. Do build + tests pass
3. Is the Spec fully implemented
4. Is there any unnecessary refactoring

Basic self-check passed → proceed to Phase 2.
Issues found → return to S8 for fixes.

#### Precursor: Deep Iteration Review (triggered when S8 iteration count > 5)

When S8 has taken more than 5 iterations to reach this step, it indicates the code may have undergone extensive back-and-forth modifications. Before entering formal code review, perform additional deep review:

1. **Ineffective Modification Detection**:
   - Check for patterns of modifying the same code back and forth (changed, then changed back)
   - Identify intermediate changes that were overwritten/deprecated by subsequent modifications
   - Detect residual artifacts from multiple mutually exclusive approaches attempted for the same problem

2. **Excessive Refactoring Detection**:
   - Whether "passing refactoring" beyond the Plan scope introduced unnecessary complexity
   - Whether new abstraction layers, utility functions, or configuration items not covered by the Plan were introduced
   - Whether there is over-engineering for "possible future needs"

3. Output deep review conclusions:
   - Flag suspicious ineffective modification points, recommend whether to roll back some changes
   - Flag out-of-scope excessive refactoring, recommend retention or removal
   - Classify issues found in deep review into the 🔴/🟡/🟢 severity levels below

> If S8 iteration count ≤ 5, skip this phase and go directly to Phase 2.

#### Phase 2: Code Review

> **Conditional execution**: Check if the `/code-review-skill` command is available.
> - If available → perform code review
> - If unavailable → skip this phase, go directly to S11

1. Call `skill(name="/code-review-skill")` to retrieve the code review guide
2. Perform a comprehensive review of the changed files according to the review guide
3. Output a review report, categorized by severity

##### Review Severity Classification

| Severity | Definition | Handling |
|--------|------|----------|
| 🔴 Critical | Security vulnerabilities, data loss risk, logic errors, type safety violations | Must return to S8 for fixes |
| 🟡 Medium | Performance issues, code smells, maintainability issues, missing edge cases | Recorded in report; user decides in S11 whether to fix |
| 🟢 Low | Style issues, naming suggestions, documentation improvements | Recorded in report; user decides in S11 whether to fix |

##### Flow Rules

- **Critical items exist (🔴 > 0)**: Output review report, automatically return to S8 for fixes. Fix each critical item one by one; after fixes, re-enter S9 (tests) → S10 (self-check).
- **No critical items (🔴 = 0)**: Output complete review report (including medium and low severity items), automatically proceed to S11. Medium and low items are left for user decision during review confirmation.

**On completion**: No critical items → S11; critical items exist → S8

---

### S11: [Human-in-loop] Review Confirmation ⚠️

**Goal**: User confirms deliverables and code review results.

1. Present the delivery report
2. If there is an S10 code review report, present the list of medium and low severity items, and use the `question` tool to ask the user:
   - "Code review found N medium items and M low items. Should they be fixed in this round?"
   - Options: "Ignore all, accept directly" / "Fix medium items only" / "Fix all"
3. Use the `confirm` tool to wait for final confirmation

> ⚠️ **Design Issues vs Code Issues**:
> - **Code Issues**: Implementation bugs, missed edge cases, insufficient test coverage → return to S8 for fixes
> - **Design Issues**: User points out the overall approach direction is wrong, Spec understanding is off, architecture choice needs adjustment, the change points designed in the Plan themselves are unreasonable → return to S4 to redesign the Spec

**On completion**:
- Approved (or user chooses to ignore fix items) → S12
- Fixes needed (code-level bugs/omissions) → S8
- Design issue (user points out design direction is wrong, approach is not viable, etc.) → S4 to redesign Spec

---

### S12: Deliver and Merge

**Goal**: Wrap up, update documentation, prepare for commit.

1. Save the delivery report to the Plan
2. Update the Spec document — specifically the **Implementation Plan** section, reflecting the actual code changes made
3. Run final verification
4. Use the `question` tool to ask the user: "Perform `git commit`?"
   - If the user selects "Yes": execute `git add -A && git commit`, using the development summary as the commit message
   - If the user selects "No": skip commit
   - ⚠️ User choice does not affect task completion

**On completion**: Call `pm_task_close()` to end the task and trigger analysis
