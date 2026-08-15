## ADDED Requirements

### Requirement: Custom status configuration
The project SHALL configure exactly two bd custom status values, `failed:wip` and `pending-human-review:wip`, via `bd config set status.custom`. No per-pipeline-stage status labels (e.g. `implementing`, `verifying`, `reviewing`) SHALL be added — stage visibility SHALL come from molecule structure instead.

#### Scenario: Custom statuses are queryable
- **WHEN** `bd statuses` is run in this repo
- **THEN** the output lists `failed` (category `wip`) and `pending-human-review` (category `wip`) alongside the built-in statuses

### Requirement: Ticket epic structure via bond
Bonding the `autonomous-pipeline` skeleton formula against a ticket's existing bd issue (`bd mol bond autonomous-pipeline <ticket-issue-id> --ref pipeline`) SHALL nest the formula's generated structure under that issue's ID namespace, with `verify_review_loop` and `finalize` reachable from it as descendants via `bd children`/`bd mol show`. The ticket issue itself SHALL NOT be deleted, recreated, or have its `external_ref`/`labels`/`issue_type` metadata altered by the bond. `task-N` children (one per plan task) and `fix-<issue-id>` children (one per actionable review finding) SHALL be attached the same way, individually, via `bd mol bond <child-formula> <spawner-id> --ref <name>` against the appropriate spawner node (`<ticket>.pipeline` for `task-N`, `<ticket>.pipeline.verify_review_loop` for `fix-<issue-id>`).

#### Scenario: Bonding against an existing flat ticket issue
- **WHEN** the skeleton formula is bonded with the target set to an existing ticket issue (e.g. `gtw-004`, currently `issue_type: task`, `labels: ["ticket-004"]`), followed by individual `task-N` bonds
- **THEN** `bd children gtw-004` shows `gtw-004.pipeline` with `gtw-004.pipeline.verify_review_loop`, `gtw-004.pipeline.finalize`, and one `gtw-004.pipeline.task-N` per plan task nested beneath it, and `gtw-004`'s own `external_ref`, `labels`, and `issue_type` are unchanged

### Requirement: Per-task child fan-out and lifecycle mirroring
The orchestrator SHALL bond one `task-N` child issue (via `bd mol bond autonomous-pipeline-task <ticket>.pipeline --ref task-N`) per `### Task N: <name>` heading parsed from the plan file, with the count driven by the number of parsed headings, not fixed by the formula — bd does not fan these out automatically. Each `task-N` child's bd status SHALL mirror the corresponding `.loop-logs/<id>/tasks/<task-id>.json` `status` field transitions: `pending` → bd `open`; `in_progress` → bd `in_progress`; `completed` → bd `closed`; `failed` → bd `failed:wip`.

#### Scenario: Plan with a variable number of tasks
- **WHEN** a plan file contains 5 `### Task N:` headings
- **THEN** the orchestrator issues 5 individual `bd mol bond autonomous-pipeline-task` calls, and `bd children <ticket>.pipeline` shows exactly 5 `task-N` children in addition to `verify_review_loop` and `finalize`

#### Scenario: Task reaches TDD hard-stop after 3 attempts
- **WHEN** a worktree agent's task JSON reaches `"status": "failed"` after exhausting 3 TDD attempts
- **THEN** the corresponding `task-N` bd child is set to `failed:wip` and a `bd comments add` entry is posted on it containing only the one-line root cause from the task's `ERROR_LOG_PATH` `# Failed: <task-id>` header

### Requirement: Verify/review loop child with orchestrator-capped iteration and per-round fix children
The molecule SHALL include a `verify_review_loop` child (a plain step, not a bd `LoopSpec` — bd does not enforce `until`/`max` at runtime) modeling `stage-review-fix.md`'s capped verify↔review loop: it SHALL remain `open`/`in_progress` while iterating, close when a review round finds zero actionable issues, and SHALL be set to `failed:wip` (with a root-cause `bd comments add` entry) if the 5-iteration cap is reached with actionable issues still open. The orchestrator, not bd, SHALL count iterations and enforce the cap. Each loop iteration's actionable review findings SHALL be mirrored as individually-bonded `fix-<issue-id>` children under `verify_review_loop` (`bd mol bond autonomous-pipeline-fix <ticket>.pipeline.verify_review_loop --ref iter-N-fix-M`), one bond call per finding, with the count driven by the finding count per iteration, not fixed by the formula.

