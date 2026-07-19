---
title: Components
description: The typed block library that renders each kind of plan information in a first-class way.
---

Plans are more than prose.
They contain decisions, code changes, schemas, and risks, and each of those deserves purpose-built review UI instead of another wall of text.
Components are Big Plan's typed blocks: flow-level elements from a closed, built-in registry, rendered entirely server-side so documents stay self-contained and readable without JavaScript.

The registry never evaluates code from a plan.
A block's attributes are strings or bare booleans, structured data arrives as fenced children, and any authoring mistake fails the render with a positional diagnostic; see [Authoring plans](/for-agents/authoring-plans/) for the contract.

## The component library

| Component                                | What it is for                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Callout](/components/callout/)          | Surface a note, tip, warning, or danger so reviewers cannot miss it.                        |
| [CodeDiff](/components/code-diff/)       | Review a verbatim `git diff` with switchable views, gutters, and line-anchored annotations. |
| [CodeSnippet](/components/code-snippet/) | Inspect an annotated code excerpt with a file association and real line numbers.            |

`Annotation` is a scoped child block, valid only inside `CodeDiff` and `CodeSnippet`, sharing one `lines` range grammar.

## Coming next

The library grows one registry capability at a time; each pair below is sequenced in the [roadmap](/intro/roadmap/):

- `Decision` renders options considered, the choice, and the rationale, with nested `Option` children.
- `FileTree` renders a styled file hierarchy with per-path change badges.
- `ApiEndpoint` and `DatabaseSchema` render structured cards from a fenced YAML child.
- `Diagram` renders diagram source into inline SVG at build time, keeping documents free of external requests.

Interactive blocks such as forms are deliberately deferred until the live review server exists; static documents should never contain dead controls.
