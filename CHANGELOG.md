# Changelog

Notable changes to Big Plan, newest first.
Each entry describes one published npm release and matches its GitHub release notes.

[RELEASING.md](RELEASING.md#changelog) owns who writes this file and when.
It is written by hand, once per release, by the release engineer — never per pull request.

Big Plan is pre-1.0 and has no compatibility contract yet; see [Pre-release compatibility](AGENTS.md#pre-release-compatibility).

## 0.1.0 — unreleased

The first real release of Big Plan. Version `0.0.1` was a July 2026 placeholder published only to claim the npm name; everything below shipped after it.

Big Plan makes reviewing agent plans a first-class experience. An agent writes a plan as MDX, and Big Plan turns it into a human-friendly review document that a person can read, question, and accept before any code is written.

### Write and check a plan

- Plans are MDX: Markdown plus a fixed set of built-in components. Plan-authored code never executes — imports, exports, expressions, and inline JSX are rejected.
- `big-plan guidance` prints the versioned plan-writing principles, and `big-plan guidance <Component>` prints one component's judgment-level usage guidance. Reading guidance is a gate: `validate`, `render`, and `review` stay locked until it has been read for the working directory.
- `big-plan validate` is a no-write authoring check. It renders the plan in memory, then applies lint rules for the things that make a plan readable — punchy titles, declarative ledes, lede length, an overview that matches the sections, and user journeys nested under their container.
- Slide types give the plan a guidance-bearing vocabulary, with `Part` dividers and `Slide` frames for grouped navigation.

### A component vocabulary for plan content

Twenty built-in components, each an opinionated presentation of one kind of plan information:

- **Prose and structure** — `Callout`, `QuickSummary` (faceted into What, How, Risks, and Decisions, with hard summary caps), `TableOfContents`, `Part`, `Slide`.
- **Decisions** — `Decision`, `QuickDecision`, and `DecisionAnalysis`, a scored criteria matrix with reader-adjustable weights, a live score row, and an explained best match.
- **Code and files** — `CodeSnippet`, `CodeDiff`, `FileTree`, `FileTreeDiff` with foldable directories and an author-controlled diff default.
- **Data and APIs** — `DataTable` with reader-arranged, persisted columns, grouping, and summary rows; `DatabaseTableSchema` with `INDX` references and verbatim-DDL tabs; `HttpEndpoint`, `GraphqlOperation`, `GrpcMethod`.
- **Pictures** — `FlowDiagram` for flows, dependencies, and fan-outs; `MermaidDiagram` compiled at build time; `Wireframe` for screen-level UI, with an icon vocabulary, fixed device envelopes, a maximize mode, and a left screen rail.

### A review document built for reading

- One self-contained HTML file. The plan stays fully readable with scripts disabled, and no plan content ever contributes executable code.
- Reading chrome: stable deck collapse with bulk controls, contents navigation that tracks the section being read, shared figure-maximize controls, and a toolbar with its own chrome band.
- Reviewer appearance settings, including five colour themes, applied on first paint and persisted per plan.
- The whole product surface follows one design system, and the layout holds up on mobile.

### Review it with the agent, live

`big-plan review` starts a local, loopback-only review the reviewer and the agent share.

- Comment on any addressable block, including both sides of a component diff. Threads batch, group in the sidebar, resolve, and accept screenshots.
- Answer the plan's decisions in place; answers are recorded with the review.
- Queued messages can be revised or deleted before they are sent, and unsent text survives a reload.
- Critical and stale review inputs are surfaced rather than left to be noticed.
- The agent's identity, model, and working state show in a status rail; the reviewer chooses the primary agent and can disconnect it.
- The agent pushes plan revisions live. Arriving pushes are announced, threads own their evolving change sets, each change carries a verdict, and components render their own before/after diffs. A session-scoped auto-accept protocol removes the click when the reviewer wants it removed.
- Every plan gets a permanent review link that survives runtime restarts, served by a local link service and proxied behind a switch.

### Accept the plan and hand it off

- An explicit approval workflow, with a settings page for the approval message.
- Approval stamps the reviewer's decision answers into the plan source as decided decisions, accepts every open change set, and renders accepted changes as plan content.
- Approval history and stamps stay visible in the document.
- Approved plans hand off to the coding agent through `big-plan agent`.

### For agents and tools

- `big-plan compile` emits the validated plan as machine-readable JSON, each component model carrying the block address a reader can point at.
- Live plans export as portable Markdown another agent can read with no Big Plan knowledge.
- `big-plan skill` ships a versioned agent skill shell; `skill write <path>` installs it only when asked.
- `big-plan agent` provides the local agent exchange: `next`, `push`, `note`, and `respond`.
- Agent edits to the plan source are fenced behind claim-scoped stages and one recoverable atomic commit, so a crash mid-write cannot corrupt the plan.
- A passive update notice tells persistent installs when a newer release is published.

### Project

- Documentation site at [bigplan.dev](https://bigplan.dev), a published security policy and vulnerability-reporting process, and the FSL-1.1-MIT license.
- Releases publish from GitHub Actions through npm Trusted Publishing with provenance; no npm write token exists in this repository.
