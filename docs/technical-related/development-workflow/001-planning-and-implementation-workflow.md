# Planning & Implementation Workflow

New feature/ticket work follows a three-layer planning pipeline, each layer feeding the next. Don't skip a layer or hand-write one from scratch when the prior layer's output already exists.

1. **Design** — `superpowers:brainstorming`. Clarifies requirements via one-at-a-time questions (use `/grill-me` for an adversarial Q&A pass on anything genuinely undecided). Produces a design doc at `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`. Requires explicit user approval before moving on.
2. **Plan** — `superpowers:writing-plans`. Turns the approved design into a file-by-file, TDD-structured implementation plan at `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, with tasks headed `### Task N: <name>` — this exact heading format is what the implementation pipeline (below) parses; don't restructure it.
3. **Track** — `openspec-propose`. Mirrors the design + plan into `openspec/changes/<feature>/` (`proposal.md`, `design.md`, `specs/<capability>/spec.md` delta specs, `tasks.md`) for structured, greppable tracking. This is the project's spec-of-record layer: `openspec/specs/<capability>/spec.md` reflects only *shipped* behavior and is updated by archiving/syncing a change after it's implemented — never hand-edited for work still in flight.

`openspec-propose`'s `tasks.md` uses a different, coarser checklist format (`## N. Group` / `- [ ] N.M item`) than step 2's plan — it's a condensed mirror for openspec's own tracking, not a substitute for the `docs/superpowers/plans/` file, and not what the implementation pipeline reads.

## Implementation: `/autonomous-development-plugin:autonomous-feature-development`

Once the plan is approved, invoke this skill with:
- `plan_path` = the `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` file from step 2 — its `### Task N:` headings are parsed into per-task worktree jobs.
- `spec_path` = the `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` file from step 1 — read for acceptance criteria during the verify stage.

It resolves lint/test/start commands from the `## Commands` section in [CLAUDE.md](../../../CLAUDE.md) — keep that section accurate as tooling changes, since an unresolved required command hard-stops the pipeline.

After the pipeline finishes (all tasks implemented, verified, reviewed, committed):
- Update `openspec/changes/<feature>/tasks.md` checkboxes to match what was actually done.
- Run `openspec-sync-specs` (mid-flight) or `openspec-archive-change` (once the ticket is fully closed out) to fold the change's delta specs into `openspec/specs/<capability>/spec.md`, keeping it an accurate record of shipped behavior.
