<!--
Entry point for Big Plan contributors: product orientation, architecture,
source ownership, repository-wide vocabulary, and durable workflow boundaries.
-->

# Big Plan agent guide

This is the entry point for agents working in Big Plan.

## Product

Big Plan makes reviewing agent plans a first-class experience.
It is built around one question: what is the best user experience a human can have when aiming to understand, give feedback on, and ultimately accept an agent plan?

An agent writes the plan, and Big Plan renders it as a human-friendly document designed to make the plan as easy as possible to understand, give feedback on, and accept.

### Where Big Plan fits

A robust AI-assisted delivery workflow has several distinct stages:

1. **Create a sandbox.** The user gives the agent an isolated workspace where it can make changes without disturbing the main working copy.
2. **Declare intent.** The user describes the outcome they want and supplies any context or constraints the agent needs.
3. **Review the plan.** The agent proposes how it will achieve that outcome; the user works to understand the plan, gives feedback, and accepts it before execution begins.
4. **Execute.** The agent implements the accepted plan inside the sandbox.
5. **Review the recap.** The user learns what the agent changed, what it verified, and where judgment is still required.
6. **Validate the deliverable.** The user exercises the delivered result—for example, by taking the UI for a spin—and confirms that the intended business value, user experience, and implementation approach are sound.
7. **Merge.** Once the result has passed human validation and any required code review, it is ready to integrate.

Big Plan focuses specifically on stage 3: helping a human understand, discuss, and accept the agent's intended approach before work begins.
It does not own sandboxing, execution, post-execution validation, code review, project management, or merging.
Big Plan runs locally, and the plan source on disk is authoritative.

The product documentation owns current capabilities and usage.
This guide owns the durable implementation model contributors must preserve.

### Concepts

- **Agent plan** is the agent's proposed approach for achieving the user's intent before implementation begins.
- **Plan source** is the authoritative plan document on disk. During a review the agent edits a claim-scoped candidate copy of it, and Big Plan publishes that copy into this source.
- **Component** is a built-in, opinionated way to present a specific kind of plan information, such as a decision, code diff, schema, or file tree.
- **Review document** is Big Plan's human-friendly presentation of the plan source.
- **Plan review** is the conversation in which the human works to understand the proposed approach, gives feedback, and resolves concerns with the agent.
- **Plan acceptance** is the human's explicit decision that the intended approach is understood well enough for the agent to begin execution. It is not acceptance of the finished deliverable, which happens later.

### Plan-quality standards

Big Plan aims for plans that meet two standards:

1. **Pleasant to read** - the review experience should feel pleasant; reading the plan should not feel like a chore.
2. **Understandable** - the plan should be as easy as possible for a human to understand.

