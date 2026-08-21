# Renderer local map

Start with the root [agent guide](../../AGENTS.md) and the [components local map](../components/README.md).
This directory owns document-wide compilation and delivery; component semantics remain in their component slices, while public command I/O remains in the CLI.

The renderer parses and validates a plan source through one shared pipeline.
Each component's compilation function returns plain validated data paired with a presentation that consumes it.
Both deliveries invoke the paired presentations through the single React-to-HAST boundary and apply the same document transforms; only what they publish differs, and the [agent guide](../../AGENTS.md) owns that contract.
Machine delivery publishes the collected component models for JSON; human delivery adds the review shell and page envelope.
An outline-aware presentation crosses that same boundary after the deck transform has computed the document outline it consumes.

- Put plan-source parsing, document metadata, heading identity, and document-wide HAST transforms under `markdown/`; the module returns structured HAST and never serializes it.
- Keep pre-HAST authoring validation, post-MDX component delivery, and the React-to-HAST adapter separated inside `markdown/component-pipeline/`.
- Put plan-model composition in `compile-plan-model.ts`, human-document composition in `render-document.ts`, paired component-diff composition in `render-diff-view.ts`, and final HTML serialization in `serialize-html.ts`; no composition owner absorbs CLI file handling.
- Put reading layout, navigation, and viewer chrome in `shell/`.
- Put doctype, head, embedded assets, favicons, and final HTML packaging in `page.ts`.
- Put the review-link service's own pages in `service-page.ts`; they are the one delivery surface with no plan behind them, so they compose the shell, the envelope, and existing component recipes rather than inventing a second visual vocabulary.
