<!--
Owns Big Plan's durable subsystem partition, code anchors, boundaries, and dependency order.
-->

# Subsystem partition

Start with the root [agent guide](../AGENTS.md) for product orientation and repository-wide contributor guidance.

Big Plan's product work is organized into seven subsystems.
The partition is grounded in the codebase's actual module boundaries, not in issue-tracker categories.
New work should state which subsystem it belongs to before it starts; when a change spans two subsystems, say so explicitly rather than leaving it implicit.

## Why the partition falls where it does

Comment threads and diffs are one subsystem, not two.
The diff's content is computed, not stored: `src/review/snapshot-diff.ts` turns two snapshot endpoints into aligned change places on demand, and `/api/snapshot-diff` accepts those endpoints directly, independent of any thread.
What does persist is thread-scoped: a thread's baseline and current endpoints live as fields on its own exchange records (`src/review/shared/thread-projection.ts`), and per-place review acceptance is keyed by those same endpoints plus a place id (`src/review/browser/diff-tour.browser.tsx`).
You cannot change diff semantics without changing thread semantics, so both live in the Change Engine.

The session runtime is a different subsystem from either.
`src/review/server.ts`, `src/review/review-route-context.ts`, the sibling `src/review/routes-*.ts` modules, `src/review/session-authority.ts`, `src/review/request-mailbox.ts`, and `src/review/agent-work-loop.ts` render and serve the document, authorize requests, and keep the browser, server, and agent connected.
Those are Session Reliability responsibilities, distinct from thread and diff semantics.
`src/review/server.ts` owns request security, the route allow-list, dispatch, and the runtime lifecycle; `src/review/review-route-context.ts` owns the named state shared across handlers, and the sibling route modules own every API and asset route handler, grouped as session, review-state, agent-exchange, snapshot-diff, and assets.
These runtime-boundary modules delegate semantic decisions to their owning subsystems rather than define them at the delivery boundary.
Session Reliability's own failure modes are lifecycle and atomicity: disconnects, hangs, and lost or double-processed messages, not conversation or diff correctness.

The commenting chrome is a third subsystem again.
Comment width, composer growth, tooltips, and Escape-key layering live in browser presentation modules and can change without touching either the thread data model or the runtime.

That three-way seam, not a threads-versus-diffs-versus-reviews split, is what the rest of this partition builds on.

## The seven subsystems

### A. Change Engine

**Problem set.** The core entity of review is the change set: a baseline snapshot, a current snapshot, acceptance state, provenance, and an optionally attached conversation, diffed from its start, rendered in place of what it changes, and closed by explicit acceptance.

**Code anchors.** `src/review/snapshot-diff.ts`, `src/review/shared/thread-projection.ts`, `src/review/shared/change-attribution.ts`, `src/review/shared/comment.ts`, `src/review/browser/diff-lens.browser.tsx`, `src/review/browser/diff-tour.browser.tsx`, `src/review/browser/diff-anchor.ts`, `src/review/browser/wireframe-screen-diff.ts`, `src/review/browser/inline-comments.browser.tsx`, snapshots in `src/review/store.ts`.

**Boundary rules.**

- The thread is the change set's container, not the other way round.
  A change set's provenance (reviewer comment, plan-wide chat, or an unsolicited agent-pushed revision) is an attribute of the change set, not a hard-coded assumption that every change is born from a conversation.
  An inbound push is a new message kind through `src/review/agent-exchange.ts` and rides the same claim-and-atomic-terminal delivery protocol as any other exchange; it does not invent its own delivery path.
