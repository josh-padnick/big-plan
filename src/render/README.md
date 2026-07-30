# Renderer local map

Start with the root [agent guide](../../AGENTS.md) and the [components local map](../components/README.md).
This directory owns document-wide compilation and delivery; component semantics remain in their component slices, while public command I/O remains in the CLI.

The renderer parses and validates a plan source through one shared pipeline.
Each component's compilation function returns plain validated data paired with a presentation that consumes it.
The machine-readable continuation collects that data for JSON without top-level presentation; the HTML continuation invokes the paired presentations, crosses the React-to-HAST boundary once, applies document transforms, then adds the review shell and page envelope.

- Put plan-source parsing, document metadata, heading identity, and document-wide HAST transforms under `markdown/`; the module returns structured HAST and never serializes it.
- Keep pre-HAST authoring validation, post-MDX component delivery, and the React-to-HAST adapter separated inside `markdown/component-pipeline/`.
- Put plan-model composition in `compile-plan-model.ts`, human-document composition in `render-document.ts`, and final HTML serialization in `serialize-html.ts`; no composition owner absorbs CLI file handling.
- Put reading layout, navigation, and viewer chrome in `shell/`.
- Put doctype, head, embedded assets, favicons, and final HTML packaging in `page.ts`.
