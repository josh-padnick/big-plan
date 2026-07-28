# Big Plan agent guide

This is the entry point for agents working in Big Plan.

## Product

Good AI output depends on a great plan, and Big Plan makes reviewing agent plans a first-class experience.
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
- **Plan source** is the authoritative plan document on disk. The agent edits this source in response to feedback.
- **Review document** is Big Plan's human-friendly presentation of the plan source.
- **Plan review** is the conversation in which the human works to understand the proposed approach, gives feedback, and resolves concerns with the agent.
- **Plan acceptance** is the human's explicit decision that the intended approach is understood well enough for the agent to begin execution. It is not acceptance of the finished deliverable, which happens later.

## Technical concepts

- **Static-subset MDX** is the authoring format accepted by Big Plan: Markdown plus registered components, without executable imports, exports, or expressions.
- **Component** is a built-in MDX element that presents a specific kind of plan information in an opinionated, review-friendly way, such as a decision, code diff, schema, or file tree.
- **Plan model** is the machine-readable description of a plan: its title and sections plus the validated data for each component in source order.
- **Review shell** is the reading and navigation surface around rendered plan content.
- **Page envelope** packages the shell and rendered content as a self-contained HTML document with its head and embedded assets.

Keep these distinctions explicit.
Authored MDX is not the plan model, serialized model JSON is not the review document, and the shell is not the page envelope.

## Architecture at a glance

Big Plan compiles once and delivers twice:

```text
MDX plan source
  -> CLI command
  -> static-subset parsing and authoring validation
  -> registered-component validation and interpretation
     -> model continuation -> plan-model JSON
     -> HTML continuation -> React view -> HAST -> document transforms
        -> review shell -> page envelope -> review document
```

Each component validates its authored attributes and content into plain data describing what it should show.
Machine delivery collects that data in the plan model.
Human delivery gives the same data to the component's React view, crosses one React-to-HAST boundary, applies document-wide transforms, and packages inert HTML.
React is a presentation-edge implementation tool; no React runtime or browser script ships in a rendered document.

Dependencies follow ownership inward: the CLI owns public command I/O, the renderer owns document-wide compilation and delivery, and component slices own authorable concept behavior.
The exact dependency allow-list and completeness guard live in `eslint.config.mjs`.

## Source ownership and placement

| Owner                    | Responsibility and placement rule                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/`               | Public command dispatch, safe derived-output workflows, errors, and result serialization. Give each public command a non-underscored folder; keep reusable command mechanics in `_shared/` and business semantics below the CLI.            |
| `src/components/`        | Authorable plan concepts as vertical slices. Put a new authorable concept in its own folder and follow the infrastructure boundaries in the [components local map](src/components/README.md).                                               |
| `src/render/`            | Pure document compilation and delivery orchestration. Put cross-document pipeline behavior here and follow the stage boundaries in the [renderer local map](src/render/README.md); keep component-specific behavior in its component slice. |
| `src/render/shell/`      | Viewer chrome, reading layout, branding, and responsive navigation. Do not put document packaging here.                                                                                                                                     |
| `src/render/page.ts`     | Doctype, head, embedded delivery assets, favicons, and the final inert HTML envelope.                                                                                                                                                       |
| `src/icons/`             | Framework-neutral Lucide icon data. Add one catalog-named file per glyph; adapt it to HAST or React only at the relevant rendering edge.                                                                                                    |
| `scripts/` and `assets/` | Authored build-time inputs and the generators that embed CSS and branding. Generated modules are derived outputs.                                                                                                                           |
| `examples/`              | Valid, realistic plan sources shared by authors, tests, and documentation. Add the smallest example that demonstrates an author-facing contract.                                                                                            |
| `test/`                  | Critical browser journeys over complete rendered documents. Keep pure behavior in colocated unit tests.                                                                                                                                     |
| `docs/`                  | Current product orientation and capability discovery for humans, plus usage and authoring guidance for agents. It does not own internal source-placement rules.                                                                             |

Use these placement tests:

- A public CLI action belongs in `src/cli/<command>/`; shared output safety belongs in `src/cli/_shared/`.
- An authorable MDX concept belongs in `src/components/<concept>/`; a never-authorable visual primitive does not.
- Document-wide parsing, transformation, or delivery behavior belongs in `src/render/`; component-specific validation and presentation stay with the component.
- Reading and navigation chrome belongs in the shell; doctype, head, and embedded packaging belong in the page envelope.
- A pure rule gets a colocated unit test; only a critical integrated reading journey gets a Playwright spec in `test/`.
- A public authoring change updates its validated example and the appropriate human or agent-facing product documentation.

## Pre-release compatibility

Big Plan has no compatibility contract before an explicit milestone establishes one.
Prefer the cleanest model across the CLI, plan source, plan model, and rendered output instead of preserving an earlier shape through shims, aliases, or migrations.

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
- Setup, build, run, and shortest-path usage procedures live in the root [README.md](README.md).
- DCO, branches, pull requests, CI expectations, and other contribution workflow live in [CONTRIBUTING.md](CONTRIBUTING.md).
- A directory-scoped, multi-file, unenforced placement boundary lives in that directory's `README.md` local map.
- An architectural decision and its rationale live in an ADR when the decision needs a durable record.
- A repeatable whole-task workflow becomes a skill only after the workflow has repeated and proven easy to get wrong.
- Future work, sequencing, and delivery status live in temporary planning artifacts or issue tracking.
- Product orientation, cross-directory architecture, repository-wide vocabulary, and cross-cutting conventions with no deeper owner live in this guide.

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

## Engineering rules

The rules in this guide are authoritative for Big Plan.
They were adapted from the TypeScript and Playwright guidance in `fabricahq/app/_rules`; that repository is provenance, not a dependency required to contribute here.

Facts enforced mechanically live with their checks.
`eslint.config.mjs` owns the separate-type-import, `any`, non-null-assertion, architectural-layering, source-completeness, and Playwright-fixture enforcement.

Apply these review conventions by judgment:

- Use named exports, type aliases rather than interfaces, literal unions rather than enums, and `unknown` rather than `any`; do not use type assertions.
- Use a single object argument for multi-parameter functions and prefer immutable data (`readonly`, `const`).
- Colocate code and tests by feature, use kebab-case file names, and keep component-specific behavior inside its component slice.
- Start every authored source file with a file-level comment saying what it owns or why it exists.
  Give every non-trivial function a concise description; comments explain why, not what.
- Use Lucide for icons and keep framework-neutral glyph data in `src/icons/lucide/`; components never define icon paths locally.
- Author component markup with Tailwind utilities where practical.
  Reserve stylesheets for variants, state, pseudo-elements, live-application-created elements, and plain generated markup that cannot carry utility classes.
- Keep logic in pure modules and unit-test it there.
  Reserve Playwright for critical user journeys.
- Write focused, user-oriented tests with `should ... when ...` descriptions and coverage of degenerate and boundary cases.
- Structure long browser journeys as named `test.step` phases so the test reads as a story and a failure names its phase.

## Generated sources

Edit authored inputs, run their generator, and never hand-edit generated output.
Generated files carry `.generated.` in their name and are committed beside the source change so the repository remains scannable without a build.

- `src/render/global.css` and its imported styles are authored inputs to the generated embedded stylesheet.
- Logos and favicons under `assets/` are authored inputs to the generated embedded branding module.

The root README owns generation commands; CI detects drift.

## Contribution guardrails

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the normal branch, commit, pull-request, and verification workflow.
Before editing, inspect the working tree and preserve changes you did not create.
Keep each change scoped to its approved purpose, and never repair unrelated work as a side effect.
