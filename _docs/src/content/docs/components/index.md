---
title: The component library
description: The twenty built-in components, grouped by the job each one does in a plan.
---

Plans are more than prose. They contain decisions, code changes, schemas, and risks, and each of
those deserves purpose-built review UI instead of another wall of text.

Components are flow-level elements from a closed, built-in registry, rendered entirely
server-side so documents stay self-contained and readable without JavaScript. The registry never
evaluates code from a plan: attributes are strings or bare booleans, structured data arrives as
fenced or scoped children, and any authoring mistake fails the render with a positional
diagnostic.

If two of them look interchangeable, the [pairs worth separating](#pairs-worth-separating) at the
bottom of this page say which to reach for.

The sidebar groups these five ways, and so does this page.

## Decisions

Ask the reviewer something, and end with a recorded answer.

| Component                                          | What it is for                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Decision](/components/decision/)                  | One tradeoff read option by option, each carrying its own verdict-lined considerations         |
| [DecisionAnalysis](/components/decision-analysis/) | A weighty choice audited in a keyed qualitative or weighted criteria matrix                    |
| [QuickDecision](/components/quick-decision/)       | One small question the reviewer can settle from the option titles alone. Repeat it for a batch |

## Code and files

Show the reviewer the code itself, and where it lives.

| Component                                   | What it is for                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| [CodeDiff](/components/code-diff/)          | One file's unified diff with gutters, change counts, and line-anchored annotations     |
| [CodeSnippet](/components/code-snippet/)    | Existing code with optional file identity, file-absolute line numbers, and annotations |
| [FileTree](/components/file-tree/)          | A plain file hierarchy with optional per-entry notes                                   |
| [FileTreeDiff](/components/file-tree-diff/) | Entry-level change status as one combined change tree                                  |

## Data and contracts

Reference material the reviewer queries, and the interfaces they will have to live with.

| Component                                                 | What it is for                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [DataTable](/components/data-table/)                      | A dataset with sortable columns, optional search, selectable columns, grouping, and text fit |
| [DatabaseTableSchema](/components/database-table-schema/) | One table's DBML-subset schema and its titled verbatim DDL                                   |
| [HttpEndpoint](/components/http-endpoint/)                | One HTTP endpoint: parameters, request body, and status-coded responses                      |
| [GraphqlOperation](/components/graphql-operation/)        | One query, mutation, or subscription with input and payload shapes and executable examples   |
| [GrpcMethod](/components/grpc-method/)                    | One gRPC method headed by its proto signature, with fields, status codes, and examples       |

## Pictures

Things a sentence cannot carry.

| Component                                      | What it is for                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| [FlowDiagram](/components/flow-diagram/)       | A flow, dependency, or fan-out as staged cards joined by verb-labeled connectors        |
| [MermaidDiagram](/components/mermaid-diagram/) | A compile-time Mermaid diagram with static light and dark SVG and stable review anchors |
| [Wireframe](/components/wireframe/)            | True-size product screens connected into a short walkable prototype                     |

## Document structure

The shape of the document itself, and the one thing a skimmer must not miss.

| Component                                         | What it is for                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Callout](/components/callout/)                   | A note, tip, warning, or danger a skimming reviewer must not miss                          |
| [Part](/components/part/)                         | The plan's sections divided into numbered acts, rendered as anchored divider bands         |
| [QuickSummary](/components/quick-summary/)        | The plan's key points as a standout opening card. Exactly one per plan                     |
| [Slide](/components/slide/)                       | A recurring [slide type](/for-agents/#slide-types) and its guidance applied to one section |
| [TableOfContents](/components/table-of-contents/) | The plan in one look: one linked row per section with its one-line gist                    |

## Pairs worth separating

A few of these look like each other. The dividing line is what the reviewer needs to _see_.

| Reach for          | Rather than        | When                                                                                                |
| ------------------ | ------------------ | --------------------------------------------------------------------------------------------------- |
| `QuickDecision`    | `Decision`         | The reviewer can answer from the option titles alone                                                |
| `Decision`         | `DecisionAnalysis` | Option-by-option considerations are enough, and a matrix would be ceremony                          |
| `DecisionAnalysis` | `Decision`         | The reviewer should audit the choice across explicit criteria, or check weighted arithmetic         |
| `CodeSnippet`      | `CodeDiff`         | You are showing existing code to read, with no change to mark                                       |
| `CodeDiff`         | `CodeSnippet`      | The point is what changes, not what is there                                                        |
| `FileTree`         | `FileTreeDiff`     | The tree carries no change status. `FileTreeDiff` rejects a tree with no change and points you here |
| `FileTreeDiff`     | `FileTree`         | Entries carry added, modified, removed, or renamed status                                           |
| `FlowDiagram`      | `MermaidDiagram`   | The content is a staged left-to-right story and you want Big Plan's own cards and connectors        |
| `MermaidDiagram`   | `FlowDiagram`      | It is a general graph, or a sequence, class, state, or ER view                                      |
| A Markdown table   | `DataTable`        | Under roughly ten rows and four columns. A prose table cannot wrap, sort, or filter                 |
| `DataTable`        | A Markdown table   | The grid is a reference the reviewer returns to, or would scroll sideways as prose                  |

And before any of them: if the content is an argument, prose is usually right. Reach for a
component when the reader needs to compare, scan, sort, or point at something. Never draw an
illustration as ASCII art in a code fence.

## Every page has the same shape

Each component page carries **How it looks**, **When to use it**, **When not to use it**,
**Compared with** where a look-alike exists, **Usage**, and **Authoring** with its attributes and
children. So once you have read one, you know where to look on the rest.

## Scoped children

A scoped child component is valid only in its declared hierarchy: `Annotation` in `CodeDiff` and `CodeSnippet`; `Column` in `DataTable`; `Ddl` in `DatabaseTableSchema`; `Stage` and `Edge` directly in `FlowDiagram`, with `Node` directly in that `Stage`; `Entry` in `TableOfContents`; `Option` directly in `Decision`, with `Consideration` directly in that `Option`; `Criterion`, `Details`, `Option`, and `Reversibility` directly in `DecisionAnalysis`, with `Score` directly in an `Option`; `Option` directly in `QuickDecision`; `Param`, `Request`, and `Response` in `HttpEndpoint`; `Argument`, `Field`, `Returns`, `Operation`, `Variables`, and `Response` in `GraphqlOperation`; `Field`, `Error`, `Example`, and `Proto` in `GrpcMethod`; and the screen and drawing vocabulary documented under [`Wireframe`](/components/wireframe/).

## Next

[Start a review](/intro/first-review/) — see these components in a complete plan review.
