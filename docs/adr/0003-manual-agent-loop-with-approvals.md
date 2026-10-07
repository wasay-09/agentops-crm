# ADR 0003 — A hand-written agent loop, with human approval for every write tool

**Status:** accepted

**Context.** Agents read CRM data freely, but changing it (adding notes, moving deals) must be reviewed by a
person. Reviews take minutes or hours, so a run has to stop, survive restarts, and resume on any instance.
SDK tool runners loop in-process and are provider-specific.

**Decision.** The runtime owns the loop. Each tool has a `mode` in its contract: `read` tools execute
immediately; `write` tools create an `approval` and the run moves to `awaiting_approval`. All state — messages,
tool calls, approvals — is persisted. Approving executes the tool with the approver recorded as the actor;
rejecting sends a "rejected by <name>" tool result back so the model can respond honestly. A decision is
recorded exactly once (`update … where status = 'pending'`), and only the request that flips the run back to
`running` continues it (row lock), so concurrent approvals can't double-execute or double-resume.

**Consequences.**
- Safe by construction: there is no code path from model output to a CRM write without a person.
- Tool arguments are validated against the shared zod schema before anything runs; invalid arguments go back to
  the model as an error result so it can correct itself.
- Text inside CRM records is data; even if a model were tricked by it, the write would still wait for approval.
- More code than an SDK runner. Worth it for durability and provider independence.
