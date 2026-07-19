# Big Plan

**Good AI output depends on a great plan.**
Big Plan makes reviewing agent plans a first-class experience.

> [!WARNING]
> **Pre-alpha.** Big Plan is under active development.
> The static-subset MDX viewer and its first typed blocks work today; the rest of the review experience is still being built.

Planning is an essential part of effective development with AI, and it deserves a first-class experience.
Big Plan is built around one question: **what is the best way to review a plan and reach agreement on it, before an agent acts?**

An agent writes its plan as structured MDX, and Big Plan renders it into a rich local review document.
Today that means section navigation and typed callouts and code diffs; the planned review experience adds more typed blocks, live agent chat, highlight-to-comment threads, versioned change review, and full keyboard control.

Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the MDX file on your disk is the source of truth.

## Status

The first working release is being built in the open in this repository.
Deliverable 2 is available now: the static viewer accepts static-subset MDX plans with validated typed blocks.

## Usage

Render a static-subset MDX plan document into a single self-contained themed HTML document:

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

MDX plans may use the built-in flow-level `Callout` and `CodeDiff` typed blocks plus scoped `Annotation` children; unknown blocks and inline JSX are rejected.
Plans cannot contain imports, exports, or `{}` expressions.
Block attribute names must be unique; spreads and expression-valued attributes are rejected, bare boolean attributes are supported only where a block schema allows them, and all other values must be static strings.
Unsupported MDX syntax and invalid block attributes fail the render with diagnostics that include `line:column` positions.
GFM features including tables, task lists, footnotes, and autolinks remain available through the MDX pipeline.
Four-space indented code blocks are not supported by MDX; use fenced code blocks instead.

Use `Callout` with one of the four supported types and an optional custom title; without a title, the displayed title is `Note`, `Tip`, `Warning`, or `Danger` according to the type:

```mdx
<Callout type="warning" title="Deploy ordering">

Enable the worker before stale reads.

</Callout>
```

Use `CodeDiff` with a required non-empty file path, optional bare `showLineNumbers` and `showLineCounts` attributes, and exactly one fenced `diff` child besides any annotations; line numbers require `@@` hunk headers:

````mdx
<CodeDiff file="src/cache.ts" showLineNumbers showLineCounts>

```diff
@@ -12 +12,2 @@
-const ttl = 30;
+const ttl = 60;
+metrics.increment("ttl_change");
```

<Annotation lines="13" side="new">
  I added this TTL-change metric; tell me in review if it should use the catalog
  prefix documented in `metrics.md`.
</Annotation>

</CodeDiff>
````

Nest `Annotation` directly inside `CodeDiff` with a required `lines` string and an optional `side` of `old` or `new`, which defaults to `new`.
The `lines` value is either one canonical positive integer (`N`) or a strictly ascending inclusive range (`N-M`); zero and leading zeros are invalid.
Annotation anchors require an `@@` hunk header, and every line in the range must exist on the selected side.
Covered lines receive an annotation spine and wash, and the card renders after the range's final line in both views.
In side-by-side view, each annotation stays in its selected old or new pane while the opposite pane reserves matching space so later rows remain aligned; each equal-width pane and hunk header scrolls horizontally on its own.
Multiple annotations may target one line or range and render in authored order.
Annotation bodies support ordinary rich Markdown such as lists and fenced code, but cannot contain headings, footnote references or definitions, or typed blocks.
An `Annotation` anywhere other than a direct `CodeDiff` child is an unknown block.
The header shows the full file path and, when `showLineCounts` is set, added and removed line counts; the diff opens in a readable unified view even without JavaScript.
With JavaScript enabled, long annotation bodies collapse to roughly three lines with `View more…` and `View less` controls, and the reader's expanded choice survives responsive layout changes; without JavaScript, their full contents remain visible.
Readers can also switch between unified and side-by-side views, preserve that preference across reloads, copy the file path or the fenced diff source (as parsed: LF line endings with a trailing newline) from the actions menu, or expand the diff into a full-screen dialog.
Headerless `+`/`-` diffs are accepted when line numbers are omitted, and standard Git file preambles may appear before the first `@@` hunk.
Each `@@` hunk's declared old and new line counts must match its content.
Hunk coordinates and their resulting line-number ranges must not exceed `9007199254740991`.
Inside a hunk, a blank line is accepted as empty context even when an editor has stripped its leading space.

Because `<` and `{` begin MDX syntax, write them carefully in prose or place literal examples in code spans or fences.
HTML comments and angle-bracket `<url>` autolinks are not supported in plan documents.

To preview typed blocks, render [the MDX blocks plan](examples/mdx-blocks.mdx) locally with `node bin/big-plan.mjs render examples/mdx-blocks.mdx`.
To inspect supported fences and both palettes, render the [syntax-highlighting source](examples/syntax-highlighting.mdx) locally with `node bin/big-plan.mjs render examples/syntax-highlighting.mdx`, then open the generated `examples/syntax-highlighting.html`.
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

## License

[MIT](LICENSE).
