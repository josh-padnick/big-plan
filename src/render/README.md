# Renderer local map

Start with the root [agent guide](../../AGENTS.md) and the [components local map](../components/README.md).
This directory owns document-wide compilation and delivery; authorable concept semantics remain in their component slices, while public command I/O remains in the CLI.

The renderer parses and validates a plan source through one shared pipeline.
Each component compiler returns a framework-neutral model paired with a presentation that consumes it.
The model continuation collects those models for JSON without top-level presentation; the HTML continuation invokes the paired presentations, crosses the React-to-HAST boundary once, applies document transforms, then adds the review shell and page envelope.

- Put static-subset parsing, document metadata, heading identity, and document-wide HAST transforms under `markdown/`.
- Keep pre-HAST authoring validation, post-MDX component delivery, and the React-to-HAST adapter separated inside `markdown/component-pipeline/`.
- Put plan-model composition in `compile-plan-model.ts` and human-document composition in `render-document.ts`; neither owner absorbs CLI file handling.
- Put reading layout, navigation, and viewer chrome in `shell/`.
- Put doctype, head, embedded assets, favicons, and final HTML packaging in `page.ts`.
