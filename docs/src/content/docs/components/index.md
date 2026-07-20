---
title: Components
description: The component library that renders each kind of plan information in a first-class way.
---

Plans are more than prose.
They contain decisions, code changes, schemas, and risks, and each of those deserves purpose-built review UI instead of another wall of text.
Components are flow-level elements from a closed, built-in registry, rendered entirely server-side so documents stay self-contained and readable without JavaScript.

The registry never evaluates code from a plan.
A component's attributes are strings or bare booleans, structured data arrives as fenced children, and any authoring mistake fails the render with a positional diagnostic; see [Authoring plans](/for-agents/authoring-plans/) for the contract.

## Available today

| Component                                   | What it is for                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Callout](/components/callout/)             | Surface a note, tip, warning, or danger so reviewers cannot miss it.                            |
| [CodeDiff](/components/code-diff/)          | Review one file's unified diff with switchable views, gutters, and line-anchored annotations.   |
| [CodeSnippet](/components/code-snippet/)    | Inspect existing code with optional file identity, file-absolute line numbers, and annotations. |
| [FileTree](/components/file-tree/)          | Show a plain file hierarchy with optional per-entry notes.                                      |
| [FileTreeDiff](/components/file-tree-diff/) | Review per-file change status as a combined tree or before-and-after views.                     |

`Annotation` is a scoped child component, valid only as a direct child of `CodeDiff` or `CodeSnippet`.

## Coming next

The library grows one registry capability at a time; each item below is sequenced in the [roadmap](/intro/roadmap/):

- `Decision` renders options considered, the choice, and the rationale, with nested `Option` children.
- `ApiEndpoint` and `DatabaseSchema` render structured cards from a fenced YAML child.
- `Diagram` renders diagram source into inline SVG at build time, keeping documents free of external requests.

Interactive components such as forms are deliberately deferred until the live review server exists; static documents should never contain dead controls.
