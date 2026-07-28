# Components local map

Start with the root [agent guide](../../AGENTS.md).
This directory owns authorable plan concepts and the shared infrastructure needed to compile and present them; document-wide orchestration belongs to the [renderer](../render/README.md).

Each authorable concept is a vertical slice under a non-underscored folder.
Keep its framework-neutral authoring contract and compiled model, React view, styles, and focused tests together so concept behavior has one owner.

- Put behavior shared by multiple component compilers in `_authoring/` only when it is part of the common, framework-neutral authoring contract.
- Put the closed registry and React-aware definition seam in `_registration/`; component compilation remains in the component slice.
- Put a reusable React presentation primitive in `_shared/` only when authors can never name it in MDX; never register shared primitives as plan elements.
- Keep component-specific behavior in its vertical slice even when the renderer consumes it.
