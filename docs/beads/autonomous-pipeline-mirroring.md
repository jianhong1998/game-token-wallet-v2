# Mirroring the autonomous-feature-development pipeline into bd

Written against `autonomous-development-plugin` `0.4.2` (vendored, user-level, at
`~/.claude/plugins/cache/autonomous-development/autonomous-development-plugin/0.4.2/`)
and `bd 1.2.1`. Both the plugin's stage file layout and bd's bond/reparent mechanics
are version-specific — if either is upgraded and the behaviors below stop matching,
this doc needs a pass, not the pipeline.

**bd is a mirror, not the pipeline's source of truth.** `.loop-logs/<id>/tasks/*.json`
and `.loop-logs/<id>/tasks/verification-state.json` remain authoritative for every
resume/integrity-gate decision the orchestrator makes — nothing here changes that. See
"Failure handling" at the bottom before wiring any of this in.

This doc applies to **Mode A** (plan/spec-driven runs anchored to an existing ticket bd
issue) only. Mode B (standalone review-fix with no plan/spec) is out of scope — see
`openspec/changes/mirror-autonomous-pipeline-to-beads/proposal.md`.

Formulas used below live in `.beads/formulas/`:
`autonomous-pipeline.formula.toml`, `autonomous-pipeline-task.formula.toml`,
`autonomous-pipeline-fix.formula.toml`.

## Stage 0/1 hook — skeleton + task fan-out

**When:** immediately after Stage 0 Step 0.5 first writes
`.loop-logs/<id>/tasks/<task-id>.json` files (tasks parsed, files initialized).

1. Bond the skeleton once, against the ticket's existing bd issue (`<ticket-id>`, e.g.
   `gtw-004`):

   ```bash
   bd mol bond autonomous-pipeline <ticket-id> --ref pipeline
   ```

   This nests `<ticket-id>.pipeline`, `<ticket-id>.pipeline.verify_review_loop`, and
   `<ticket-id>.pipeline.finalize` under the ticket, leaving the ticket's own
   `external_ref`/`labels`/`issue_type` untouched.

2. For each parsed task (one bond per task, count = number of `### Task N: <name>`
   headings found in Stage 0 Step 0.4 — not fixed by the formula):

   ```bash
   bd mol bond autonomous-pipeline-task <ticket-id>.pipeline --ref task-N --var task_name="<name from the heading>"
   ```

   `N` matches the plan's task numbering (`task-1`, `task-2`, ...), not the derived
   `task-<N>-<kebab-case-name>` id used in `.loop-logs/` — keep the bd ref short.

3. Mirror each `task-N` child's status as the corresponding
   `.loop-logs/<id>/tasks/<task-id>.json` `status` field transitions, per the task state
   lifecycle in `stage-impl.md`'s Orchestrator/Agent Output Schema section:

   | `.loop-logs/` `status` | When (per `stage-impl.md`)                          | bd command |
   | ----------------------- | ----------------------------------------------------- | ---------- |
   | `pending`                | Step 0.5 initializes the task file                     | (already `open` from the bond — no call needed) |
   | `in_progress`             | orchestrator writes it before spawning the worktree agent (Step 1) | `bd update <ticket-id>.pipeline.task-N --status in_progress` |
   | `completed`               | agent's TDD loop reaches `Outcome: success` (Agent Step D, "On pass") | `bd update <ticket-id>.pipeline.task-N --status closed` |
   | `failed`                  | agent's TDD loop reaches `Outcome: failed` after 3 attempts (Agent Step D, "Hard Stop") | `bd update <ticket-id>.pipeline.task-N --status failed` then `bd comments add <ticket-id>.pipeline.task-N "<one-line root cause>"` |

   The failure comment's content is the same one-line root cause already written to
   `ERROR_LOG_PATH`'s `# Failed: <task-id>` header — not the full attempt/lint/test
   dump, which stays in `.loop-logs/` only.

## Stage 2/3 hook — review-round fix fan-out, loop close/fail, human gate

**When:** during the capped verify↔review loop (`stage-review-fix.md` Loop Control).
The orchestrator, not bd, counts `iteration` and enforces the 5-iteration cap —
`LoopSpec.max` is not used in the skeleton formula for exactly this reason (see
design.md Decision 1). Count from the same `iteration` variable the orchestrator
already tracks for Loop Control.

