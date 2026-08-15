## Context

The `autonomous-feature-development` plugin skill (installed at `~/.claude/plugins/cache/autonomous-development/autonomous-development-plugin/0.4.2/`, user-level — shared across every project, not part of this repo's git history) runs a 4-stage pipeline once a ticket has an approved plan/spec (`plan-implementation` Step 5 hands off to it):

```
Stage 0+1 (stage-impl.md)       Stage 2+3 (stage-verify.md ↔ stage-review-fix.md)     Stage 4 (stage-final.md)
guard/setup, parse plan          capped verify↔review loop, ≤5 iterations:              lint/format, summary,
"### Task N:" headings,          VERIFY → REVIEW → (fix actionable issues) → re-VERIFY   final commit (or, in
spawn one parallel worktree      exits when a review round finds zero actionable         human-in-loop mode,
agent per task, squash-merge     issues, or the cap is hit                               reset --mixed to
                                                                                          unstaged for the human)
```

Its only progress record today is `.loop-logs/<id>/tasks/*.json` (per-task `pending`/`in_progress`/`completed`/`failed`) plus `.loop-logs/<id>/tasks/verification-state.json` — both outside bd entirely. The ticket's bd issue (already created — `bd list --json` shows existing tickets as flat `task`/`feature` type issues, e.g. `gtw-004`, cross-referenced via `external_ref`/`labels: ["ticket-NNN"]`) never moves off `open`/`in_progress` regardless of how far the pipeline has gotten.

bd (v1.2.1, installed via Homebrew) has two mechanisms that could carry this signal:
- **`status.custom`** (`bd config set status.custom "name:category,..."`, categories `active|wip|done|frozen`) — a flat relabeling of one issue's `status` field. No enforced order, no loop/iteration semantics.
- **`bd formula`/`bd mol`** (protos → poured molecules: real child issues from a template, `bd formula schema` exposes `Step`, `LoopSpec` (`until`/`max`), `Gate` (`type: human|gh:run|gh:pr|timer|mail`), and `OnCompleteSpec` (`for_each: output.<field>` + `bond`, for runtime dynamic fan-out) as first-class primitives) — a real child-issue DAG per pipeline run.

This decision record (from an in-session `grill-me` walkthrough) chose the molecule route specifically because Stage 2/3's "capped loop, exits on a condition, dynamic fan-out per review round" shape has no honest equivalent as a flat status string, and `LoopSpec`/`OnCompleteSpec` exist for exactly that shape.

## Goals / Non-Goals

**Goals:**
- A ticket's bd issue structurally shows pipeline progress (which child is open/in_progress/closed) without any new per-stage status vocabulary.
- Failures (TDD hard-stop, review-loop cap exhaustion) are visible in bd with a one-line root cause, not just buried in `.loop-logs/`.
- A human-in-loop verification pause is a real bd-visible blocker (Gate), not a silent file-based handoff only discoverable by reading `.loop-logs/`.
- All of this layers on top of the vendored plugin without editing it.

**Non-Goals:**
- Mode B (standalone review-fix, invoked directly from a received code review with no plan/spec) — different shape (no task fan-out, no natural ticket anchor, ends via `superpowers:finishing-a-development-branch` instead of `stage-final.md`). Deferred to a follow-up change.
- Making bd the source of truth for the orchestrator's own resume/integrity-gate logic. `.loop-logs/<id>/tasks/*.json` remains authoritative — `stage-impl.md`'s Stage 1 Integrity Gate reads those JSON files directly and this change does not touch that.
- Auto-closing the ticket epic. Closing is always a manual human action, in both the clean-run and failure cases.
- Modifying the vendored plugin's `stage-*.md` files or any other file under `~/.claude/plugins/cache/...`.

## Decisions

### 1. Molecule (bd formula), not a flat status enum
`status.custom` was the cheaper option but can't express "iteration 3 of a capped loop that exits on a condition" or "N dynamically-discovered fix issues this round" as structure — those needed real child issues, which only a formula's steps can create. The final status vocabulary shrank to just two values (`failed:wip`, `pending-human-review:wip`) precisely because the molecule's structure — which child is `open`/`in_progress`/`closed` — already carries "what stage" for free.

**Correction from spike validation (tasks.md §1):** `LoopSpec.until`/`.max` and `OnCompleteSpec.for_each` are declarative labels only — bd (v1.2.1) does not evaluate them or drive re-iteration/fan-out at runtime. Setting `metadata.output.items` on a step and closing it with `bd close --continue` produces zero automatic children; closing a `LoopSpec` body step whose `until` condition is unmet does not spawn a second iteration. bd surfaces the config as a `loop:{...}` label for humans to read, nothing more.

The mechanism that actually creates dynamic children is a **manually-issued `bd mol bond <child-formula> <spawner-step-id> --ref <name> [--var k=v]`**, one call per item/iteration — confirmed: this produces a real dotted-ID child (e.g. `<spawner>.task-1`), correctly nested and visible in `bd children`/`bd mol show`. Consequences for this design:
- The pipeline formula cannot be a single formula with `on_complete`/`LoopSpec` fan-out baked in — it splits into a fixed skeleton plus small reusable per-item formulas (see Decision 2, tasks.md §3).
- The orchestrator, not bd, is responsible for: computing the task count and issuing one `bond` per task, issuing one `bond` per actionable review finding per round, and counting/capping the verify↔review loop at 5 iterations itself from `.loop-logs/` (already the plan per Decision 3). `LoopSpec.max` in the formula is not an enforcement mechanism — it's informational only.

### 2. Reparent via `bd mol bond <formula> <ticket> --ref <name>` (not `pour --parent`, not bond without `--ref`)
The ticket's bd issue (e.g. `gtw-004`) already carries the durable identity (`external_ref`, `labels: ["ticket-NNN"]`, any manual priority/assignee history) and must keep it untouched.

**Correction from spike validation:** there is no `--parent` flag on `bd mol pour` — `pour` always creates its own new, unattached root issue and cannot target an existing issue. `bd mol bond <formula> <existing-issue>` *without* `--ref` also does not reparent: it creates a brand-new top-level molecule root and links it to the existing issue via a plain `blocks` **dependency edge** — the existing issue stays flat, which is the exact problem this change exists to solve.

The mechanism that works: **`bd mol bond <formula> <ticket-id> --ref pipeline`**. Confirmed: this nests the whole formula under the ticket's ID namespace (`<ticket>.pipeline`, `<ticket>.pipeline.verify_review_loop`, `<ticket>.pipeline.finalize`), renders as a real tree under the ticket via `bd children <ticket>` / `bd mol show <ticket>`, and leaves the ticket's `external_ref`/`labels`/`issue_type` completely unmodified. The underlying edge bd records is `dependency_type: blocks` plus the dotted-ID convention — not a literal `parent`/`--parent` field — but bd's own tree-rendering and blocked-listing commands treat it exactly like a parent-child relationship, so it satisfies the actual goal (ticket visibly gains structured children) even though the mechanism differs from what was originally assumed.

One structural consequence to flag: the formula itself becomes an intermediate node — `<ticket>.pipeline` is a real molecule issue — so `verify_review_loop`/`finalize` end up as *grandchildren* of the ticket, one level deeper than spec.md's current wording ("attaching ... with `--parent <ticket-issue-id>`") implies. **spec.md needs a follow-up wording pass to match this — out of scope for this design.md/tasks.md revision.**

Per-item children (`task-N` per plan task, `fix-<issue-id>` per review finding) are added the same way individually — see corrected Decision 1 and tasks.md §3. Concretely: `bd mol bond <task-formula> <ticket>.pipeline --ref task-N --var task_name=...` once per plan task, and `bd mol bond <fix-formula> <ticket>.pipeline.verify_review_loop --ref iter-N-fix-M --var ...` once per actionable finding.

Rejected alternatives: `bd mol pour` (cannot target an existing issue at all); `bd mol bond` without `--ref` (creates a disconnected top-level molecule linked only by a `blocks` dependency, not a nested structure); a separate `--label ticket-004`-linked epic (keeps the existing issue inert and flat, which was the exact problem being solved).

### 3. `bd` calls are additive side effects, not a replacement for `.loop-logs/`
Every `bd`/`bd mol` command in `docs/beads/autonomous-pipeline-mirroring.md` fires at a point the orchestrator already writes to `.loop-logs/<id>/tasks/*.json` (task state transitions in `stage-impl.md`, `verification-state.json` writes in `stage-verify.md`, the summary in `stage-final.md`). This is a direct consequence of Non-Goal #2: since the vendored plugin's Integrity Gate and resume logic are untouched and keep reading the JSON files, bd cannot become authoritative without also rewriting those gates — out of scope here.

### 4. Failure status: `failed:wip`, not `failed:done`
A hard-stopped task or an exhausted review loop still needs a human (or a re-run) to act on it — it is not in the same "nothing left to do" bucket as a normal `closed` issue. `wip` keeps it showing up in active-work views (`bd status`, `bd ready`-adjacent triage) rather than being lumped in with genuinely finished work. (This reverses an earlier draft of this decision that used `failed:done`; changed after review — `wip` is the closer semantic fit.)

### 5. Human-in-loop verification pause → bd Gate (`type: human`), not a status label
`stage-verify.md`'s `awaiting_human` handoff already writes a checklist file and waits for a human reply of `continue`. A `type: human` Gate on the `verify_review_loop` step produces a real blocking bd artifact — visible in `bd blocked`, closed explicitly by the human — instead of a string nobody is forced to act on. The checklist file itself is unchanged; the Gate is a bd-visible pointer to the same handoff, not a replacement for it.

**Correction from spike validation:** the Gate must be created **on demand, at the moment the handoff actually occurs** — not baked into the `autonomous-pipeline` skeleton formula (§3.1) as a declarative `gate` field on the `verify_review_loop` step. A formula-declared gate is created unconditionally the moment the skeleton is bonded, which would block `verify_review_loop` from ever reaching `closed` even on fully-autonomous runs that never hit the human handoff — contradicting the "closes when a review round finds zero actionable issues" requirement. The fix, confirmed working: the ad-hoc top-level command `bd gate create --type=human --blocks <ticket>.pipeline.verify_review_loop --reason "<checklist summary>"`, run only when `stage-verify.md` actually reaches `interaction_mode == human-in-loop` with a non-empty `blocked` list. `bd blocked` lists the gated step correctly; `bd gate resolve <gate-id>` unblocks it. The skeleton formula (§3.1) carries no `gate` field at all.

### 6. Epic terminal status set at Stage 4, never auto-closed
On reaching `stage-final.md`'s terminal step (the commit in `autonomous` mode, or the unstaged-handoff print in `human-in-loop` mode — both are "Stage 4 is done" regardless of `interaction_mode`), the orchestrator sets the epic to `pending-human-review:wip` if every `task-N` child closed clean and the loop never hit `failed:wip`, or `failed:wip` if any of them did. The epic is deliberately never auto-closed in either branch — this repo's own "Done Means" bar (CLAUDE.md) requires observed, human-verified behavior before something counts as done, and a pipeline run finishing green is not the same claim.

### 7. Comment on failure: root cause only, via `bd comments add`
`bd comments add <task-id> "<root cause>"` (not `--notes`/`--append-notes`) because a task/loop can in principle be retried across pipeline runs, and comments preserve each attempt's failure as a separate timestamped entry instead of overwriting or run-on-appending a single notes field. Content is the same one-line root cause already written to `ERROR_LOG_PATH`'s `# Failed: <task-id>` header — the full attempt/lint/test dump stays in `.loop-logs/` only, so the bd comment stays scannable.

### 8. Placement: new doc + one CLAUDE.md pointer + a plan-implementation edit, plugin untouched
The orchestrator is Claude Code itself running inside this repo, so `CLAUDE.md` is in-context for the entire pipeline run regardless of which skill file is currently "loaded" — unlike `plan-implementation`'s own SKILL.md, which stops being in control the moment it hands off to the vendored plugin. The actual per-stage command reference is too long for CLAUDE.md itself, so it lives in `docs/beads/autonomous-pipeline-mirroring.md` (mirroring the existing `docs/beads/instruction.md` pointer pattern), with `CLAUDE.md`'s Beads section gaining one link line. `plan-implementation` Step 6 ("update the ticket's status") gets edited to name `pending-human-review`/`failed` explicitly since that step already runs post-pipeline.

## Risks / Trade-offs

- **[Drift]** Two systems (`.loop-logs/` JSON and bd) tracking overlapping state → a missed/failed `bd` call leaves bd stale while `.loop-logs/` is correct. Mitigation: bd calls are simple, narrow, and colocated with existing JSON writes in the new doc's instructions; `.loop-logs/` remains the tiebreaker source of truth by design (Decision 3), so a stale bd mirror is a visibility bug, not a correctness bug.
- **[Formula authoring risk]** RESOLVED by the section-1 spike (bd 1.2.1, embedded/local mode). `on_complete.for_each`, `LoopSpec.until`/`.max`, and pour-based reparenting all behave differently than the formula schema's docstrings imply — none of them self-drive at runtime; only `Gate` (`type: human`) behaves exactly as documented (real blocking issue, `bd blocked`-visible, unblocked via `bd gate resolve`). Corrected mechanics and their consequences for formula structure are folded into Decisions 1 and 2 above.
- **[Scope creep across sessions]** The mirroring doc must stay purely additive — a future edit that starts treating bd as authoritative (e.g. driving the Integrity Gate from bd instead of JSON) would silently violate Non-Goal #2. Mitigation: Decision 3 and Non-Goal #2 are stated explicitly so a future change has to consciously revisit them, not drift into it.
- **[Plugin version drift]** If the vendored plugin is upgraded past `0.4.2` and its stage file names/structure change, `docs/beads/autonomous-pipeline-mirroring.md`'s stage-boundary references could go stale. Mitigation: the doc should name the stage *behaviors* it hooks (e.g. "after a task's TDD loop reaches Outcome: success/failed") rather than line numbers, and note the plugin version it was written against.

## Migration Plan

No data migration — this is new tracking for future pipeline runs. Existing in-flight runs (e.g. the currently in-progress `quit-game` openspec change) are not retroactively backfilled; the mirroring doc only applies to pipeline runs started after this change ships. Rollback is trivial: delete the formula file and the `status.custom` config value, revert the doc/CLAUDE.md/plan-implementation edits — no bd data becomes invalid, since molecules are just regular issues.

## Open Questions

- Exact formula authoring format (TOML vs JSON) and file name — resolved during `tasks.md`/implementation against `bd formula schema`'s primitives and `examples/formulas/primitives/` if bundled with a future bd version.
- Whether `bd mol progress`/`bd mol current` output is legible enough as-is for a quick "where's this ticket at" check, or whether a short `bd`-wrapping alias/doc snippet is worth adding — deferred until the formula exists and can be tried against a real ticket.
