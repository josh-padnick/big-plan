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

| Component                                                 | What it is for                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [Callout](/components/callout/)                           | Surface a note, tip, warning, or danger so reviewers cannot miss it.                                                 |
| [CodeDiff](/components/code-diff/)                        | Review one file's unified diff with switchable views, gutters, and line-anchored annotations.                        |
| [CodeSnippet](/components/code-snippet/)                  | Inspect existing code with optional file identity, file-absolute line numbers, and annotations.                      |
| [DatabaseTableSchema](/components/database-table-schema/) | Review one table's DBML-subset schema and titled verbatim DDL.                                                       |
| [BigDecision](/components/big-decision/)                  | Review one weighty decision with lifecycle status, options, signed tradeoffs, a recommendation, and an outcome.      |
| [SmallDecisionSet](/components/small-decision-set/)       | Collect a plan's small questions as a compact numbered list of briefly explained options.                            |
| [FileTree](/components/file-tree/)                        | Show a plain file hierarchy with optional per-entry notes.                                                           |
| [FileTreeDiff](/components/file-tree-diff/)               | Review per-entry change status as a combined tree or before-and-after views.                                         |
| [GraphqlOperation](/components/graphql-operation/)        | Review one GraphQL query, mutation, or subscription with one-level input and payload shapes and executable examples. |
| [GrpcMethod](/components/grpc-method/)                    | Review one gRPC method headed by its proto signature, with message fields, status codes, and grouped examples.       |
| [HttpEndpoint](/components/http-endpoint/)                | Review one HTTP endpoint's contract: parameters, request body, and status-coded responses.                           |

Scoped child components are valid only inside their declaring parent: `Annotation` in `CodeDiff` and `CodeSnippet`; `Ddl` in `DatabaseTableSchema`; `Option`, `Pro`, and `Con` in `BigDecision`; `SmallDecision` and `Option` in `SmallDecisionSet`; `Param`, `Request`, and `Response` in `HttpEndpoint`; `Argument`, `Field`, `Returns`, `Operation`, `Variables`, and `Response` in `GraphqlOperation`; `Field`, `Error`, `Example`, and `Proto` in `GrpcMethod`.

## Coming next

The library grows one registry capability at a time; each item below is sequenced in the [roadmap](/intro/roadmap/):

- `DatabaseSchema` renders a structured schema card from a fenced YAML child.
- `Diagram` renders diagram source into inline SVG at build time, keeping documents free of external requests.

Interactive components such as forms are deliberately deferred until the live review server exists; static documents should never contain dead controls.
