# Testing at Big Plan

Start with [AGENTS.md](../AGENTS.md) for Big Plan product orientation, domain vocabulary, architecture, and repository conventions.
This document owns the testing philosophy and the choice of test layer.

## Philosophy: agility requires safety

Big Plan follows the argument in Yevgeniy Brikman's "Agility Requires Safety": **you cannot go faster by being reckless - speed is limited by safety.**
A car can drive fast because it has brakes.
Automated tests are the brakes for software.
A self-testing build catches a bad change before it reaches a user.
That safety gives us confidence to change the product quickly.

Three principles follow.

1. **The build is self-testing.**
   CI runs `bun run lint`, `bun run build`, `bun run test`, and `bun run test:e2e` for every pushed branch.
   A red check is fixed quickly or the change is backed out.
   Keep commits small so each failure is easy to understand, bisect, and revert.
2. **What to test is a trade-off.**
   Weigh three factors:
   - **Likelihood of a bug.**
     Parsing, validation, compilation, state transitions, and browser interaction have more risk than declarative glue.
   - **Cost of a bug.**
     Wrong plan output, lost review feedback, broken validation, and unreadable rendered content have high cost.
   - **Cost of the test.**
     Pure unit tests are cheap.
     Cross-module and CLI tests cost more.
     Browser tests cost the most to write, run, and maintain.
     Add enough tests for the risk.
     Do not spend test cost where the risk is low.
3. **Tests are code, and code is the enemy.**
   Every test has a maintenance cost.
   A test earns its place only if it would fail on a plausible real regression.
   Do not restate the implementation, test the framework, or chase a coverage number.
   Delete tests that do not protect a meaningful behavior.

## The Big Plan test ladder

Use the lowest rung that can prove the behavior.
A bug caught by a pure module test does not need a browser journey as a second guard.

| Rung                                     | Use it for                                                                                                                                                         | Big Plan examples                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Pure TypeScript unit test             | Parsing, sorting, formatting, diffing, geometry, and other decisions with no I/O. Colocate the test as `*.test.ts` or `*.test.tsx`.                                | [`src/components/data-table/parse-table-grid.test.ts`](src/components/data-table/parse-table-grid.test.ts) checks valid and malformed table grids, empty data, duplicate headers, and escaped pipes. [`src/components/database-table-schema/parse-table-schema.test.ts`](src/components/database-table-schema/parse-table-schema.test.ts) checks schema grammar and diagnostics.                      |
| 2. Component and compiler contract test  | A component's authored attributes or body must become the correct model, markup contract, or diagnostic. Keep the test in the component slice.                     | [`src/components/database-table-schema/definition.test.ts`](src/components/database-table-schema/definition.test.ts) checks authored schema content, keys, indexes, DDL, and invalid attributes. [`src/components/code-diff/definition-diagnostics.test.ts`](src/components/code-diff/definition-diagnostics.test.ts) checks author-facing diagnostics.                                               |
| 3. CLI and cross-module integration test | A complete command must combine parsing, compilation, linting, output safety, and command-specific results. Use temporary files and assert the public result.      | [`src/cli/validate/command.test.ts`](src/cli/validate/command.test.ts) proves no-write validation, lint failure, diagnostic parity, and the guidance gate. [`src/cli/render/command.test.ts`](src/cli/render/command.test.ts) proves HTML delivery and refusal to write on invalid or lint-failing plans. [`src/cli/compile/command.test.ts`](src/cli/compile/command.test.ts) proves the JSON model. |
| 4. Repository contract check             | Generated-source drift, stylesheet rules, design-system rules, and other mechanical contracts that span files. Prefer a check that removes a whole class of drift. | [`scripts/style-contract/check.test.mjs`](scripts/style-contract/check.test.mjs) checks stylesheet ownership and allowed structure. [`scripts/design-system/check.test.mjs`](scripts/design-system/check.test.mjs) checks design-system contracts. Run them through `bun run test` and `bun run lint`.                                                                                                |
| 5. Playwright browser journey            | A critical reader flow, cross-feature composition, or regression that lower rungs cannot express. Use the complete rendered document and the repository fixture.   | [`test/commenting-runtime.spec.ts`](test/commenting-runtime.spec.ts) proves staged comments through the local review runtime. [`test/navigation.spec.ts`](test/navigation.spec.ts) proves rendered-plan navigation. [`test/components.spec.ts`](test/components.spec.ts) checks readable content and dormant controls with JavaScript disabled.                                                       |

