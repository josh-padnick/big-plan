# Big Plan

**Good AI output depends on a great plan.**
Big Plan makes reviewing agent plans a first-class experience.

> [!WARNING]
> **Pre-alpha.** Big Plan has no compatibility contract until an explicit milestone establishes one.
> Commands, document formats, and rendered output may change together as the product finds its cleanest model.

Big Plan is built around one question: **what is the best way to review a plan and reach agreement on it, before an agent acts?**

An agent writes its plan as structured MDX, and Big Plan renders it into a rich local review document.
The static authoring contract combines Markdown with validated components for decisions, code, reference data, schemas, file trees, and API contracts.
The [features](docs/src/content/docs/intro/features.md) and [components](docs/src/content/docs/components/index.md) pages describe the capabilities that ship today.

Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the MDX file on your disk is the source of truth.

## Usage

Read the plan-writing guidance, print or install the agent skill shell, validate a plan without writing anything, render it as self-contained themed HTML, or compile its validated contents as machine-readable JSON:

```sh
npx big-plan guidance
npx big-plan skill
npx big-plan skill write <path/to/SKILL.md>
npx big-plan validate <file.mdx>
npx big-plan render <file.mdx> [output.html]
npx big-plan compile <file.mdx> [output.json]
npx big-plan review <file.mdx>
npx big-plan service status
npx big-plan agent <file.mdx>
```

`guidance` prints the principles for writing a plan a human loves to review; the [CLI reference](docs/src/content/docs/reference/cli.md#guidance-and-the-acknowledgment-gate) owns which commands require a current acknowledgment.
`skill` prints the thin agent skill shell shipped with the package; `skill write <path>` installs that shell only when you ask (no silent overwrites).
Validation checks that the plan can be compiled and rendered, then applies linting rules to the authored plan without writing an output file.
Rendering applies the same linting rules, so a plan that fails lint never reaches a reviewer.
Rendered output defaults to `<file>.html`; compiled output defaults to `<file>.model.json`.
`review` serves the rendered plan locally so a reviewer can leave comments, and prints the stable address for that plan; the session address is a debugging detail, while a small local service keeps the plan address working across runtime restarts and `big-plan service` inspects or stops that service.
`agent` runs the coding-agent side of that live review exchange.
Rendered and compiled output sit next to the input by default, while the MDX file remains the canonical source and JSON is always derived output.
See the [two-artifact delivery contract](adr/0001-two-artifact-plan-delivery.md).
MermaidDiagram rendering additionally uses the pinned headless Chromium renderer at compile time; on a clean install, provision it once with `bunx playwright@1.61.1 install chromium`.
A responsive table of contents links to the document's level-two headings and highlights the section being read, and a `Settings` dialog holds saved appearance, colour-theme, and approval-message pages.
In a live authoritative review, **Approve plan** records the current plan, its decision answers, and that message for the later agent handoff; [Reviewing a plan](docs/src/content/docs/reference/reviewing.md#approving-a-plan) owns the complete workflow.

Plans are prose plus validated components, like this callout:

```mdx
<Callout type="warning" title="Deploy ordering">

Enable the worker before stale reads.

</Callout>
```

### Agent skill and how updates propagate

Big Plan ships a **thin skill shell** under `assets/skill/SKILL.md`, embedded into the published package and printed by `big-plan skill`.

| Layer                              | Owns                                                                                     | Changes when                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| Skill shell (`big-plan skill`)     | When to use Big Plan, how to invoke the CLI, and the mandatory "run guidance first" rule | Rarely - workflow framing only     |
| CLI guidance (`big-plan guidance`) | Plan-writing principles and per-component usage                                          | Often - product quality iterations |
| Package upgrade                    | Binary + embedded skill + guidance                                                       | Every release                      |

**Update story for end users:**

1. Upgrade Big Plan (`npm i -g big-plan@latest`, bump the dependency, or run `npx big-plan@latest ...`).
2. New guidance arrives automatically on the next `big-plan guidance` - no skill-file edits.
3. Re-run `big-plan skill write <path>` only if the thin shell text itself changed (rare).
4. Prefer `npx big-plan@latest` for always-current one-off runs over silent global mutation.
   The CLI also exposes axi-sdk's built-in `update` for global installs when you want that path explicitly.

Agents should not re-copy long guidance into chat memory as policy; the installed CLI is authoritative each session.
See [Use the skill](docs/src/content/docs/for-agents/use-the-skill.md) for the agent-facing install path.

The full authoring contract lives in the documentation:

- [Use the skill](docs/src/content/docs/for-agents/use-the-skill.md) - install the skill shell and keep it fresh via package upgrades.
- [Authoring plans](docs/src/content/docs/for-agents/authoring-plans.md) - what a plan document is, how the guidance gate works, and where each kind of rule lives.
- [Linting rules](docs/src/content/docs/reference/lint-rules.md) - every authoring rule and its conservative matching boundaries.
- [Components](docs/src/content/docs/components/index.md) - the complete built-in component reference.
- [Features](docs/src/content/docs/intro/features.md) - the reader-facing viewer capabilities.
- [CLI reference](docs/src/content/docs/reference/cli.md) - `big-plan guidance`, `skill`, `validate`, `render`, `compile`, `review`, `service`, and `agent` in detail.
- [Reviewing a plan](docs/src/content/docs/reference/reviewing.md) - local comments, the coding-agent exchange, and revision truth.

To preview components locally from a source checkout, run `bun run build` first. Then run `node bin/big-plan.mjs guidance` once and render [the MDX components plan](examples/mdx-components.mdx) with `node bin/big-plan.mjs render examples/mdx-components.mdx`. The local executable reads the compiled files in `dist/`.
To inspect supported fences in both light and dark appearances, render the [syntax-highlighting source](examples/syntax-highlighting.mdx) the same way.
To see every DatabaseTableSchema scenario in one document, render the [table-schema showcase](examples/database-table-schema.mdx).
Generated previews remain ignored by Git.

## Development

```sh
bun install
bun run build           # regenerate embedded modules, then compile TypeScript to dist/
bun run test            # Vitest and Node unit tests, including the script contract tests under scripts/ (regenerates embedded modules first)
bun run lint            # ESLint, stylesheet-contract, design-system, and Prettier checks
bun run format          # format authored files with Prettier
bun run gen             # regenerate review-script, CSS, font, branding-asset, guidance, and skill modules
bun run test:e2e        # browser tests of the rendered viewer (build first)
node bin/big-plan.mjs render examples/sample.mdx
```

Formatting exclusions and their rationale are documented in [.prettierignore](.prettierignore).
Use `bun run test`, not `bun test` - the latter invokes Bun's own test runner instead of the package script.

See [AGENTS.md](AGENTS.md) for architecture, [_internal/ENGINEERING_PRACTICES.md](_internal/ENGINEERING_PRACTICES.md) for engineering practices, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Documentation

The documentation site lives in `docs/`.
Install its standalone dependencies and start the development server with:

```sh
cd docs
bun install
bun run dev
```

From `docs/`, build the static site with:

```sh
bun run build
```

After building the root package, regenerate the docs' light/dark component screenshot pairs from `docs/` with `bun run screenshots`.

## License

[FSL-1.1-MIT](LICENSE.md). Each release becomes available under MIT two years after it is published.
