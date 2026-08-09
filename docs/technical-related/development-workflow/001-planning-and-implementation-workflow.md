# Planning & Implementation Workflow

New feature/ticket work follows a four-step planning workflow: explore, clarify, spec, plan. openspec owns the spec-of-record, superpowers owns the TDD implementation plan. Don't skip a step or hand-write one from scratch when the prior step's output already exists.

1. **Explore** — read the originating `docs/tickets/<NNN>-<feature>.md`, any related `openspec/specs/<capability>/spec.md`, and the code paths the ticket touches. No skill invocation, no artifact — just enough context to ask informed questions in the next step.
2. **Clarify** — `/grill-me`. Mandatory for every ticket, even ones that look clear-cut. Interview until every genuinely undecided detail is resolved. No separate decision-log doc — the resolved answers feed straight into step 3's `proposal.md`/`design.md`, which is where the rationale gets recorded. (Meta/workflow-level grill-me sessions, i.e. about this pipeline itself rather than a ticket, are the exception — those get their own `NNN-*-decisions.md`, e.g. [002-workflow-decisions.md](002-workflow-decisions.md).)
3. **Spec** — `openspec-propose`. Produces `openspec/changes/<feature>/` (`proposal.md`, `design.md`, `specs/<capability>/spec.md` delta specs, `tasks.md`). This is the project's spec-of-record layer for planned work. `openspec/specs/<capability>/spec.md` reflects only _shipped_ behavior and is updated by archiving/syncing a change after it's implemented (`openspec-archive-change`/`openspec-sync-specs`) — never hand-edited for work still in flight. Requires explicit user approval before moving on. (Historical note: earlier tickets, e.g. 005/006, also have a `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` doc from when `superpowers:brainstorming` still owned this layer — that step is retired; openspec is the sole spec-of-record going forward.)
4. **Plan** — `superpowers:writing-plans`. Turns the approved openspec change (its `proposal.md`/`design.md`/`specs/*.md`) into a file-by-file, TDD-structured implementation plan at `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, with tasks headed `### Task N: <name>` — this exact heading format is what the implementation pipeline (below) parses; don't restructure it. The plan's header MUST link both directions: a `**Ticket:**` line pointing to the originating `docs/tickets/<NNN>-<feature>.md` and a `**Spec:**` line pointing to `openspec/changes/<feature>/` (relative Markdown links, placed right after the `> **For agentic workers:**` blockquote) — and the ticket file gets a reciprocal `**Plan:**` line added back to the plan, alongside its existing `**Spec:**` line. Keeps the ticket ↔ spec ↔ plan chain navigable in both directions instead of the ticket going stale once a plan exists.

`openspec-propose`'s `tasks.md` uses a different, coarser checklist format (`## N. Group` / `- [ ] N.M item`) than step 4's plan — it's a condensed mirror for openspec's own tracking, not a substitute for the `docs/superpowers/plans/` file, and not what the implementation pipeline reads.

## Implementation: `/autonomous-development-plugin:autonomous-feature-development`

Once the plan is approved, invoke this skill with:

- `plan_path` = the `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` file from step 4 — its `### Task N:` headings are parsed into per-task worktree jobs.
- `spec_path` = the `openspec/changes/<feature>/design.md` (or `proposal.md`, whichever better captures acceptance criteria) file from step 3 — read for acceptance criteria during the verify stage.

It resolves lint/test/start commands from the `## Commands` section in [CLAUDE.md](../../../CLAUDE.md) — keep that section accurate as tooling changes, since an unresolved required command hard-stops the pipeline.

After the pipeline finishes (all tasks implemented, verified, reviewed, committed):

- Update `openspec/changes/<feature>/tasks.md` checkboxes to match what was actually done.
- Run `openspec-sync-specs` (mid-flight) or `openspec-archive-change` (once the ticket is fully closed out) to fold the change's delta specs into `openspec/specs/<capability>/spec.md`, keeping it an accurate record of shipped behavior.
- Update related ticket about the progress in @docs/tickets/ and the ticket index in @docs/tickets/000-index.md .
