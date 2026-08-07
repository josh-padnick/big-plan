<!--
Owns Big Plan's detailed coding, testing, diagnostics, logging, browser-runtime, and styling practices.
Repository orientation and source placement stay in AGENTS.md; mechanically enforced details stay with their checks.
-->

# Engineering Practices

These practices were distilled from [`fabricahq/app`](https://github.com/fabricahq/app) at `origin/main` `bd48a1da` (2026-07-08), then adapted for Big Plan's TypeScript and Bun toolchain, static rendering edge, and vanilla-JavaScript document viewer.
That repository is provenance, not a dependency.

Read [AGENTS.md](AGENTS.md) first for product orientation, vocabulary, architecture, source placement, and contribution guardrails.
This file is the authoritative review standard for authored code, configuration, tests, and engineering documentation.
Generated files are exempt because their generators own them.
Exact mechanically enforced behavior lives in `eslint.config.mjs`, `tsconfig.json`, the stylesheet-contract and design-system checks, and the test harness.

Apply these practices to every new or changed line.
Existing deviations do not weaken the standard, but broad migrations belong in separately scoped changes.

## Design for one owner and one direction

- Give every concept one owner.
  Do not duplicate business rules, validation, rendering semantics, or derived contracts in a second module for convenience.
  Generate repeated representations from the authoritative contract when practical.
- Keep dependencies directed inward and downward.
  A lower-level module must not know which command, component, or pipeline stage calls it.
  Follow the dependency allow-list in `eslint.config.mjs` and the placement rules in [AGENTS.md](AGENTS.md).
- Prefer a deep module: a small, stable public interface that hides substantial implementation detail.
  Do not expose a sequence of internal steps that every caller must reproduce.
- Colocate behavior by the product concept that owns it.
  Component-specific compilation, presentation, and tests stay in that component slice; reusable mechanics move only when they have a genuinely broader owner.
- Keep pure decisions separate from I/O and presentation.
  Parsing, sanitizing, formatting, sorting, diffing, geometry, and branching belong in pure modules; commands and views should remain thin orchestration.
- Make invalid states hard to represent.
  Prefer types and constructors that enforce invariants over scattered defensive checks at each use site.
- Avoid speculative abstractions.
  Extract a shared seam when it gives one policy a single owner, not merely because two code fragments currently look similar.

Record a durable architecture decision when future contributors need its context and trade-offs to avoid reopening it.
An ADR should state its status, context, decision, rationale, rejected alternatives, and consequences.
Amend the record when the decision changes; do not rewrite history to make the original choice look inevitable.
Keep procedures and coding rules here or with their deeper owner rather than turning ADRs into onboarding guides.

## TypeScript

### Preserve type information

- Use `unknown`, never `any`, at untrusted or ambiguous boundaries.
  Narrow it with runtime checks before use.
- Do not use non-null assertions or type assertions to silence the compiler.
  Prove the value's shape, narrow it, or repair the type boundary.
  A third-party type mismatch is an exceptional case and requires an adjacent rationale.
  Const assertions that preserve literal data are allowed.
- Use `@ts-expect-error` rather than `@ts-ignore` for an unavoidable compiler suppression, and include a description explaining why the error is expected.
  The suppression should fail when the underlying error disappears.
- Annotate return types for exported functions and boundary functions.
  Within a private implementation, prefer inference unless an annotation narrows the value, documents a contract, or prevents accidental widening.
- Separate type imports with `import type`.
  This keeps runtime dependencies distinct from erased type dependencies.
- Generate service and delivery types from authoritative schemas or contracts when one exists.
  Hand-maintained copies drift.

### Model data explicitly

- Prefer type aliases.
  Use an interface only when declaration merging or an intentional extension boundary is the requirement.
- Prefer literal unions to enums.
  They erase at runtime and compose naturally with const data.
- Model correlated variants as discriminated unions and handle them exhaustively.
  Use a union instead of several booleans or unrelated optional fields that can form incoherent combinations.
- Make object properties and function arguments required by default.
  Represent meaningful absence explicitly; do not grow catch-all APIs with many optional switches.
- Use `null` for explicit absence and `undefined` for omission or a value that does not exist.
  Do not use them interchangeably.
- Use template-literal types for structured string contracts such as prefixed identifiers when the pattern is meaningful to callers.
- Preserve typed constants with `as const`; when a broader contract exists, combine it with `satisfies` so the value is validated without losing literal inference.
- Use `Boolean(value)` for intentional truthiness coercion.
  It is clearer and more searchable than `!!value`.
- Use `Array<T>` and `ReadonlyArray<T>` consistently for array annotations.

### Keep data and functions predictable

- Prefer immutable inputs and outputs: `const`, `readonly`, `ReadonlyArray<T>`, and new objects or arrays from transformations.
  Mutate only inside a tightly owned performance-sensitive implementation where the benefit is demonstrated.
- Keep functions pure and focused.
  A function should do one coherent job, make its dependencies explicit, and return a value rather than changing distant state.
- Use one object argument when a function needs multiple parameters.
  Name the fields at the call site and keep most fields required.
  Positional arguments remain appropriate for an obvious, stable pair.
- Check cheap synchronous exit conditions before starting asynchronous work.
  Start independent work together with `Promise.all`; defer `await` until the result is needed; never create avoidable waterfall chains.
- Prefer early returns when they remove nesting and make rejected cases clear.
- Choose an algorithm that matches the access pattern: `Set` or `Map` for repeated lookup, one pass instead of repeated scans on a hot path, a direct min/max loop instead of sorting, and a length check before element-wise comparison.
  Do not obscure ordinary code for an unmeasured micro-optimization.

### Keep names and imports navigable

- Use named exports.
  Default exports are reserved for tool-owned entry points that require them.
- Use lowercase kebab-case for authored filenames.
  Keep `.tsx` only for files containing JSX and use established role suffixes such as `.test`, `.generated`, `.config`, and `.d`.
- Name booleans with a predicate prefix such as `is`, `has`, `can`, `should`, or `will`.
  Name types in PascalCase, functions and local values in camelCase, and constants in uppercase snake case.
- Name generic parameters descriptively with a `T` prefix, such as `TNode` or `TResult`, when more meaning than a conventional local `T` is needed.
- Treat acronyms as words in identifiers: `Url`, not `URL`.
  Avoid abbreviations unless they are established domain language.
- Use relative imports within one feature or component slice so it stays movable.
  Use the repository's stable shared import paths for distant owners.
  Import through a module's public seam, not a private nested file.

## Comments and documentation

Start every authored source, configuration, and documentation file with a concise file-level comment explaining what the file owns or why it exists.
Make it concrete enough to identify the behavior or problem, not merely the file kind.
Leave a blank line after it when the format permits.
Generated files are exempt because their headers belong to the generator.

Add a concise comment above every non-trivial function.
Parsing, sanitizing, formatting, synchronization, persistence, diffing, geometry, and multi-branch helpers normally need one; tiny render glue, straightforward setters, and self-explanatory one-liners do not.

Comments explain intent, rationale, invariants, boundary choices, workarounds, or non-obvious failure modes.
Prefer expressive names and structure over comments that restate syntax.
Link an issue or decision when it supplies durable context.
Use TSDoc for a reusable public API when structured IDE-facing documentation materially helps its callers.

Keep documentation facts with their deepest owner.
Point to another owner instead of summarizing it, and update prose in the same change as the behavior or contract it describes.

## Errors and diagnostics

- Treat caught values as `unknown` and normalize them at the boundary that understands the operation.
  Downstream code should reason about a stable project error or diagnostic shape, not raw thrown values.
- Give machine-consumed failures a stable code and keep presentation copy separate from dispatch logic.
  A title names the attempted operation; detail explains what failed; suggestions give concrete next actions.
- Preserve useful diagnostic context while an error crosses layers: the operation, safe identifiers, source location, and underlying cause.
  Do not discard the original stack or replace a specific error with an unexplained generic one.
- A layer either handles an error or adds context and propagates it.
  It does not log and rethrow the same failure.
  Report once at the outer boundary that has the complete context.
- Distinguish expected contract failures from defects.
  Invalid author input should produce a focused actionable diagnostic; an invariant failure should remain visibly internal rather than masquerading as author error.
- Sanitize secrets and sensitive plan content before it enters an error model, and sanitize again at rendering, serialization, or copy boundaries for defense in depth.
  Never include tokens, credentials, authorization data, cookies, or full authored content in diagnostics.
- Write user guidance as concrete, blame-free actions without implementation internals.
  Developer guidance may name exact commands, paths, or checks, but keep it in a channel not shown as end-user advice.
- A successful empty result is not an error.
  Render or serialize it as the smallest empty-state contract that owns it.

## Logging and operational output

Every emitted line must answer: who reads this, and what can they do about it?
If nobody acts on the line, even in aggregate, it is noise.

Keep three concerns separate:

- **Operational output** tells a human what a process did.
- **Error reporting** counts and groups failures for machines.
- **Metrics** record measured numbers and timings.

Do not use one as a substitute for another.
Use these levels consistently when a logging surface exists:

- `debug`: developer tracing, disabled by default and allowed to be chatty.
- `info`: normal lifecycle or operation milestones a human uses to confirm health.
- `warn`: degraded but self-healing behavior whose trend deserves attention.
- `error`: an unexpected failure that needs human action.

Never log secrets, plan bodies, request payloads, or other user-authored content.
Prefer safe identifiers, counts, lengths, statuses, and durations.

Log once at a boundary: the CLI command adapter, process lifecycle, or a background task with no caller.
Library, renderer, component, and lint modules return values or errors and do not write directly to stdout, stderr, or `console`.
CLI and generator entry points may own deliberate output; the viewer may report an unexpected browser failure only at its bootstrap or event-dispatch boundary.
Do not log from repeatable rendering or DOM-update helpers.

Use a scoped output or logging facade when output has more than one producer so readers can filter by subsystem and policy remains centralized.
Correlate related diagnostics with an operation identifier when one is available.

## Testing

Automated tests are the safety system that makes fast change possible.
The build must remain self-testing, and a red build is fixed immediately or the change is backed out.

Choose tests by balancing the likelihood of a defect, the cost of that defect, and the maintenance cost of the test.
A test earns its place only when it would fail on a plausible regression.
Do not retest a framework, assert that a mock returns its fixture, or chase a coverage number.

Use the lowest-cost rung that proves the behavior:

1. **Unit tests** for pure TypeScript logic, colocated as `*.test.ts` or `*.test.tsx` and run by Vitest.
2. **Contract and drift checks** for generated outputs, stylesheet invariants, architecture, and other repository-wide mechanical contracts.
3. **Build and integration tests** for complete compilation and interactions across owned module boundaries.
4. **Playwright journeys** for critical behavior in a complete rendered document that no lower rung can prove.

Follow these authoring rules:

- Extract parsing, sanitizing, formatting, diffing, ordering, geometry, and branching into pure modules and test them there.
  Do not introduce a DOM unit-test stack to avoid making a decision pure.
- Fix every escaped bug with a failing-first regression test at the lowest rung that reproduces it.
  Confirm it fails for the reported reason before applying the fix.
- Assert public behavior and user-visible outcomes, not private calls or incidental representation.
  A behavior-preserving refactor should not force broad test rewrites.
- Cover empty, single-item, maximum, malformed, boundary-adjacent, self-referential, duplicate, and ordering cases where they apply.
  A happy path alone is not sufficient for collection, positional, or relational logic.
- Name tests `should ... when ...` so the promised behavior and triggering condition are visible from the title.
- Avoid broad serialized snapshots.
  Prefer focused assertions that tell the reviewer what changed.
  The visual style-history system is a deliberate pixel-contract workflow governed by [CONTRIBUTING.md](CONTRIBUTING.md), not a general-purpose unit snapshot pattern.
- Mock only an external boundary such as filesystem, process, or browser I/O; do not mock internal modules to manufacture an implementation-shaped test.
- Keep browser specs independent and use user-facing roles, accessible names, and stable domain-scope identifiers.
  Use `data-*` attributes for unambiguous domain or component scoping when role and name alone cannot identify the scope, then locate controls within it by role and accessible name and assert their native or `aria-*` state.
  Use Playwright's auto-waiting actions and web-first assertions, never arbitrary sleeps.
- Every browser spec imports the repository fixture rather than `@playwright/test` directly so console errors and page failures remain part of the contract.
- Add a browser journey only for a critical reader flow, cross-feature composition, or a regression no lower rung can express.
  Keep long journeys readable with named `test.step` phases.

Run the focused test while iterating, then the contribution checks in [CONTRIBUTING.md](CONTRIBUTING.md) before delivery.
Generated drift is fixed by changing the authored input and regenerating, never by editing generated output.

## Browser runtime and UI

The delivered review document has a vanilla-JavaScript browser runtime.
Do not introduce React or another client framework into it.
Existing React code is a static presentation-edge implementation detail; browser state and interaction rules must remain framework-neutral.

- Keep rendering pure and put side effects in explicit event or lifecycle handlers.
  Each piece of state has one owner; derive secondary values rather than synchronizing duplicate mutable copies.
- Prefer native semantic elements.
  Every interactive element needs the correct role, an accessible name, keyboard operation, and visible focus.
  Expose control state through native semantics or the appropriate `aria-*` attribute.
  Use `data-*` only as an optional styling, scripting, or stable Playwright-scoping hook; never rely on it to communicate state to assistive technology.
  Do not rely on color alone.
- Give reusable UI modules capability names, not names coupled to their first caller.
  Express materially different modes as explicit variants rather than proliferating boolean flags.
- Register global event listeners once, remove them when their owner is disposed, and keep handler identity stable.
  Mark touch and wheel listeners passive when they never call `preventDefault`.
- Batch DOM reads before DOM writes to avoid layout thrashing.
  Defer non-critical work with the browser's scheduling primitives, load heavy or optional modules only when needed, and use statically analyzable asset paths.
- Keep user input responsive.
  Preload only on clear user intent, preserve context across mode changes, and make pending, success, failure, disabled, and selected states explicit.
- If a future reader surface waits on asynchronous data, its pending UI should mirror the loaded layout rather than replace it with plain "Loading..." text.
  Preserve the page structure so content arrival does not shift the reader's context.
- Version and minimize persisted browser state.
  Validate it when reading, tolerate corrupt or older values, and store preferences or identifiers rather than content that can be derived or may be sensitive.
- Build desktop and narrow-screen behavior together.
  Interactive touch targets on phone-sized surfaces should be at least 44 by 44 CSS pixels, and text-like inputs must compute to at least 16 CSS pixels to prevent mobile focus zoom.
- Respect reduced-motion preferences.
  Scripts enhance a fully readable inert document; no plan-authored content may become executable, and core reading must remain available with scripts disabled.

### Styling owned markup

The default is Tailwind utility classes colocated with the markup being edited.
Before using CSS, apply three tests to every declaration:

1. **Owned.** Does the view own the element that would carry the class?
   Generated Markdown and syntax-highlighter tokens fail because their elements are emitted downstream.
2. **Discoverable.** Does the complete Tailwind candidate appear statically in source?
   Statically named runtime variants such as `data-[collapsed]:hidden` pass; dynamically constructed candidates such as `` `opacity-${value}` `` fail.
   For a finite choice, use a lookup containing complete candidate strings.
3. **Local and legible.** Does the class explain the element and its condition without making a reviewer execute DOM traversal or a selector program?
   Short variants such as `before:block`, `has-[img]:p-4`, `print:hidden`, `motion-reduce:transition-none`, and `@sm:grid` can pass.
   Framework support alone does not make a long arbitrary variant maintainable.

A rule that passes all three tests should normally use Tailwind utilities.
Runtime state is not by itself a reason to use CSS.
Style native or accessible state with the corresponding native or `aria-*` selector when it represents that state, and use `data-*` only for presentation or script state that has no native or ARIA contract.
Keep every complete candidate static.

CSS is the escape hatch for externally owned or generated markup, document-wide behavior, token or keyframe definitions, a selector relationship that is clearer as a selector, a shared visual primitive with no authored element of its own, or a case where utilities make local markup materially less legible.
Component CSS requires a concrete ownership, selector, primitive-definition, document-wide, or readability reason - not merely state, a pseudo-element, `:has()`, print, motion, or a container query.

State the reason in the stylesheet's file-level `CSS escape hatch:` comment.
Ordinary escape-hatch rules belong to `components` and yield to utilities; only a state invariant that must beat resting utilities belongs to `bp-state`, with an adjacent `Override invariant:` comment naming what it must override.
The stylesheet-contract check owns the exact enforced syntax and allowed layer exceptions.

Keep design tokens, shared keyframes, and true document-wide resets in their global owner.
Keep layout, spacing, typography, cursor, hover, focus, and component state visible with the owned markup whenever the three tests pass.
Use Lucide icons through the framework-neutral catalog in `src/icons/lucide/`; never define component-local icon paths.

## Tooling and generated sources

- Keep TypeScript strict.
  Do not weaken `tsconfig.json` to make a change compile; fix the boundary or model.
- Prettier owns formatting.
  ESLint owns code quality, architecture, and mechanically enforceable conventions; do not create overlapping formatter rules.
- Treat lint and type errors as design feedback, not obstacles to suppress.
  New architectural scopes must be added to the completeness model rather than bypassing it.
- Edit authored inputs and run their generator.
  Never hand-edit a `.generated.` file or another output identified as generated.
- Keep the verification loop fast enough to run on every change.
  Prefer a generator, contract check, or lint rule over repeated handwritten wiring tests when it can eliminate an entire drift class.
