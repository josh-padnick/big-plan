# Big Plan

**Good AI output depends on a great plan.**
Big Plan makes reviewing agent plans a first-class experience.

> [!WARNING]
> **Pre-alpha.** Big Plan has no compatibility contract until an explicit milestone establishes one.
> Commands, document formats, and rendered output may change together as the product finds its cleanest model.

Big Plan is built around one question: **what is the best way to review a plan and reach agreement on it, before an agent acts?**

An agent writes its plan as structured MDX, and Big Plan renders it into a rich local review document.
The static authoring contract combines Markdown with validated components for decisions, code, schemas, file trees, and API contracts.
The [features](docs/src/content/docs/intro/features.md) and [components](docs/src/content/docs/components/index.md) pages describe the capabilities that ship today.

Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the MDX file on your disk is the source of truth.

## Usage

Read the plan-writing guidance, validate a plan without writing anything, render it as self-contained themed HTML, or compile its validated contents as machine-readable JSON:

```sh
npx big-plan guidance
npx big-plan validate <file.mdx>
npx big-plan render <file.mdx> [output.html]
npx big-plan compile <file.mdx> [output.json]
```

`guidance` prints the principles for writing a plan a human loves to review; reading it recently is required before `validate` and `render` will run.
Validation checks that the plan can be compiled and rendered, then applies linting rules to the authored plan without writing an output file.
Rendering applies the same linting rules, so a plan that fails lint never reaches a reviewer.
Rendered output defaults to `<file>.html`; compiled output defaults to `<file>.model.json`.
Both sit next to the input, while the MDX file remains the canonical source and JSON is always derived output.
The rendered HTML embeds all styling and branding assets, makes no external requests, and never executes plan-authored code; the only script is the shell's small embedded viewer script (TOC scroll-spy, hover popovers, deck collapse, and figure maximize), and every affordance keeps a no-JS fallback.
A responsive table of contents links to the document's level-two headings and highlights the section being read, and the light/dark theme follows the OS preference through CSS alone.

Plans are prose plus validated components, like this callout:

```mdx
<Callout type="warning" title="Deploy ordering">

Enable the worker before stale reads.

</Callout>
```

The full authoring contract lives in the documentation:

- [Authoring plans](docs/src/content/docs/for-agents/authoring-plans.md) - what a plan document is, how the guidance gate works, and where each kind of rule lives.
- [Linting rules](docs/src/content/docs/reference/lint-rules.md) - every authoring rule and its conservative matching boundaries.
- [Components](docs/src/content/docs/components/index.md) - the complete built-in component reference.
- [Features](docs/src/content/docs/intro/features.md) - the reader-facing viewer capabilities.
- [CLI reference](docs/src/content/docs/reference/cli.md) - `big-plan guidance`, `validate`, `render`, and `compile` in detail.

To preview components locally, run `node bin/big-plan.mjs guidance` once, then render [the MDX components plan](examples/mdx-components.mdx) with `node bin/big-plan.mjs render examples/mdx-components.mdx`.
To inspect supported fences and both palettes, render the [syntax-highlighting source](examples/syntax-highlighting.mdx) the same way.
To see every DatabaseTableSchema scenario in one document, render the [table-schema showcase](examples/database-table-schema.mdx).
Generated previews remain ignored by Git.

## Development

```sh
bun install
bun run build           # regenerate embedded modules, then compile TypeScript to dist/
bun run test            # vitest unit tests (regenerates embedded modules first)
bun run lint            # ESLint checks plus Prettier format verification
bun run format          # format authored files with Prettier
bun run gen             # regenerate CSS, branding-asset, and guidance modules
bunx playwright test    # browser tests of the rendered viewer (build first)
node bin/big-plan.mjs render examples/sample.mdx
```

Formatting exclusions and their rationale are documented in [.prettierignore](.prettierignore).
Use `bun run test`, not `bun test` - the latter invokes Bun's own test runner instead of vitest.

See [AGENTS.md](AGENTS.md) for architecture and engineering rules, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

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

[MIT](LICENSE).
