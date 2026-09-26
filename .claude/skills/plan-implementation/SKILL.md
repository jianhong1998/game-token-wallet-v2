---
name: plan-implementation
description: Runs the ticket planning pipeline end-to-end from a ticket file to an approved implementation plan.
disable-model-invocation: true
argument-hint: Ticket number (REG-123) or describe what you want to plan.
---

Explore → clarify → spec → plan, one ticket at a time. openspec owns the spec-of-record; superpowers owns the TDD implementation plan. Don't skip a step or hand-write output a prior step already produced. Stops before implementation — the user green-lights that separately.

**Input:** `/plan-implementation <ticket-number | JIRA-KEY | description>` (e.g. `REG-123`, `CSG-42`, or a free-text description of what to plan). A bare ticket number is resolved against `docs/tickets/000-index.md`. Ask for one if neither is given.

If a Jira key is given (e.g. `CSG-42`), invoke `fetch-ticket-from-jira` first to download the ticket tree to `docs/tickets/`, reformat the output, then proceed with the resulting file.

**Resuming:** if `openspec/changes/<feature>/` or a `docs/superpowers/plans/*-<feature>.md` already exists for this ticket, ask whether to resume from there instead of regenerating it.

## Steps

1. **Explore.** Read the ticket file fully, any `openspec/specs/<capability>/spec.md` covering the same capability, and the code paths / blocked-by tickets it names. No skill invocation, no artifact — just enough to ask informed questions next.

   Done when: you can state the ticket's scope and every open question in one line.

2. **Clarify.** Invoke the `interview-me` skill — mandatory every ticket, even ones that look clear-cut. No separate decision-log file for ticket-level sessions; the resolved answers feed straight into Step 3's grilling and Step 4's `proposal.md`/`design.md`, where the rationale gets recorded.

   Done when: the direction and intent are clear. Open implementation details are intentionally left for Step 3.

3. **Brainstorm.** Invoke the `grilling` skill to stress-test the implementation approach. Walk every branch: edge cases, failure modes, dependency order, data model changes, permission implications, migration impact. Each question comes with your recommended answer; wait for the user's reply before moving on.

   Done when: every undecided implementation detail — surfaced during exploration or clarification — has an explicit answer.

4. **Spec.** Invoke `openspec-propose` for the feature (kebab-case name derived from the ticket title). Produces `openspec/changes/<feature>/`: `proposal.md`, `design.md`, `specs/<capability>/spec.md` delta specs, `tasks.md`. This is the spec-of-record for planned work — `openspec/specs/<capability>/spec.md` itself reflects only shipped behavior and is never hand-edited here.

   Gate: show the user the proposal/design and get explicit approval — AskUserQuestion or a direct confirmation, never inferred from silence or from the files simply existing — before Step 6.

5. **Plan.** Invoke `superpowers:writing-plans` against the approved change's `proposal.md`/`design.md`/`specs/*.md`. Produces `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, tasks headed `### Task N: <name>` — exact format, the implementation pipeline parses it. (Distinct from `openspec-propose`'s own `tasks.md`, which uses a coarser `## N. Group` / `- [ ] N.M item` checklist for openspec's internal tracking — not what the implementation pipeline reads.)

   **TDD is mandatory.** Every implementation task must be preceded by a "write failing test" task in the plan. No implementation step without a prior test step — the plan must make this explicit.

   Wire the header, right after the `> **For agentic workers:**` blockquote:
   - `**Ticket:**` → relative link to `docs/tickets/<NNN>-<feature>.md`
   - `**Spec:**` → relative link to `openspec/changes/<feature>/`

   Then edit the ticket file to add a reciprocal `**Plan:**` line beside its `**Spec:**` line, pointing at the new plan file (update the ticket's `**Spec:**` line too if it still points at a pre-openspec doc).

   Done when: ticket and plan link to each other in both directions.

6. **Plan for Testing.** Invoke `writing-test` to plan integration test and E2E test coverage for the feature. Classify each testable behavior by tier (unit / integration / E2E) using the skill's decision table, identify test files, fixtures, and scenarios. Append the test boundaries and plan as a `## Test Plan` section in the plan file from Step 5.

   Done when: the plan file contains a `## Test Plan` section covering integration and E2E test cases.

7. **Review ↔ Revise Loop (≤3 iterations).** Capped loop that reviews the complete plan+spec and revises until clean or cap hit.

   ```
   iteration = 0
   LOOP:
     iteration += 1
     1. REVIEW — invoke `autonomous-development-plugin:enhanced-review` on the plan
        file (implementation tasks + test plan) AND the spec (`openspec/changes/<feature>/`).
        Target type = plan+spec.
     2. If 🔴 count == 0: exit LOOP.
     3. If iteration == 3: cap reached — warn the user that unresolved 🔴 findings
        remain, list them, and ask whether to proceed or stop. Exit LOOP.
     4. REVISE — update the plan file and/or spec to address 🔴 findings. 🟡 findings
        are addressed at your discretion. Log what changed and why in a short summary
        below the revision.
     5. GOTO LOOP.
   ```

   Review restrictions:
   - Do let a subagent (Opus) be reviewer. Provide detailed relevant context to the agent for reviewing the plan.
   - Do let the reviewer subagent to review the plan.
   - Every review round should review the full plan instead of focusing just the diff.

   Done when: a review round produces zero 🔴 findings, OR cap reached and user decides.

8. **Report.** Summarize ticket, spec path, plan path, task count. Ask whether to kick off implementation now or stop here — never auto-invoke it.

   To kick off implementation, invoke `/autonomous-development-plugin:autonomous-feature-development` with:
   - `plan_path` = the Step 5 plan file — its `### Task N:` headings become per-task worktree jobs.
   - `spec_path` = the Step 4 change's `design.md` (or `proposal.md`, whichever better captures acceptance criteria) — read for acceptance criteria during verification.

   It resolves lint/test/start commands from CLAUDE.md's `## Commands` section; an unresolved required command hard-stops the pipeline.
