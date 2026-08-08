# Using MermaidDiagram well

Use `MermaidDiagram` when a graph's nodes, paths, cycles, or fan-in/fan-out are the thing a reviewer must understand.

- Keep node ids short, meaningful, and stable; they become review anchors.
- Use `flowchart` or `graph` with exactly one of `TB`, `TD`, `BT`, `RL`, or `LR`.
- Put the human-readable label in the node shape. The viewer renders the label only; technical explanation belongs in prose around the figure or its footer.
- Label edges with verbs or outcomes when the relationship is not obvious from the arrow.
- Use `FlowDiagram` for a staged left-to-right story; use `MermaidDiagram` for general graphs, cycles, rank-skipping edges, and parallel paths.
- Use `sequenceDiagram`, `classDiagram`, `stateDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`, `journey`, `pie`, `mindmap`, `timeline`, or `gitGraph` when Mermaid's static layout expresses the plan more clearly. These types keep figure/footer comments and receive selectable semantic anchors where rendered geometry has a source label.
- Do not use flowchart subgraphs, directives, styling statements, click handlers, HTML labels, or unsupported Mermaid diagram types. The compiler reports the supported subset and a corrective action.
- Keep wide graphs deliberate. The viewer's Fit, zoom, pan, and Maximize controls are available when scripts run; the static SVG remains readable without scripts.
