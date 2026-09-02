<!--
Owns Big Plan's durable subsystem partition, code anchors, boundaries, and dependency order.
-->

# Subsystem partition

Start with the root [agent guide](../AGENTS.md) for product orientation and repository-wide contributor guidance.

Big Plan's product work is organized into seven subsystems.
The partition is grounded in the codebase's actual module boundaries, not in issue-tracker categories.
The [agent guide](../AGENTS.md#subsystems) owns the workflow rule about naming a subsystem before starting work; this document owns which subsystems there are and where each one ends.

## Why the partition falls where it does

Comment threads and diffs are one subsystem, not two.
The diff's content is computed, not stored: `src/review/snapshot-diff.ts` turns two snapshot endpoints into aligned change places on demand, and `/api/snapshot-diff` accepts those endpoints directly, independent of any thread.
What does persist is change-set-scoped: committed revisions are recorded through `src/review/change-set-commit.ts` and folded into the stable baseline and current endpoint of the thread or request that owns them. Per-place review acceptance is recorded with the review, keyed by those same endpoints plus a place id (`src/review/change-verdicts-store.ts`).
You cannot change diff semantics without changing thread semantics, so both live in the Change Engine.

The session runtime is a different subsystem from either.
`src/review/server.ts`, `src/review/review-route-context.ts`, the sibling `src/review/routes-*.ts` modules, `src/review/session-authority.ts`, `src/review/request-mailbox.ts`, and `src/review/agent-work-loop.ts` render and serve the document, authorize requests, and keep the browser, server, and agent connected.
Those are Session Reliability responsibilities, distinct from thread and diff semantics.
`src/review/server.ts` owns request security, the route allow-list, dispatch, and the runtime lifecycle; `src/review/review-route-context.ts` owns the named state shared across handlers, and the sibling route modules own every API and asset route handler, grouped as session, review-state, agent-exchange, change-set, snapshot-diff, and assets.
These runtime-boundary modules delegate semantic decisions to their owning subsystems rather than define them at the delivery boundary.
Session Reliability's own failure modes are lifecycle and atomicity: disconnects, hangs, and lost or double-processed messages, not conversation or diff correctness.

The commenting chrome is a third subsystem again.
Comment width, composer growth, tooltips, and Escape-key layering live in browser presentation modules and can change without touching either the thread data model or the runtime.

That three-way seam, not a threads-versus-diffs-versus-reviews split, is what the rest of this partition builds on.

## The seven subsystems

### A. Change Engine

**Problem set.** The core entity of review is the change set: a baseline snapshot, a current snapshot, per-place verdicts and provenance, and an optionally attached conversation, diffed from its start, rendered in place of what it changes, and closed place by place - accepted, rejected back to the baseline bytes, or undone to undecided - by a reviewer or by session-scoped auto-accept.

**Code anchors.** `src/review/snapshot-diff.ts`, `src/review/change-set-commit.ts`, `src/review/change-verdicts-store.ts`, `src/review/change-restore.ts`, `src/render/plan-source-segments.ts`, `src/review/input-contract.ts`, `src/review/shared/change-verdict.ts`, `src/review/shared/input-contract.ts`, `src/review/shared/thread-change-set.ts`, `src/review/shared/open-items.ts`, `src/review/browser/inputs-surface.browser.tsx`, `src/review/shared/thread-projection.ts`, `src/review/shared/change-attribution.ts`, `src/review/shared/comment.ts`, `src/review/browser/diff-lens.browser.tsx`, `src/review/browser/diff-tour.browser.tsx`, `src/review/browser/diff-anchor.ts`, `src/components/wireframe/compile-diff.ts`, `src/review/browser/inline-comments.browser.tsx`, `src/components/_model/component-diff/contract.ts`, `src/components/_registration/define-component.ts`, `src/render/render-diff-view.ts`, snapshots in `src/review/store.ts`.

**Boundary rules.**

- The thread is the change set's container, not the other way round.
  A change set's provenance (reviewer comment, plan-wide chat, or an unsolicited agent-pushed revision) is an attribute of the change set, not a hard-coded assumption that every change is born from a conversation.
  An inbound push is a new message kind through `src/review/agent-exchange.ts` and rides the same claim-and-atomic-terminal delivery protocol as any other exchange; it does not invent its own delivery path.
- A component never _finds_ a change.
  The engine keeps sole ownership of detection, alignment, baseline policy, and attribution, and hands a component one aligned `ComponentDiffInput` carrying the available compiled models, status, and word runs.
- What a component owns is that input once it has it: it may derive a bespoke diff model and view or take the free compiled **Was**/**Now** presentation.
  That is a component contract rather than an engine-owned rendering choice - see [Captain amendments](#captain-amendments).
- A change set describes committed revisions only.
  `src/review/change-set-commit.ts` is the seam: a revision is recorded inside the terminal commit and nowhere else, the reader's current snapshot advances from that log rather than from response files, and folding the log keeps an ordinary comment thread's baseline and provenance stable across later replies while pushes and replies in pushed threads remain immutable request-keyed transactions.
  `GET /api/change-sets` serves that fold on demand through the browser-safe contract in `src/review/shared/review-wire.ts`; the route exposes the aggregate without creating a second one or making claim stages domain state.
  `src/review/shared/thread-change-set.ts` projects that fold into the one current diff a thread renders, and `src/review/shared/open-items.ts` projects the same committed ownership into approval; a feedback response that advances several comment-owned sets advances each independently.
- A change set's verdict is a review fact, not a browser preference.
  `src/review/change-verdicts-store.ts` owns the record, including which of the two verdicts a place holds and whether it was decided by the reviewer or by auto-accept, and `src/review/shared/change-verdict.ts` owns the one selector that turns it into a count, so every surface showing how much of a set is still open reads the same number and a reload never reopens closed work.
  Undecided is the absence of a row rather than a stored value, and undo returns a change to it: an undone change is waiting for a decision again and may be accepted or rejected next, with nothing about the first verdict surviving to constrain the second.
- A rejected place's bytes are derived from the record, never edited into the plan.
  `src/review/change-restore.ts` answers one question - what source does this revision have once these places are rejected - so a second rejection, an undo, and a re-decision are all the same derivation over a different set rather than an edit that has to invert an earlier one.
  It restores whole authored nodes (`src/render/plan-source-segments.ts`) and proves the candidate by rendering it: the restore lands only when the diff left is exactly the diff the agent proposed minus the rejected places, and is refused with the plan untouched otherwise.
- What a review is waiting for is one derived contract, never a per-surface tally.
  `src/review/input-contract.ts` joins the compiled decision inventory with the answers record into the inputs a review expects - decisions for now, growing to the rest of what a review waits on as each of those becomes enumerable; `src/review/shared/input-contract.ts` owns the one selector that turns them into a standing, including how many critical ones are still open.
  Criticality is authored on a decision and travels through `CompiledDecisionCard.isCritical`; it is deliberately excluded from the decision digest, because raising what approval demands does not change what the reviewer answered.
- Delivery (getting a message to the runtime) belongs to Session Reliability, and furniture (composer, tooltips, layout) belongs to Commenting Surface; only Change Engine code changes when acceptance semantics change.

### B. Session Reliability

**Problem set.** The browser, the loopback server, and the agent stay connected and honest about liveness, and no message is ever lost, double-processed, or run inside a resolved thread.

**Code anchors.** `src/review/server.ts`, `src/review/review-route-context.ts`, `src/review/routes-*.ts`, `src/review/runtime-watchdog.ts`, `src/review/session-authority.ts`, `src/review/request-mailbox.ts`, `src/review/staged-plan-mutation.ts`, `src/review/agent-work-loop.ts`, `src/review/agent-exchange.ts`, `src/review/review-state-version.ts`, `src/review/store.ts` (`readAgentRoster` and `requestAgentPrimacy`), `src/review/service/`, `src/review/state-directory.ts`, `src/review/browser/review-poll-health.ts`, `src/review/browser/review-write-availability.ts`, `src/review/browser/review-runtime-request.ts`, `src/review/browser/review-recovery-merge.ts`, `src/review/browser/review-recovery-storage.browser.ts`, `src/review/shared/agent-status.ts`, `src/review/shared/agent-disconnect.ts`, `src/cli/review/command.ts`, `src/cli/service/`, `src/cli/agent/`.

**Boundary rules.**

- This subsystem owns lifecycle and atomicity: session liveness, replacement, recovery, and locked mutation of stored agent requests.
  It does not own what a thread means or what a diff shows.
- It also owns the plan source's one writer.
  Agent edits live in a claim-scoped stage, and `src/review/staged-plan-mutation.ts` publishes a stage under the plan-mutation lock only when the holder, the claim generation, and the source's base digest all still hold; the swap is one atomic rename, and a journal written before it settles a crash on either side.
  The reviewer's revert publishes through the same module and the same lock, re-proving the digest it was computed against, so it can never land over a revision an agent committed while the revert was being prepared.
  A claim attempt is transport state here, never Change Engine domain state: the commit hands the Change Engine a committed revision through `src/review/change-set-commit.ts`, and nothing else records one.
- Idle expiry is one centralized runtime policy, not a pair of aligned boundary defaults: `DEFAULT_REVIEW_IDLE_TIMEOUT_MS` in `src/review/server.ts` owns the default, and `src/cli/review/command.ts` imports it rather than duplicating it.
  The default is no expiry: a review stays reachable until the process is deliberately stopped.
  `--idle-timeout` opts into a bound; a nonzero value must be at least 1 minute, and `--idle-timeout 0` restates the default.
  Any authenticated request from an open page counts as activity, so a configured bound measures genuine abandonment rather than time since the last keystroke.
  The agent work loop exits when the session heartbeat it follows dies.
  Symptoms that look unrelated (an agent disconnecting, a preview expiring) can share this one cause.
- The review-link service under `src/review/service/` is a reader of this subsystem's truth, never a second copy of it.
  Its registry records where a plan lives and nothing about whether a session runs; every live-or-ended answer flows through `session-authority.ts` at request time.
  A liveness field anywhere under `~/.big-plan/service/` would be a second definition that drifts, so the registry schema rejects one.
  It never writes inside a `.big-plan/review/` directory, and it never starts a session: only an explicit `big-plan` command does that.
- Whether an agent is attached and whether it has narrated lately are two questions, and one signal cannot answer both.
  `big-plan agent next` hands the work over and its process exits, so between two progress notes nothing is running on that agent's behalf and no heartbeat or claim lease renews.
  Silence inside a turn is therefore evidence of silence alone, and the two questions are answered on separate surfaces.
  A connection surface reports only what presence observed, and never consults held work: a claim outlives the process that took it, so letting it speak for attachment would assert a connection nobody saw.
  It may not deny one either, so every gap in the signal - the health card, the connection log's rows and durations, and the reason the runtime stores on the edge - names the missing signal and the quiet period it opens, never a disconnection and a reconnection.
  The exceptions are the two ends that are known rather than inferred, and only those two may be named as ends.
  The first is an end a live process observed and reported.
  The waiting loop is that process: it records its parent pid at startup, compares it on every wait iteration and once more before claiming, and on a change writes `state: "ended"` into its own heartbeat before exiting, guarded by the per-invocation `writerId` it stamps on every heartbeat so it can never mark a newer agent's live session ended.
  `readAgentPresence` reads that marker as an immediate disconnect with no aging, and each surface that would otherwise state the 75-second threshold states the reported end instead.
  The second is an end the reviewer asked for: `src/review/shared/agent-disconnect.ts` owns that directive, addressed to exactly one connection token so a decision taken about one agent can never end the agent that attaches next, and it names the end whether or not the agent lived long enough to acknowledge it, because the reviewer's own act was a fact before Big Plan looked.
  The three accounts of a stopped connection are ordered - silence, the loop's reported end, the reviewer's disconnect - and `agentConnectionReasonSupersedes` in `src/review/shared/agent-status.ts` is the one definition of that order, so a log that has recorded a stronger account is never talked back down to a weaker one by the next poll.
  Nothing else may shorten the window: a death nothing observed - a killed process tree, a machine losing power - has produced no fact to report and stays on the unchanged aging path.
  Tying the loop's life to its spawner is also what keeps a dead agent from claiming: a claim taken by a process whose stdout has no reader turns one wrong connection reading into a turn nothing will ever finish.
  Work that has been picked up is judged by its own narration instead: a renewed lease reads as working and a quiet one as stalled, and only an unclaimed plan lets presence decide idle against disconnected.
  `heldWorkQuiet` in `src/review/shared/agent-status.ts` is the one definition of what held work says about a silence, and it is deliberately blind to the lease, because the quiet turn it answers for has by definition already let its lease lapse.
  It is an activity and queue input: while it explains a silence it decides the queued reading on a message sent behind a live turn and the takeover warning on the recovery section, and it never reaches a connection surface.
  That explanation is bounded, because nothing reaps a claim and an unbounded one would leave the reviewer told a dead turn is still in flight forever.
  Past `AGENT_RECOVERY_HORIZON_MS`, measured from the claim's own last signal and never from the lease, the pickup stops explaining anything everywhere at once: the activity card gives way to the ordinary presence answer, the per-thread stalled reading drops its promise to resolve itself and stops grouping the request as working, a newly sent message reads blocked rather than queued, and the recovery section drops its takeover warning for the plain recovery instruction.
  The horizon is itself an inference from silence, which is the class of inference this rule otherwise removes; the takeover-aware wording inside it is what keeps it honest, because it hands the adr/0002 consequence to the reviewer instead of nudging them into it.
  Agent presence never hides the recovery section, and neither does held work or the horizon - it is the only place the recovery prompt is rendered, so an agent going quiet must not take the reviewer's route back with it, and its copy rather than its visibility carries the takeover safety.
  Only a read-only session or a runtime that cannot be reached hides it, the latter because that prompt would then be advice about a dead endpoint under a card that already says the review session is unreachable.
  For the same reason, answering is gated on still being the recorded holder rather than on an unexpired lease: a takeover rewrites `claimedBy`, while a slow turn does not, and refusing the slow turn's answer would lose the reviewer's message.
  Held work stops holding the reviewer's own message only where both signals agree: a claim is proven abandoned when presence reports nothing attached and the pickup has also been quiet past the horizon, and `agentStillOwnsRequest` in `src/review/shared/request-ownership.ts` is the one definition of that, so the mailbox's refusal and the browser's offered affordance cannot drift apart.
  Editing or deleting a message under a proven-abandoned claim releases the claim and drops the stages it can no longer publish from, so a late returner is refused through the ownership gate that already guards delivery rather than through a second rule.
- Which agent speaks for a plan is decided in one shared roster authority, and never by whichever agent process wrote the shared store last: it answers who the primary is and whether the reviewer is being asked to decide, and the work loop, the exchange routes, and the rail's roster all read that answer instead of forming their own.
  A later connector attaches as an observer that may read the plan, is handed neither the reviewer's comments nor request state, and may not claim, note, or respond; it becomes the primary on the reviewer's answer, or - the one self-service case - once the reviewer is absent and the unclaimed seat has stayed quiet beyond `AGENT_RECOVERY_HORIZON_MS`, and the module's header owns why the authority exists.
  A session that is no longer the primary is told at its next command rather than at publication - `NOT_PRIMARY` from `agent note` and `agent respond`, an observer result from `agent next` - so a displaced loop can stop instead of paying for a turn nothing will accept.
- A thread-resolution action that conflicts with a queued or in-flight message for that thread is a request-lifecycle invariant, enforced where request claims and terminal states land (`request-mailbox.ts`), not a thread-semantics concern.
  The invariant holds both ways: new work naming a still-resolved thread is refused at the same request-creation boundary.
  Both directions take `.resolved.lock` around their check and their write, so a resolve and a create cannot interleave into a resolved thread that holds outstanding work; session custody and the HTTP write gate order requests but do not replace that lock.
- Custody of a plan is decided in one place and refused by default: `activateReviewSession` in `src/review/session-authority.ts` will not displace a runtime that is still live, and `big-plan review` reports that runtime's address instead of starting a second one.
  Liveness there is the session heartbeat the agent already follows, never a second liveness definition, and the check runs inside the custody lock so simultaneous starts cannot both win.
  A start writes nothing into the plan's shared store until that locked activation succeeds, so a refused start and the loser of a tie both leave the store exactly as they found it.
  Only an explicit `--takeover` displaces a live session, because doing so makes that session's open page and connected agent read-only.
  Any surface tempted to suggest restarting a review inherits this rule rather than deciding for itself: the command is the only place that decides whether starting or taking over a runtime is allowed.

### C. Commenting Surface

**Problem set.** Reading and writing comments is comfortable and safe: room to read, a composer that grows, tooltips and Escape that behave correctly, and no UI that lies about what happened.

**Code anchors.** `src/review/browser/ui.browser.tsx`, `src/review/browser/comments-surface.browser.tsx`, `src/review/browser/chat-surface.browser.tsx`, `src/review/browser/compose-images.browser.tsx`, `src/review/browser/tooltip-position.ts`, `src/review/browser/thread-anchor.browser.ts` and `src/review/shared/thread-layout.ts` (the rect a floating thread is measured against, and the left edge and stacking that follow from it), `src/review/browser/agent-connection.browser.tsx`, `src/review/browser/agent-roster.browser.tsx`, shared card markup in `src/review/shared/comment-markdown.ts`.

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

**The change set is primary (Change Engine).**
The change set, baseline plus current plus acceptance plus provenance plus an optional conversation, is the primary entity.
The thread is one container for it, not the reverse.
Provenance is modeled as an attribute of the change set (reviewer comment, plan-wide chat, or agent-push), so each origin fits without remodeling the set.

**Diff mode as a component contract (Change Engine, applied by component slices).**
Every component accepts a discriminated `ComponentDiffInput` for an added, removed, or changed instance and can render its own diff.
Each component may own a model-level derivation from that input and a paired diff view; without both, it receives the free compiled **Was**/**Now** presentation.
The Change Engine keeps sole ownership of detection, alignment, baseline policy, word runs, and attribution (`snapshot-diff.ts`, `change-attribution.ts`); components own only honest presentation of the input.
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