Do not add a higher rung when a lower rung proves the same behavior.
The browser suite is valuable because it tests the delivered review document.
It is also the most expensive brake to maintain.

## What to test where

### When adding a feature

Start with the behavior the feature promises and the failure modes that matter.
Consider invalid MDX, wrong plan models, lost feedback, unsafe output, broken reader navigation, and unreadable content.
Then add the smallest set of tests that proves those risks.

- **New pure logic:** extract the decision into a pure function and add a colocated unit test.
  Do not add a DOM test to avoid creating a test seam.
- **New component or authoring contract:** add component definition or compiler tests for valid models and actionable invalid-input diagnostics.
- **New CLI behavior:** add a command test with temporary input and output paths.
  Assert the public result, output contents, and no-write behavior when relevant.
- **New generated or repository rule:** add a focused contract test beside the check.
  Edit the authored source and regenerate outputs when the rule concerns generated files.
- **New reader flow:** keep rendering and interaction logic testable at lower rungs.
  Add a browser journey only when the flow is critical, composes multiple features, or needs a real browser to prove the behavior.

Run a focused test while iterating.
Before delivery, run `bun run lint`, `bun run build`, `bun run test`, and `bun run test:e2e`.
Use `bun run test`, not `bun test`.
`bun test` invokes Bun's own test runner instead of the package script.

For authoring and delivery checks, use the real CLI commands:

```sh
node bin/big-plan.mjs validate examples/sample.mdx
node bin/big-plan.mjs render examples/sample.mdx
```

`validate` checks compilation and lint without writing an output file.
`render` applies the same lint rules before it writes the self-contained HTML review document.

### When fixing a bug

Write the regression test first.
Put it at the lowest rung that reproduces the bug.
Watch it fail for the reported reason.
Then fix the bug and keep the test.

Every bug that reaches a human is evidence of a missing test or a missing test layer.
Fixing the bug without a regression test leaves the same door open.

### When refactoring

Tests should usually stay unchanged.
If a behavior-preserving refactor breaks many tests, those tests are probably coupled to implementation details.
Move the tests to the public behavior and keep their altitude stable.
Change assertions only when the promised behavior changes.

## Browser journeys (Playwright)

### Add a browser journey when any one of these is true

1. A critical reader journey changed or was added.
   Breakage would make the review product effectively unusable.
2. A regression reached a user and no lower rung can express it.
   Typical examples are routing, loader wiring, browser-only behavior, and cross-component integration.
3. A flow spans multiple features.
   Unit and command tests can pass while the composition fails in the complete rendered document.

### Do not add a browser journey for these cases

Do not add one for visual styling alone, copy alone, hover states alone, every CRUD permutation, or behavior a unit, component, contract, or CLI test can prove.
Do not add speculative coverage for a non-critical screen.
Do not use a browser test to test a framework or to repeat a lower-rung assertion.

Use the repository fixture in every browser spec.
A journey that deliberately provokes a browser-level message, such as the 404 a missing picture logs while the document proves it says so, names that one message through the fixture's `allowedConsoleErrors` option; every other console error still fails the test.
Use user-facing roles, accessible names, and stable domain identifiers.
Use Playwright auto-waiting actions and web-first assertions.
Do not use arbitrary sleeps.
Use named `test.step` phases when a journey is long.
Visual quality is established by human review of the rendered document, not by pixel snapshots.

The suite-runtime budget is a safety requirement.
Keep `bun run test:e2e` in the low-single-digit-minute range.
If it grows past that, merge overlapping journeys or delete stale ones.
The brake must not become the bottleneck that stops safe, frequent change.

## CI

The CI workflow runs on every push.
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) owns the exact steps and their order, and it runs the same lint, build, unit-test, and browser-test commands you run locally.
Keep the full pipeline fast enough to run on every change.
The value of the brakes is that they are available before a change reaches a user.
