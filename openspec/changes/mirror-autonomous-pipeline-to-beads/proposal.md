## Why

The `autonomous-feature-development` pipeline (an installed plugin skill) drives a ticket through parallel-worktree implementation, a capped verify↔review loop, and a final commit — but its only progress record is `.loop-logs/<id>/tasks/*.json`, a set of files invisible to `bd ready`/`bd status`/`bd show`. The ticket's own bd issue sits at a flat `open`/`in_progress` the whole time, so there's no way to tell — from beads alone — whether a ticket is mid-implementation, stuck in review-fix iteration 4 of 5, waiting on a human verification checklist, or finished and awaiting a human's sign-off. This change makes the ticket's bd issue structurally reflect that pipeline state, without touching the plugin itself.

## What Changes

- Add a project-local bd formula (`.beads/formulas/`) that, when poured against a ticket's existing bd issue, reparents that issue into an epic with children mirroring the pipeline's real stages: one `task-N` child per plan task (dynamic count via `on_complete.for_each`), a `verify_review_loop` child (a `LoopSpec` step capped at 5 iterations, itself dynamically spawning a `fix-<issue-id>` child per actionable review finding), and a `finalize` child.
- Add `bd config set status.custom "failed:wip,pending-human-review:wip"` — the only two status values not already covered by molecule structure (which child is `open`/`in_progress`/`closed` already signals "what stage").
- Add a new doc, `docs/beads/autonomous-pipeline-mirroring.md`, giving the orchestrator literal, stage-by-stage `bd`/`bd mol` commands to run as an additive side effect at each point it already writes `.loop-logs/<id>/tasks/*.json` — bd is a mirror, `.loop-logs/` stays authoritative.
- Wire a human-in-loop verification pause (`stage-verify.md`'s `awaiting_human` handoff) to a bd Gate (`type: human`) on the `verify_review_loop` child, closed by the human to unblock — replacing "invisible to bd" with a real blocking artifact.
- On any task or loop-iteration failure (TDD 3-attempt hard-stop, or 5-iteration review-loop cap exhaustion), set that child to `failed:wip` and post a one-line root-cause `bd comments add`.
- On Stage 4 finalize, set the epic's own status: `pending-human-review:wip` if every task child closed clean, `failed:wip` if any task or the loop hit `failed:wip`. The epic never auto-closes in either case — a human closes it after reviewing.
- Edit `.claude/skills/plan-implementation/SKILL.md` Step 6 to name the specific terminal status instead of its current vague "update the ticket's status."
- Add one pointer line to `CLAUDE.md`'s existing Beads section, linking to the new doc (same pattern as the existing `docs/beads/instruction.md` link) so it's in-context for the whole orchestrator run.
- **Explicitly out of scope**: Mode B (standalone review-fix with no plan/spec, invoked directly from received review issues) — deferred to a follow-up; it has no plan-task fan-out and no natural ticket to anchor an epic to.
- **Explicitly not done**: modifying the vendored `autonomous-development-plugin` (`~/.claude/plugins/cache/...`) — it is user-level, shared across projects, and outside this repo's git history. All wiring here is a repo-local addendum layered on top of it.

## Capabilities

### New Capabilities
- `beads-pipeline-mirroring`: bd formula + orchestrator-facing doc that mirrors the autonomous-feature-development pipeline's per-task/per-stage progress into a poured molecule on the ticket's bd issue, using two new custom statuses (`failed:wip`, `pending-human-review:wip`) and a human-type bd Gate for the human-in-loop verification pause.

### Modified Capabilities
(none — no existing `openspec/specs/` capability covers ticket/pipeline tracking today)

## Impact

- **New files**: `.beads/formulas/<formula-name>.formula.toml` (or `.json`), `docs/beads/autonomous-pipeline-mirroring.md`.
- **Edited files**: `CLAUDE.md` (Beads section, one pointer line), `.claude/skills/plan-implementation/SKILL.md` (Step 6).
- **bd config**: one repo-scoped `bd config set status.custom "failed:wip,pending-human-review:wip"` (persisted in the Dolt-backed config, version-control-friendly per bd's own docs).
- **No code changes** — this is documentation/config/formula only; the vendored plugin, the frontend, and the on-chain program are untouched.
- **Existing ticket issues** (`gtw-XXX`, currently flat `task`/`feature` type) become epics the first time this formula is poured against them — reparenting, not deletion/recreation, so existing `external_ref`/`labels` metadata survives.
