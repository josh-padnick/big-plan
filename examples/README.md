# examples/

Start with the [agent guide](../AGENTS.md); usage of `big-plan render` lives in the root [README](../README.md).

This directory owns the authored plan documents that demonstrate the viewer: realistic inputs an agent could have written, rendered by tests and by hand.

- Every component or component set keeps one dedicated document demonstrating its major usage modes.
- One integration document exercises every component together for the browser journeys, and plain-markdown documents cover the component-free surface.
- `slide-craft.mdx` demonstrates the writing conventions `big-plan guidance` teaches rather than one component: title-first slides, a problem-first opening for a novel concept, run-in paragraph labels, bracketed declaration markers, and a grouped table with its legend.
- Every document here must render without diagnostics; a render-health test enforces this.
