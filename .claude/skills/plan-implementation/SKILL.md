---
name: plan-implementation
description: Runs the ticket planning pipeline end-to-end from a ticket file to an approved implementation plan.
disable-model-invocation: true
---

Explore → clarify → spec → plan, one ticket at a time. openspec owns the spec-of-record; superpowers owns the TDD implementation plan. Don't skip a step or hand-write output a prior step already produced. Stops before implementation — the user green-lights that separately.

**Input:** `/plan-implementation <path-to-ticket-file>` (e.g. `docs/tickets/022-foo.md`), or a bare ticket number resolved against `docs/tickets/000-index.md`. Ask for one if neither is given.

**Resuming:** if `openspec/changes/<feature>/` or a `docs/superpowers/plans/*-<feature>.md` already exists for this ticket, ask whether to resume from there instead of regenerating it.

## Steps

1. **Explore.** Read the ticket file fully, any `openspec/specs/<capability>/spec.md` covering the same capability, and the code paths / blocked-by tickets it names. No skill invocation, no artifact — just enough to ask informed questions next.

   Done when: you can state the ticket's scope and every open question in one line.

2. **Clarify.** Invoke the `grill-me` skill — mandatory every ticket, even ones that look clear-cut. No separate decision-log file for ticket-level sessions; the resolved answers feed straight into Step 3's `proposal.md`/`design.md`, where the rationale gets recorded.

   Done when: every undecided detail — in the ticket, or surfaced while exploring — has an explicit answer.

3. **Spec.** Invoke `openspec-propose` for the feature (kebab-case name derived from the ticket title). Produces `openspec/changes/<feature>/`: `proposal.md`, `design.md`, `specs/<capability>/spec.md` delta specs, `tasks.md`. This is the spec-of-record for planned work — `openspec/specs/<capability>/spec.md` itself reflects only shipped behavior and is never hand-edited here.

   Gate: show the user the proposal/design and get explicit approval — AskUserQuestion or a direct confirmation, never inferred from silence or from the files simply existing — before Step 4.

4. **Plan.** Invoke `superpowers:writing-plans` against the approved change's `proposal.md`/`design.md`/`specs/*.md`. Produces `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, tasks headed `### Task N: <name>` — exact format, the implementation pipeline parses it. (Distinct from `openspec-propose`'s own `tasks.md`, which uses a coarser `## N. Group` / `- [ ] N.M item` checklist for openspec's internal tracking — not what the implementation pipeline reads.)

   Wire the header, right after the `> **For agentic workers:**` blockquote:
   - `**Ticket:**` → relative link to `docs/tickets/<NNN>-<feature>.md`
   - `**Spec:**` → relative link to `openspec/changes/<feature>/`

   Then edit the ticket file to add a reciprocal `**Plan:**` line beside its `**Spec:**` line, pointing at the new plan file (update the ticket's `**Spec:**` line too if it still points at a pre-openspec doc).

   Done when: ticket and plan link to each other in both directions.

5. **Report.** Summarize ticket, spec path, plan path, task count. Ask whether to kick off implementation now or stop here — never auto-invoke it.

   To kick off implementation, invoke `/autonomous-development-plugin:autonomous-feature-development` with:
   - `plan_path` = the Step 4 plan file — its `### Task N:` headings become per-task worktree jobs.
   - `spec_path` = the Step 3 change's `design.md` (or `proposal.md`, whichever better captures acceptance criteria) — read for acceptance criteria during verification.

   It resolves lint/test/start commands from CLAUDE.md's `## Commands` section; an unresolved required command hard-stops the pipeline.

6. **After implementation finishes** (all tasks implemented, verified, reviewed, committed):
   - Check off `openspec/changes/<feature>/tasks.md` to match what was actually done.
   - Run `openspec-sync-specs` (mid-flight) or `openspec-archive-change` (once the ticket is fully closed) to fold the change's delta specs into `openspec/specs/<capability>/spec.md`.
   - Set the ticket's bd issue status to `pending-human-review` (clean run) or `failed` (any task or the review loop failed) — see [Autonomous pipeline mirroring](../../../docs/beads/autonomous-pipeline-mirroring.md) — and update `docs/tickets/000-index.md`.
