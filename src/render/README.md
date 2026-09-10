<!-- Owns renderer-local placement decisions beyond the root agent guide. -->

# Renderer local map

Start with the root [agent guide](../../AGENTS.md) and the [components local map](../components/README.md).
This directory owns document-wide compilation and delivery; component semantics remain in their component slices, while public command I/O remains in the CLI.

- Put plan-source parsing, document metadata, heading identity, and document-wide HAST transforms under `markdown/`; the module returns structured HAST and never serializes it.
- Keep pre-HAST authoring validation, post-MDX component delivery, and the React-to-HAST adapter separated inside `markdown/component-pipeline/`.
- Put plan-model composition in `compile-plan-model.ts`, human-document composition in `render-document.ts`, paired component-diff composition in `render-diff-view.ts`, and final HTML serialization in `serialize-html.ts`; no composition owner absorbs CLI file handling.
- Put deriving new plan source from an existing one in `stamp-decisions.ts`; a rule about authored bytes belongs beside the compilation that reads them, and it returns those bytes rather than writing them, because the review layer owns the one writer of the authoritative source.
- Put reading layout, navigation, and viewer chrome in `shell/`.
- Put doctype, head, embedded assets, favicons, and final HTML packaging in `page.ts`.
- Put the review-link service's own pages in `service-page.ts`; they are the one delivery surface with no plan behind them, so they compose the shell, the envelope, and existing component recipes rather than inventing a second visual vocabulary.