Use these standards when judging plan quality, product improvements, and the [gold-standard plan-quality testing](#gold-standard-plan-quality-testing) workflow.

## Technical orientation

Big Plan plans are MDX files that contain Markdown and built-in components.
Plan-authored code never executes: imports, exports, expressions, and inline JSX are rejected.

Big Plan calls the validation-and-translation step **compilation**.
The output commands compile the authoritative plan source independently, then produce either machine-readable JSON for agents and tools or a self-contained HTML review document for humans.
The no-write validation command renders the plan in memory while collecting the machine-readable summary, then applies linting rules to the authored plan.
Human delivery enforces the same linting rules before packaging, and a guidance command prints versioned plan-writing principles whose recent acknowledgment gates validation, human delivery, and local review.

## Architecture at a glance

Big Plan uses one compilation path to produce machine-readable JSON, a human-readable review document, or a portable Markdown export from a live review.
The framework-free plan vocabulary is the shared bottom tier for guidance-bearing concepts consumed by compilation, lint, and rendering.
The validate command checks that the review document can be rendered, then applies linting rules to the authored plan; the render command applies the same linting rules before writing:

```text
MDX plan source
  -> CLI command
  -> parse and validate allowed Markdown and component syntax
  -> validate and translate built-in components
  -> delivery-specific component presentation
     -> React view -> HAST -> document transforms -> block identity
     -> machine output -> machine-readable JSON
     -> human output -> self-contained HTML review document
     -> Markdown view -> portable Markdown plus current review overlay
  -> validate and human output -> linting rules on the authored plan
```

Each component validates its authored attributes and content into plain data describing what it should show.
Machine and human delivery give that data to the component's React view, cross one React-to-HAST boundary, and apply document-wide transforms; only what they publish differs.
Live Markdown export uses the same compiler and component traversal, but gives the validated data to each component's framework-free Markdown presentation before applying Markdown-wide transforms.
Human delivery packages the result as inert HTML.
Machine delivery publishes the collected models as JSON, which is why it renders too: each model carries the block address its rendered root was given, and a block address only exists over a finished deck.
That address is present only where the component's root became a block a reader can point at, so a component rendered privately inside another component's markup, and a slide, which is a scope rather than a block, each publish a model with no address.
The two differ in exactly one other respect, and it is a consequence rather than a choice: machine delivery makes a component's model carry its nested components' presentation, because no later pass reaches a deferred placeholder that only a model holds.

Every component-root block descriptor carries the authored name and the model that produced it, joined by a delivery-local instance key that the pipeline strips before serialization.
That join is what lets a document-wide pass read what a component asserted instead of sniffing the markup the component just rendered, and it is why a rendered document is byte-identical with the join in place.
Validation renders the plan in memory while collecting the same component models in one pass.
It discards the generated HTML, then applies its registered linting rules to the authored plan.
React is a presentation-edge implementation tool.
A rendered document ships a typed React interaction island for commenting plus the page envelope's first-paint preference bootstrap and the shell's self-contained viewer scripts for the [documented reader interactions](docs/src/content/docs/intro/tour.md).
The browser React interaction island never client-renders or gates plan content.
It may install a server-rendered article revision or component diff root, but every plan-DOM replacement crosses the single boundary described below.
The plan remains fully readable when scripts are disabled, and Big Plan ships no separate script-free HTML variant.
Plan content never contributes executable code, and a document stays fully readable with scripts disabled.

Three runtime contracts hold that browser layer together, and each exists
because breaking it fails silently rather than loudly.
The review island may replace plan DOM only through `src/review/browser/plan-dom.browser.ts`, which announces the swap as `bigplan:article-replaced`.
Every shell script and every island effect that holds a node re-resolves on that event, because a replaced article or component root detaches everything wired beneath it and a dead handler throws nothing.
`src/review/browser/live-target.browser.ts` resolves plan identity in one place.
It scopes lookups to the live article and prefers the copy a reader can see when a name sits on more than one rendering, such as a diagram's theme variants.
A component renders its own diff in place of its root, and the side that is not the plan reaches the browser without plan identity at all, so there is no replayed copy to exclude.
It treats a compiler-addressed component diff replacement as live and returns either an element or the reason it is missing.
A lint rule keeps it the only such place, because a raw selector silently returns a plausible wrong node instead of failing.
Identity is deliberately not geometry: that resolver rightly answers with
elements the browser never laid out, such as a block inside a collapsed slide,
so a floating comment thread takes its rect from exactly one module,
`src/review/browser/thread-anchor.browser.ts`, which climbs to the nearest
laid-out ancestor and answers with a rect it measured or the reason it has none.
Measuring anywhere else fails silently in the same shape, because an unlaid-out
element still answers `getBoundingClientRect()` with an all-zero rect that is
indistinguishable from a real measurement at the document origin and parks the
thread in the left margin, the far side of the screen from its content.

One server-side invariant is worth the same treatment, for the same reason.
The authoritative plan source has exactly one writer, `src/review/staged-plan-mutation.ts`.
Agent edits go into a claim-scoped stage, and a stage publishes only under the plan-mutation lock, only when the recorded holder, the claim generation, and the source's base digest all still hold, and only through one atomic rename that a journal written beforehand can settle after a crash.
The reviewer's two writes cross the same boundary. A revert takes that lock and re-proves the digest it was computed against before renaming, so a revision an agent published in the meantime refuses the revert instead of disappearing under it.
Approval stamps the reviewer's answers into the source as decided decisions, and it does so inside the approval commit's own hold of that lock, because an approval that pinned the pre-stamp revision would go stale against its own write.
Anything that writes the plan outside that boundary reintroduces the failure the boundary exists to remove, and it does so silently: the bytes land, and nothing refuses them until a reviewer notices work they never approved.
Its record for the Change Engine goes through `src/review/change-set-commit.ts` and nowhere else, which is what keeps a change set describing published revisions only.

Dependencies follow ownership inward: the CLI owns public command I/O, the review layer owns the local human-agent exchange, the renderer owns document-wide compilation and delivery, and component slices own component behavior.
The exact dependency allow-list and completeness guard live in `eslint.config.mjs`.

## Source ownership and placement

| Owner                    | Responsibility and placement rule                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/`               | Public command dispatch, shared input and safe derived-output workflows, errors, and result serialization. Give each public command a non-underscored folder; keep reusable command mechanics in `_shared/` and business semantics below the CLI.                                                                                           |
| `src/components/`        | Built-in components as vertical slices. Put a new component in its own folder and follow the infrastructure boundaries in the [components local map](src/components/README.md).                                                                                                                                                             |
| `src/lint/`              | Framework-free, validate-only linting rules for statically analyzable aspects of an authored plan. Keep rules independent and register them in a deterministic order.                                                                                                                                                                       |
| `src/plan-vocabulary/`   | Framework-free, guidance-bearing plan vocabulary shared by component compilation, lint, and rendering. Give each slide type its own file under `slide-types/definitions/`, and keep catalog-wide validation, assembly, and shared contracts at the `slide-types/` root.                                                                     |
| `src/render/`            | Pure document compilation and delivery orchestration. Put cross-document pipeline behavior here and follow the stage boundaries in the [renderer local map](src/render/README.md); keep component-specific behavior in its component slice.                                                                                                 |
| `src/render/shell/`      | Viewer chrome, reading layout, branding, and responsive navigation. Do not put document packaging here.                                                                                                                                                                                                                                     |
| `src/render/page.ts`     | Doctype, head, embedded delivery assets, favicons, and the final inert HTML envelope.                                                                                                                                                                                                                                                       |
| `src/review/`            | Local review persistence, loopback transport, agent exchange, staged plan mutation, causal snapshot diffs, the service that answers saved review links under `service/`, and the browser interaction island. Keep browser-only React under `browser/`, browser-safe contracts under `shared/`, and Node-owned runtime behavior at the root. |
| `src/shell-quoting/`     | POSIX-shell argument quoting, shared by every surface that prints a command a person can run. Keep it a pure string rule with no product concept in it.                                                                                                                                                                                     |
| `src/icons/`             | Framework-neutral Lucide icon data. Add one catalog-named file per glyph; adapt it to HAST or React only at the relevant rendering edge.                                                                                                                                                                                                    |
| `scripts/` and `assets/` | Authored build-time inputs and the generators that embed CSS and branding. Generated modules are derived outputs.                                                                                                                                                                                                                           |
| `examples/`              | Valid, realistic plan sources shared by authors, tests, and documentation. Add the smallest example that demonstrates an author-facing contract.                                                                                                                                                                                            |
| `test/`                  | Critical browser journeys over complete rendered documents, plus the behavioral probes under `test/probes/`. Keep pure behavior in colocated unit tests.                                                                                                                                                                                    |
| `docs/`                  | Current product orientation and capability discovery for humans, plus usage and authoring guidance for agents. The subsystem definitions and boundary rules live in `docs/subsystems.md`; otherwise, docs do not own internal source-placement rules.                                                                                       |

Use these placement tests:

- A public CLI action belongs in `src/cli/<command>/`; shared input and output safety belongs in `src/cli/_shared/`.
- A built-in component belongs in `src/components/<component>/`; internal visual support that plan authors cannot use belongs in the appropriate underscore-prefixed support folder.
- A validate-only authoring-quality check belongs in `src/lint/rules/`; structural acceptance remains in the renderer and component compilers.
- Document-wide parsing, transformation, or delivery behavior belongs in `src/render/`; component-specific validation and presentation stay with the component.
- Reading and navigation chrome belongs in the shell; doctype, head, and embedded packaging belong in the page envelope.
- Local comments, agent exchange, snapshot comparison, and review-only browser behavior belong in `src/review/`; shared browser-server contracts stay framework-free.
- Anything that writes the authoritative plan source belongs behind `src/review/staged-plan-mutation.ts`; no other module may write that file.
- A pure rule gets a colocated unit test; only a critical integrated reading journey gets a Playwright spec in `test/`.
- A public authoring change updates its validated example and the appropriate human or agent-facing product documentation.

## Subsystems

[docs/subsystems.md](docs/subsystems.md) owns the subsystem partition Big Plan's product work is organized into: how many there are, their names, what each one covers, its code anchors, and the boundary rules between them.

State which subsystem new work belongs to before starting it; when work spans more than one, say so explicitly.

## Pre-release compatibility

Big Plan has no compatibility contract before an explicit milestone establishes one.
Prefer the cleanest model across the CLI, plan source, machine-readable JSON, and rendered output instead of preserving an earlier shape through shims, aliases, or migrations.

When making a breaking change, update every repository call site, test, example, generated artifact, and document in the same change.
Add compatibility behavior only after an explicit milestone defines the contract that must be preserved.

## Documentation map

Keep `AGENTS.md` as the entry point; `CLAUDE.md` is a harness shim back to this guide.
Satellite guidance points back here before giving local detail.

### Where a fact lives

Every guidance fact has exactly one owning layer; everywhere else points to the owner instead of restating it.
Route by the kind of fact:

- A fact about one file lives in that file's header comment; a fact a check enforces lives in the check and its error message.
- Current product capabilities and human or agent usage guidance live in `docs/`.
- How the product looks, and the scales and rules a visual decision picks from, live in [_internal/DESIGN_PRINCIPLES.md](_internal/DESIGN_PRINCIPLES.md); token values stay in `src/render/global.css`.
- Setup, build, run, and shortest-path usage procedures live in the root [README.md](README.md).
- DCO, branches, pull requests, CI expectations, and other contribution workflow live in [CONTRIBUTING.md](CONTRIBUTING.md).
- The vulnerability-reporting policy and Big Plan's security posture live on the docs site's Security page; the repo-root [SECURITY.md](SECURITY.md) points there and never restates it, because GitHub reads that file to offer its reporting affordance.
- A directory-scoped, multi-file, unenforced placement boundary lives in that directory's `README.md` local map.
- An architectural decision and its rationale live in an ADR when the decision needs a durable record.
- A repeatable whole-task workflow becomes a skill only after the workflow has repeated and proven easy to get wrong.
- How to measure what a real coding agent decides after reading text Big Plan wrote for it lives in [test/probes/README.md](test/probes/README.md); probes are evidence for prompt changes, never CI tests.
- The installable Big Plan agent skill shell is authored at `assets/skill/SKILL.md`, embedded by `scripts/gen-skill.mjs`, and delivered by `big-plan skill`; live authoring rules stay in `big-plan guidance` (see `docs/src/content/docs/for-agents/use-the-skill.md`).
- Future work, sequencing, and delivery status live in temporary planning artifacts or issue tracking.
- The seven-subsystem partition, including its code anchors and boundary rules, lives in [docs/subsystems.md](docs/subsystems.md).
- Product orientation, cross-directory architecture outside the subsystem partition, repository-wide vocabulary, and cross-cutting conventions with no deeper owner live in this guide.
- The gold-standard plan-quality testing workflow (context-free generation, co-refine, backport, re-verify) lives in this guide under [Gold-standard plan-quality testing](#gold-standard-plan-quality-testing).

### README principles

`README.md` files inside the source tree are local maps at decision points; they are never policy.
A local map contains a pointer to this guide, an ownership boundary, and only the directory-local decisions needed to place a change.
Hold every sentence to these principles:

1. **Earn existence.** Keep a local map only when the parent guidance plus the directory tree cannot answer a real placement question.
2. **One fact, deepest owner.** Put each fact at the deepest layer that owns it, exactly once.
3. **Nothing derivable.** Remove statements that merely restate a parent convention, the ownership paragraph, or the visible tree.
4. **Point, never restate.** Name another owner without summarizing content that could drift.
5. **No inventories, no current-state narration.** Describe stable boundaries, not the present list or count of files and folders.

Guidance is demand-driven: add a document, rule, or map entry only after an agent observably failed or had to ask something the repository should already answer.

## Engineering practices

Read and follow [_internal/ENGINEERING_PRACTICES.md](_internal/ENGINEERING_PRACTICES.md) for the authoritative coding, comments, error-handling, logging, testing, browser-runtime, styling, and tooling practices.
Mechanically enforced facts remain owned by their checks.

## Testing

Before adding a feature, fixing a bug, or adding or changing tests, read [_internal/TESTING.md](_internal/TESTING.md).
It owns the judgment framework for which tests earn their place and which test layer to use.

## Design

Read and follow [_internal/DESIGN_PRINCIPLES.md](_internal/DESIGN_PRINCIPLES.md) before changing anything a reader sees.
It owns the spacing, type, colour, and elevation scales, and the rules for picking a step from each.
Engineering practices own how to write the styling code; the design principles own what to write.

## Gold-standard plan-quality testing

This section owns the durable procedure for improving Big Plan's plan quality as a product.
It is not unit testing, Playwright journey testing, or ordinary contribution verification.
Those remain under [Engineering practices](#engineering-practices), `test/`, and [CONTRIBUTING.md](CONTRIBUTING.md).
Current product capabilities and authoring guidance remain in `docs/`; point there rather than restating them.
The evaluation bar for plan quality is the two [plan-quality standards](#plan-quality-standards): pleasant to read, and understandable.

### What "good" means

The gold standard for working on Big Plan quality is:

1. A **context-free agent** (no prior conversation about the desired plan shape, and no private author or project preferences beyond what Big Plan itself teaches) uses Big Plan to produce a plan.
2. A human evaluates whether that plan, produced **solely via the tool**, meets Big Plan's plan-quality standards: pleasant to read, and understandable.
3. Feedback from that evaluation is used to improve Big Plan itself, not only to patch one plan for one task.

Re-running full context-free generation after every small product improvement is intentionally expensive.
Do not treat it as a cheap inner loop.
The practical workflow is therefore two parts: refine a generated plan cheaply, then backport durable improvements into the product and re-run context-free generation as the expensive verification step.

### Part A - Generate, then co-refine a plan (cheap loop)

Use this loop to design the quality bar for a chosen scenario without paying for a clean re-generation on every edit.

1. Start from Big Plan **status quo** (current main, or the current published behavior you intend to improve).
2. Have a **context-free agent** generate an initial plan for the chosen scenario using Big Plan only.
   Do not seed that agent with the desired plan shape, private acceptance criteria, or prior refinement conversation.
3. Work with a normal (context-rich) agent to improve that plan until it reflects the plan-quality standards for the scenario.
   Edits may include the plan source (MDX) and, when useful for speed, direct edits to the rendered HTML review document.
   Example of a speed edit only: renumber acceptance criteria as AC1, AC2, and so on in the review document while shaping the bar.
   That numbering example is illustrative of a presentation standard you might want later; it is not a claim that the product already enforces it.
4. Stop when the plan is a **reference-quality artifact** for the scenario: it encodes the acceptance criteria and presentation standards you want Big Plan to produce next time without hand-editing, and it is both pleasant to read and understandable.

Part A evaluates and designs the target.
It does **not** prove that Big Plan, unaided, will produce that quality on a fresh run.

### Backport handoff from Part A to Part B

Treat contributor language such as "this looks good, let's backport" as the handoff from Part A into Part B: the refined plan is good enough, so durable improvements should move into the product and be re-verified.
Until that handoff (or an equivalent explicit decision by the author or contributor to improve the product), keep changes in the plan refinement loop rather than treating hand-edits as product proof.

### Part B - Backport into Big Plan, then re-verify (expensive proof)

Use this loop to make durable product improvements and prove them with a clean generation.

1. Backport every durable improvement from the refined reference plan into the **Big Plan product** wherever that behavior is owned.
   Owners may include authoring guidance, lint rules, components, examples, install or setup docs, agent-facing prompts, and related surfaces under the [documentation map](#documentation-map) and [source ownership](#source-ownership-and-placement).
   Push each fix down to the strongest product layer that can own it: prefer a primitive default, then a compile diagnostic, then lint, and leave only irreducible judgment in guidance.
2. Run **context-free plan generation again** with the updated tool: a clean agent, the same scenario intent, and no carrying over of the hand-refined plan text.
3. Compare the newly generated plan against the refined reference and the plan-quality standards (pleasant to read, and understandable), using the latest acceptance criteria for the scenario.
4. If the new plan still falls short, either refine the reference further (return to Part A as needed) or continue product changes.
   Do not treat hand-edits alone as proof the tool improved.

Full context-free re-generation is the expensive verification step.
Run it when you need evidence that the product, not the conversation, now produces the desired quality.
Do not re-run it after every small product edit; batch durable changes, then pay for the clean proof when the backport set is ready to evaluate.

### Out of scope for this workflow

- Ordinary unit tests and Playwright engineering tests already described elsewhere in this guide.
- A full automation harness for context-free runs.
  Document and follow the procedure first; tooling can come later if the manual loop proves too costly.
- Speculative product changes made only because they appeared as examples in a refined plan.
  For example, implementing numbered acceptance criteria (AC1, AC2, ...) would be a future feature that **uses** this workflow; it is not part of documenting the workflow.

## Generated sources

Edit authored inputs, run their generator, and never hand-edit generated output.
Generated files carry `.generated.` in their name and are committed beside the source change so the repository remains scannable without a build.

- `src/render/global.css` and its imported styles are authored inputs to the generated embedded stylesheet.
- Logos and favicons under `assets/` are authored inputs to the generated embedded branding module.
- Font binaries under `assets/fonts/` are authored inputs to the generated embedded `@font-face` stylesheet; [`assets/fonts/README.md`](assets/fonts/README.md) owns their licensing record.
- `assets/skill/SKILL.md` is the authored input to the generated skill module consumed by `big-plan skill`.
- `assets/guidance/plan-guidance.md` and component `*.guidance.md` files are authored inputs to the generated guidance module.

The root README owns generation commands; CI detects drift.

## Contribution guardrails

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the normal branch, commit, pull-request, and verification workflow.
Two CI gates decide whether a pull request may merge, and both are satisfied by structured comments rather than by pushing: see [Merge gates](CONTRIBUTING.md#merge-gates) for the exact formats and when to post them.
Before editing, inspect the working tree and preserve changes you did not create.
Keep each change scoped to its approved purpose, and never repair unrelated work as a side effect.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