#### Scenario: Loop exits cleanly
- **WHEN** a review round reports zero actionable (blocking + important) findings
- **THEN** `verify_review_loop` is set to `closed` and no further `fix-<issue-id>` children are bonded

#### Scenario: Loop exhausts its cap
- **WHEN** the orchestrator's own iteration count reaches 5 and actionable findings remain
- **THEN** `verify_review_loop` is set to `failed:wip` with a `bd comments add` entry summarizing the cap exhaustion, matching `.loop-logs/<id>/error/review-loop-exhausted.md`

#### Scenario: A review round finds actionable issues
- **WHEN** a review round returns 3 actionable findings
- **THEN** the orchestrator issues 3 individual `bd mol bond autonomous-pipeline-fix` calls, creating 3 `fix-<issue-id>` children under `verify_review_loop` for that iteration

### Requirement: Human-in-loop verification pause as a bd Gate
When `stage-verify.md` reaches its human verification handoff (`interaction_mode == human-in-loop`, verifier `outcome == pass` with non-empty `blocked`), the pipeline SHALL create a `type: human` bd Gate on the `verify_review_loop` step via the ad-hoc `bd gate create --type=human --blocks <ticket>.pipeline.verify_review_loop` command — not a formula-declared `gate` field on the skeleton formula, which would create the gate unconditionally at bond time and block clean autonomous runs that never reach this handoff. The gate SHALL remain open (blocking) until a human closes it (`bd gate resolve`), mirroring the existing checklist-file handoff — it SHALL NOT replace the checklist file, only make the pause visible/blocking in bd.

#### Scenario: Verification pauses for human input
- **WHEN** the verifier reports `outcome: pass` with a non-empty `blocked` list under `interaction_mode == human-in-loop`
- **THEN** `bd gate create --type=human --blocks <ticket>.pipeline.verify_review_loop` is run, and `bd blocked` lists `verify_review_loop` as an open blocker until a human runs `bd gate resolve` on the gate issue

### Requirement: Epic terminal status on finalize, never auto-closed
When `stage-final.md` reaches its terminal step (a commit in `autonomous` mode, or the unstaged-handoff print in `human-in-loop` mode), the pipeline SHALL set the ticket epic's own bd status: `pending-human-review:wip` if every `task-N` child closed clean and `verify_review_loop` closed clean (neither hit `failed:wip`); otherwise `failed:wip`. The pipeline SHALL NOT close the epic under any outcome — closing SHALL remain a manual human action.

#### Scenario: Clean run reaches finalize
- **WHEN** all `task-N` children are `closed` and `verify_review_loop` is `closed` at the point `stage-final.md` reaches its terminal step
- **THEN** the epic's bd status is set to `pending-human-review:wip` and its status is not `closed`

#### Scenario: Partial-failure run reaches finalize
- **WHEN** at least one `task-N` child or `verify_review_loop` is `failed:wip` at the point `stage-final.md` reaches its terminal step
- **THEN** the epic's bd status is set to `failed:wip` and its status is not `closed`

### Requirement: bd is a mirror, not the pipeline's source of truth
All bd/`bd mol` state changes described above SHALL be additive side effects performed at points where the orchestrator already writes to `.loop-logs/<id>/tasks/*.json` or `.loop-logs/<id>/tasks/verification-state.json`. This requirement SHALL NOT be satisfied by any change that removes, replaces, or makes conditional the orchestrator's existing writes to those files, or that makes any vendored plugin stage file (`stage-impl.md`, `stage-verify.md`, `stage-review-fix.md`, `stage-final.md`) read from bd instead of `.loop-logs/`.

#### Scenario: bd mirroring failure does not block the pipeline's own bookkeeping
- **WHEN** a `bd update`/`bd mol`/`bd comments add` call in the mirroring doc fails or is unavailable
- **THEN** the orchestrator's own `.loop-logs/<id>/tasks/*.json` write for that same transition still occurs, and the pipeline continues
