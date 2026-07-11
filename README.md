# Big Plan

**Good AI output depends on a great plan.**
Big Plan makes reviewing agent plans a first-class experience.

> [!WARNING]
> **Pre-alpha.** Big Plan is under active development.
> The static markdown viewer works today; the rest of the review experience is still being built.

Planning is an essential part of effective development with AI, and it deserves a first-class experience.
Big Plan is built around one question: **what is the best way to review a plan and reach agreement on it, before an agent acts?**

An agent writes its plan as structured MDX, and Big Plan renders it into a rich local review document: section navigation, typed blocks for diagrams, schemas, API endpoints and code diffs, a live chat connection to the authoring agent, highlight-to-comment threads the agent replies to in place, versioned change review, and full keyboard control.

Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the MDX file on your disk is the source of truth.

## Status

The first working release is being built in the open in this repository.
The first deliverable, a static markdown viewer, is available now.

## Usage

Render a static-subset MDX file into a single self-contained themed HTML document:

```sh
npx big-plan render <file.mdx> [output.html]
```

The output defaults to `<file>.html` next to the input.
It embeds all styling, behavior, and branding assets (including light and dark favicons selected from the OS preference), makes no external requests, and builds its table of contents from the document's level-two headings.
A sticky branding bar spans the top of the page on every screen size; its logo art follows the active theme and links to [big-plan.ai](https://big-plan.ai) in a new tab.
On wide screens the contents stay in a sticky sidebar; on narrower screens a sticky `Sections` menu shows the section count.
Both variants track the current section as the reader scrolls, and section links scroll smoothly unless the reader has requested reduced motion.
Fenced code blocks with a supported language identifier receive syntax highlighting; undeclared and unknown languages remain plain and readable.
Every block code sample has a copy control, and the light/dark theme control follows the system preference until the reader chooses a theme, which is remembered locally.

To inspect examples of supported fences and both palettes, render the [syntax-highlighting source](examples/syntax-highlighting.md) locally with `node bin/big-plan.mjs render examples/syntax-highlighting.md`, then open the generated `examples/syntax-highlighting.html`. The generated preview remains ignored by Git.

## Development

```sh
bun install
bun run build           # regenerate embedded modules, then compile TypeScript to dist/
bun run test            # vitest unit tests (regenerates embedded modules first)
bun run lint            # ESLint conventions and architecture checks
bun run gen             # regenerate CSS, browser-script, and branding-asset modules
bunx playwright test    # browser test of the rendered viewer (build first)
node bin/big-plan.mjs render examples/sample.mdx
```

Use `bun run test`, not `bun test` - the latter invokes Bun's own test runner instead of vitest.

See [AGENTS.md](AGENTS.md) for architecture and engineering rules, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## License

[MIT](LICENSE).