1. **Each review round that finds actionable issues** (`stage-review-fix.md` Part 1,
   "Disposition" > 0 actionable rows): bond one `fix-<issue-id>` child per actionable
   finding under `verify_review_loop`, before Part 2's fix pipeline starts:

   ```bash
   bd mol bond autonomous-pipeline-fix <ticket-id>.pipeline.verify_review_loop --ref iter-N-fix-M --var finding_summary="<one-line finding summary>"
   ```

   `N` = current loop iteration, `M` = the finding's index within that round's
   Findings table. One bond call per finding — bd does not fan these out.

2. **Loop exits cleanly** (`stage-review-fix.md` Loop Control step 3, actionable
   count == 0):

   ```bash
   bd update <ticket-id>.pipeline.verify_review_loop --status closed
   ```

3. **Loop cap exhausted** (`stage-review-fix.md` Loop Control step 4, iteration == 5
   with actionable issues still open — `.loop-logs/<id>/error/review-loop-exhausted.md`
   written):

   ```bash
   bd update <ticket-id>.pipeline.verify_review_loop --status failed
   bd comments add <ticket-id>.pipeline.verify_review_loop "<one-line cap-exhaustion summary, matching review-loop-exhausted.md>"
   ```

4. **Human-in-loop verification pause** (`stage-verify.md` "Human verification
   handoff": `interaction_mode == human-in-loop`, verifier `outcome == pass` with
   non-empty `blocked`, right after `verification-state.json` is written with
   `last_outcome: "awaiting_human"`):

   ```bash
   bd gate create --type=human --blocks <ticket-id>.pipeline.verify_review_loop --reason "<checklist summary — e.g. path to verification-<round>.md and the pending items>"
   ```

   This is an ad-hoc top-level command, **not** a formula-declared `gate` field — the
   skeleton formula carries no `gate` field so `verify_review_loop` can still reach
   `closed` on fully-autonomous runs that never hit this handoff. It does not replace
   the checklist file (`.loop-logs/<id>/verifications/verification-<round>.md`); it
   makes the same pause bd-visible and blocking (`bd blocked`).

   When the human replies `continue` and `stage-verify.md`'s "Resume after human
   verification" step 4 (all `PASS`) proceeds to REVIEW:

   ```bash
   bd gate resolve <gate-id>
   ```

   (`<gate-id>` is the id `bd gate create` returned above — capture it when the gate is
   created.) If the resume instead finds a `FAIL` (step 3) and re-enters "Fix on
   failure", leave the gate open; it only resolves once the checklist is fully `PASS`.

## Stage 4 hook — epic terminal status

**When:** `stage-final.md` Step 4.3, at its terminal action — the `git commit` in
`autonomous` mode, or the `git reset --mixed <base_sha>` unstaged-handoff print in
`human-in-loop` mode. Both count as "Stage 4 is done" regardless of `interaction_mode`.

```bash
bd update <ticket-id> --status pending-human-review   # every task-N closed clean AND verify_review_loop closed clean
bd update <ticket-id> --status failed                 # any task-N or verify_review_loop hit failed
```

The epic (`<ticket-id>` itself) is **never** closed by either branch — closing is
always a manual human action, in both outcomes.

## Failure handling (read before wiring in)

Every command above is an additive side effect layered onto a point the orchestrator
already writes to `.loop-logs/`. If a `bd`/`bd mol`/`bd gate`/`bd comments` call in this
doc fails or `bd` is unavailable:

- Log the failure (one line is enough) and continue the pipeline — do **not** retry-loop
  it, and do **not** let it block, skip, or alter the orchestrator's own `.loop-logs/`
  write for that same transition.
- If a bond call fails mid-fan-out (e.g. one of several `task-N`/`fix-<issue-id>` bonds
  in a batch), log which ref failed and continue bonding the rest — a partial bd mirror
  is a visibility gap, not a pipeline-blocking error.

No command in this doc reads from bd to make a pipeline decision. `stage-impl.md`'s
Stage 1 Integrity Gate and every resume path keep reading `.loop-logs/<id>/tasks/*.json`
directly, unchanged by this doc.