- Diff mode is a component contract, not an engine-owned rendering choice: see [Captain amendments](#captain-amendments).
- The engine keeps sole ownership of detection, alignment, baseline policy, and attribution; components own only honest presentation of the pair.
- Delivery (getting a message to the runtime) belongs to Session Reliability, and furniture (composer, tooltips, layout) belongs to Commenting Surface; only Change Engine code changes when acceptance semantics change.

### B. Session Reliability

**Problem set.** The browser, the loopback server, and the agent stay connected and honest about liveness, and no message is ever lost, double-processed, or run inside a resolved thread.

**Code anchors.** `src/review/server.ts`, `src/review/review-route-context.ts`, `src/review/routes-*.ts`, `src/review/session-authority.ts`, `src/review/request-mailbox.ts`, `src/review/agent-work-loop.ts`, `src/review/agent-exchange.ts`, `src/review/browser/review-poll-health.ts`, `src/review/browser/review-runtime-request.ts`, `src/review/shared/agent-status.ts`, `src/cli/review/command.ts`, `src/cli/agent/`.

**Boundary rules.**

- This subsystem owns lifecycle and atomicity: session liveness, replacement, recovery, and locked mutation of stored agent requests.
  It does not own what a thread means or what a diff shows.
- Idle expiry is a single runtime policy, not a per-feature concern: `src/cli/review/command.ts` chooses the public command's ten-minute default and converts it to milliseconds, while `src/review/server.ts` independently supplies the same API-level default and enforces `idleTimeoutMs`.
  Keep those boundary defaults aligned unless the policy is centralized; the agent work loop exits when the session heartbeat it follows dies.
  Symptoms that look unrelated (an agent disconnecting, a preview expiring) can share this one cause.
- A thread-resolution action that conflicts with a queued or in-flight message for that thread is a request-lifecycle invariant, enforced where request claims and terminal states land (`request-mailbox.ts`), not a thread-semantics concern.

### C. Commenting Surface

**Problem set.** Reading and writing comments is comfortable and safe: room to read, a composer that grows, tooltips and Escape that behave correctly, and no UI that lies about what happened.

**Code anchors.** `src/review/browser/ui.browser.tsx`, `src/review/browser/comments-surface.browser.tsx`, `src/review/browser/chat-surface.browser.tsx`, `src/review/browser/compose-images.browser.tsx`, `src/review/browser/tooltip-position.ts`, `src/review/browser/agent-connection.browser.tsx`, shared card markup in `src/review/shared/comment-markdown.ts`.

**Boundary rules.**

- This subsystem is content-agnostic: it renders whatever prose arrives and does not own the content contract (see Chat Modality).
- Shared browser primitives that multiple subsystems consume (for example, a tooltip primitive) are built once here and adopted elsewhere, the same shape as the plan-identity module described in the [architecture overview](../AGENTS.md#architecture-at-a-glance).
- `src/review/browser/review-controller.browser.tsx` is the surface through which nearly every change in this subsystem routes; treat its size as a standing decomposition debt rather than a place to keep piling on.

### D. Element-Level Commenting

**Problem set.** Anything the reader can point at, including one element inside a wireframe or diagram, has a stable address a comment can attach to.

**Code anchors.** `src/render/markdown/block-identity.ts` (mints stable `data-block-id` addresses for Markdown blocks, component roots, table rows, columns, and cells, and component-declared semantic subtargets such as summary facets through `data-commentable-kind` and `ownerId`), `src/review/shared/comment.ts` (validates targets against the block map), component markup in `src/components/wireframe/` and `src/components/mermaid-diagram/`, host resolution in `src/review/browser/inline-comments.browser.tsx`.

**Boundary rules.**

- This subsystem extends the renderer's existing declared-subtarget mechanism into component internals that do not yet expose a stable semantic address; it does not redefine what a comment target is at the thread level (that stays with the Change Engine).
- It should not start ahead of the Change Engine settling what a comment target is, since it builds directly on that model.

### E. Renderer Fidelity

**Problem set.** The document renderer produces comfortable, faithful output from reasonable authored input, and every content type gets the affordances it deserves.

**Code anchors.** `src/render/markdown/` (`prose.css`, `deck-transform.ts`, `compile-markdown.ts`), component slices under `src/components/`, viewer affordances in `src/render/shell/viewer-script.ts` and `src/render/shell/diagram-script.ts`, lint rules in `src/lint/rules/`.

**Boundary rules.**

- This subsystem spans three ownership tiers, and a fix must land in its owning tier rather than wherever is convenient:
  the markdown pipeline owns prose between containers; each component slice owns fidelity inside its own container; the shell owns the uniform container contract, the affordances every container gets regardless of contents (maximize, comment entry, and a diff view per the Change Engine's diff-mode-as-component-contract amendment).
- A missing affordance on one container type (for example, a table missing an affordance every other container already has) is shell-contract work, not that component's polish.
- This subsystem touches no review-stack code, so it can run in parallel with any of the others.

### F. Chat Modality

**Problem set.** The reader controls how much the agent says, and can get a cheap explanation of a term without filing a comment.

**Code anchors.** `src/review/feedback-package.ts` (builds the brief the agent receives), the settings dialog in the review UI, agent-facing guidance in `assets/skill/SKILL.md` and `assets/guidance/`.

**Boundary rules.**

- This subsystem owns the content contract: brevity mode and similar settings change no Commenting Surface code, because that surface only renders whatever prose arrives.
- A new lightweight, on-demand exchange (for example, an inline term explanation) needs a new message kind through `src/review/agent-exchange.ts`; its selection affordance is built against Commenting Surface primitives while its semantics stay owned here.
- It needs a settled runtime (round trips) and a settled Change Engine (the guarantee that a chat exchange never mutates a change set) before it can build confidently.

### G. Authoring Guidance

**Problem set.** What agents are taught to author, with one canonical design source whose citations can break.

**Code anchors.** `assets/guidance/plan-guidance.md`, component `*.guidance.md` files, `src/lint/rules/`, `_internal/DESIGN_PRINCIPLES.md`.

**Boundary rules.**

- This subsystem is guidance-only: it does not own component validation or lint mechanics, only the authored content that teaches an agent how to use them well.
- It benefits from the presentation standards the other subsystems establish, so it is the natural last subsystem in an incremental sequence.

## Captain amendments

Three conceptual refinements constrain how the subsystems above implement their work.

**Change-set primacy (Change Engine).**
The change set, baseline plus current plus acceptance plus provenance plus an optional conversation, is the primary entity.
The thread is one container for it, not the reverse.
Provenance is modeled as an attribute of the change set (reviewer comment, plan-wide chat, or agent-push) so a future agent-push origin fits without remodeling.

**Diff mode as a component contract (Change Engine, applied by component slices).**
Every component can be handed a baseline and a current model and render its own diff.
Each component owns a model-level function `(baselineModel, currentModel) -> diffModel`, with a free default (side-by-side Was/Now or source word diff) and bespoke overrides where earned.
The Change Engine keeps sole ownership of detection, alignment, baseline policy, and attribution (`snapshot-diff.ts`, `change-attribution.ts`); components own only honest presentation of the pair.
This makes a diff a first-class state of the component instead of a lens-wrapped copy, which is what structurally protects functionality retention across a diff.

**Three-tier renderer fidelity (Renderer Fidelity).**
The markdown pipeline owns prose between containers, the shell owns the uniform container contract, and component slices own fidelity inside their own containers.
The application can then trust the container: any content inside a container gets that container's contracted affordances by construction, not by a per-content-type special case.

## Incremental order

This section records the durable dependency order for work that implements the subsystem partition.
It is an exception to the normal rule that task-specific future work and sequencing belong in temporary plans or issue tracking.
Keep each task's detailed steps and delivery status in those temporary owners while preserving the dependency order below.

1. **Session Reliability first.**
   It is the smallest coherent set with the highest trust payoff.
   Every other subsystem is evaluated through a live session, so an unreliable substrate makes every later defect ambiguous: was the diff wrong, or did the queue drop the request?
   It also settles the exchange-record lifecycle that the Change Engine's thread-owned change sets will ride on, so the mailbox is built once, not twice.
2. **Change Engine second.**
   It defines the thread and diff data model everything downstream renders.
   Doing it before surface polish prevents redoing that polish when threads change shape.
3. **Commenting Surface third.**
   Reader-visible comfort, safely built once thread layout has settled.
4. **Element-Level Commenting fourth.**
   It extends the engine's anchoring model, so it should not start before the engine settles what a comment target is.
5. **Renderer Fidelity fifth in sequence, but parallelizable.**
   It touches no review-stack code, so it can run alongside any of the subsystems above at any point.
6. **Chat Modality sixth.**
   Its features need a settled runtime and a settled engine.
7. **Authoring Guidance last.**
   It benefits from every presentation standard the earlier subsystems establish.
