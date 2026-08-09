# Planning Workflow Decisions

Decision record from the `/grill-me` session that restructured [001-planning-and-implementation-workflow.md](001-planning-and-implementation-workflow.md) from a two/three-layer pipeline into an explicit four-step workflow.

---

## Q1: Should `/grill-me` become mandatory before openspec, or stay conditional?

**A:** Mandatory, every ticket.

**Decision:** Every ticket runs explore → `/grill-me` → openspec → superpowers, no skipping.

**Reason:** Predictable pipeline; openspec always starts from a clarified brief instead of relying on someone remembering to invoke grill-me only when they think something's unclear.

---

## Q2: How formal should the new "explore" step be?

**A:** Plain reading, no artifact.

**Decision:** Explore means reading the ticket file, related `openspec/specs/*.md`, and relevant code before `/grill-me` — no skill invocation (not `openspec-explore`, not the `Explore` agent), no output file.

**Reason:** It's prep for asking informed questions, not a pipeline layer that produces its own record.

---

## Q3: How should the pipeline be described/numbered now that explore is added?

**A:** Four-step workflow, not "three-layer pipeline."

**Decision:** Explore → Clarify (`/grill-me`) → Spec (openspec) → Plan (superpowers). Dropped the "layer" framing since explore and grill-me don't produce spec-of-record artifacts the way openspec/superpowers do.

**Reason:** Matches what actually happens; avoids overloading "layer" for steps that aren't artifacts.

---

## Q4: Where does the `/grill-me` session's Q&A get documented (per the standing "always document decisions" rule)?

**A:** Folded into openspec's `proposal.md`/`design.md` — no separate decision-log file for ticket work.

**Decision:** The grill-me conversation directly informs `openspec-propose`, which writes the resulting decisions and rationale into `proposal.md`/`design.md`.

**Reason:** Avoids a duplicate doc (grill-me log + openspec proposal) that can drift out of sync; openspec is already the spec-of-record layer.

**Note:** This applies to per-ticket grill-me sessions. Meta/workflow-level grill-me sessions (like this one) still get their own decision record, following the existing `NNN-*-decisions.md` pattern used elsewhere in `docs/` (e.g. [002-architecture-decisions.md](../architecture/002-architecture-decisions.md)).
