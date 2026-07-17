---
title: Architecture
description: Understand Big Plan's CLI, pure renderer, self-contained page envelope, and generated assets.
---

Big Plan keeps its rendering pipeline deliberately small:

```text
CLI -> pure renderer -> self-contained HTML page envelope
```

## Keep the CLI thin

The CLI in `src/cli/` uses `runAxiCli()` from `axi-sdk-js` for dispatch, help, structured errors, and output serialization.
It owns the file input and output boundary.
Business logic stays outside the CLI layer.

## Render Markdown as a pure transformation

The renderer accepts Markdown source plus a fallback title and returns complete HTML.
It uses unified with `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-slug`, `rehype-highlight`, and `rehype-stringify`.

The pipeline compiles Markdown into a Hypertext Abstract Syntax Tree, collects the title, section outline, and element IDs, applies rehype transforms, and serializes only after those transforms finish.

## Separate the shell from the page envelope

The review shell owns the reading layout, palettes, branding bar, code-block controls, desktop section sidebar, and mobile `Sections` disclosure.
The page envelope owns packaging and delivery: the doctype, head, inline styles, favicon links, and inline scripts.

## Compile styles into the document

Styles are authored with Tailwind v4.
The global stylesheet owns cross-cutting tokens, palettes, theme overrides, branding visibility, the layout breakpoint, and target scroll margins.
Feature styles stay with the modules that emit or own their markup.

The CSS generator compiles the entry point and embeds the result in a generated TypeScript module.
Rendered documents therefore inline the complete stylesheet.

## Compile browser behavior

Browser scripts are authored as co-located `*.browser.ts` files and type-checked with DOM types.
A generator compiles them into generated modules that the shell inlines.
Shipped documents do not reference external code.

## Embed branding assets

The logo and favicon assets in the root `assets/` directory are embedded as data URIs in a generated module.
The branding bar and favicons therefore ship inside each rendered document.

## Commit generated modules

Generated files include `.generated.` in their names and are not edited by hand.
They are committed so the codebase remains scannable without running generators.
Changes to a generator or its inputs must include the regenerated output, and CI fails when generated files drift.
