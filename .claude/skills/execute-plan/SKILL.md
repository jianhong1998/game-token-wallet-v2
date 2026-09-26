---
name: execute-plan
description: Discover a plan file in docs/superpowers/plans/, resolve its linked spec, and execute implementation via autonomous-feature-development skill.
disable-model-invocation: true
---

## 1. Discover plan and spec

1. Scan `docs/superpowers/plans/` for `.md` files.
   - **Zero files** → fail with: "No plan found in docs/superpowers/plans/".
   - **Multiple files** → fail with: "Expected one plan per branch, found N files: [list]".
   - **Exactly one** → read it as the plan.
2. Parse the plan's `**Spec:**` header link to resolve the spec path (e.g. `**Spec:** [spec.md](../../openspec/changes/.../spec.md)`).
   - If no `**Spec:**` link found → fail with: "Plan missing **Spec:** link".
3. Read the resolved spec file to confirm it exists.

## 2. Execute

Invoke skill `/autonomous-development-plugin:autonomous-feature-development` with the discovered `plan_path` and `spec_path`.

### Model tiering

- Orchestrator and reviewer agents: `cce.claude-opus-4-6[1m]`
- Implementer subagents: `cce.claude-sonnet-4-6[1m]`

## 3. After completion

1. **Commit** — all file changes must be committed before generating the report. Do not leave uncommitted work. The CI pipeline handles `git push` separately via `after_script`.
2. **Report** — invoke `/autonomous-development-plugin:explain-changes` to generate a report. Include decisions made during implementation.
3. **Openspec sync** — check off `openspec/changes/<feature>/tasks.md` to match what was actually done. Run `openspec-sync-specs` (mid-flight) or `openspec-archive-change` (once the ticket is fully closed) to fold delta specs into `openspec/specs/<capability>/spec.md`.
4. **Ticket update** — update the ticket's status and `docs/tickets/000-index.md`.

## Restrictions

- Do not rebase, rename, or force-push the branch. Only append commits.
- Do not run `git push` — the CI `after_script` handles pushing.
- Do not delete plan or spec files — the `cleanup-development-footprint` job handles that separately.
- Do not delete or git-clean `.loop-logs/` — the CI job uploads them as artifacts.

## Tool usage in CI

- You are allowed to start full stack application with docker compose.
- OAuth platform (WOGAD) is ready for connection.
- Playwright and its browsers should be installed into the CI environment.
- You are allowed to run E2E and all the E2E related environment variables are provided in CI environment.
- Do flag out if you are blocked from any missing tool.
