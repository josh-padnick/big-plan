# GrandPlan

**Good AI output depends on a great plan.**
GrandPlan makes reviewing agent plans a first-class experience.

> [!WARNING]
> **Pre-alpha.** GrandPlan is under active development.
> The static markdown viewer works today; the rest of the review experience is still being built.

Planning is an essential part of effective development with AI, and it deserves a first-class experience.
GrandPlan is built around one question: **what is the best way to review a plan and reach agreement on it, before an agent acts?**

An agent writes its plan as structured MDX, and GrandPlan renders it into a rich local review document: section navigation, typed blocks for diagrams, schemas, API endpoints and code diffs, a live chat connection to the authoring agent, highlight-to-comment threads the agent replies to in place, versioned change review, and full keyboard control.

GrandPlan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the MDX file on your disk is the source of truth.

## Status

The first working release is being built in the open in this repository.
The first deliverable, a static markdown viewer, is available now.

## Usage

Render a GFM markdown file into a single self-contained themed HTML document:

```sh
npx grandplan render <file.md> [output.html]
```

The output defaults to `<file>.html` next to the input.
It embeds all styling and behavior, makes no external requests, and builds its table of contents from the document's level-two headings.
On wide screens the contents stay in a sticky sidebar; on narrower screens a sticky "On this page" menu shows the current section beneath a compact `Grimm 10.0` plan-review header.
Fenced code blocks with a supported language identifier receive syntax highlighting; undeclared and unknown languages remain plain and readable.
Every block code sample has a copy control, and the light/dark theme control follows the system preference until the reader chooses a theme, which is remembered locally.

To inspect examples of supported fences and both palettes, render the [syntax-highlighting source](examples/syntax-highlighting.md) locally with `node bin/grandplan.mjs render examples/syntax-highlighting.md`, then open the generated `examples/syntax-highlighting.html`. The generated preview remains ignored by Git.

## Development

```sh
bun install
bun run build           # compile TypeScript to dist/
bun run test            # vitest unit tests
bun run lint            # ESLint conventions and architecture checks
bunx playwright test    # browser test of the rendered viewer (build first)
node bin/grandplan.mjs render examples/sample.md
```

See [AGENTS.md](AGENTS.md) for architecture and engineering rules, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## License

[MIT](LICENSE).
