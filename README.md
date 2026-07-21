# Big Plan

**Good AI output depends on a great plan.**
Big Plan makes reviewing agent plans a first-class experience.

> [!WARNING]
> **Pre-alpha.** Big Plan is under active development, and its first working release is being built in the open in this repository.
> The static-subset MDX viewer and its first components work today; the rest of the review experience is still being built.

Big Plan is built around one question: **what is the best way to review a plan and reach agreement on it, before an agent acts?**

An agent writes its plan as structured MDX, and Big Plan renders it into a rich local review document.
Today that means section navigation and typed callout, code, file-tree, HTTP, GraphQL, and gRPC review components; the planned review experience adds more components, live agent chat, highlight-to-comment threads, versioned change review, and full keyboard control.

Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the MDX file on your disk is the source of truth.

## Usage

Render a static-subset MDX plan document into a single self-contained themed HTML document:

```sh
npx big-plan render <file.mdx> [output.html]
```

The output defaults to `<file>.html` next to the input.
It embeds all styling, behavior, and branding assets, makes no external requests, and stays readable with JavaScript disabled.
A responsive table of contents built from the document's level-two headings tracks the reader through the page, and the light/dark theme follows the OS preference until the reader chooses one.

Plans are prose plus validated components, like this callout:

```mdx
<Callout type="warning" title="Deploy ordering">

Enable the worker before stale reads.

</Callout>
```

The full authoring contract lives in the documentation:

- [Authoring plans](docs/src/content/docs/for-agents/authoring-plans.md) - the accepted MDX subset and its hard-fail positional diagnostics.
- [Components](docs/src/content/docs/components/index.md) - the complete built-in component reference.
- [Features](docs/src/content/docs/intro/features.md) - the reader-facing viewer capabilities.
- [CLI reference](docs/src/content/docs/reference/cli.md) - `big-plan render` in detail.

To preview components locally, render [the MDX components plan](examples/mdx-components.mdx) with `node bin/big-plan.mjs render examples/mdx-components.mdx`.
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
bun run gen             # regenerate CSS, browser-script, and branding-asset modules
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
