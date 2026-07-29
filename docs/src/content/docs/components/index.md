---
title: Components
description: The component library that renders each kind of plan information in a first-class way.
---

Plans are more than prose.
They contain decisions, code changes, schemas, and risks, and each of those deserves purpose-built review UI instead of another wall of text.
Components are flow-level elements from a closed, built-in registry, rendered entirely server-side so documents stay self-contained and readable without JavaScript.

The registry never evaluates code from a plan.
A component's attributes are strings or bare booleans, structured data arrives as fenced or scoped children, and any authoring mistake fails the render with a positional diagnostic; see [Authoring plans](/for-agents/authoring-plans/) for the contract.

## Available today

| Component                                                 | What it is for                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [BigDecision](/components/big-decision/)                  | Review one weighty decision as a scored criteria matrix or a substantive option list.                                |
| [Callout](/components/callout/)                           | Surface a note, tip, warning, or danger so reviewers cannot miss it.                                                 |
| [CodeDiff](/components/code-diff/)                        | Review one file's unified diff with gutters and line-anchored annotations.                                           |
| [CodeSnippet](/components/code-snippet/)                  | Inspect existing code with optional file identity, file-absolute line numbers, and annotations.                      |
| [DatabaseTableSchema](/components/database-table-schema/) | Review one table's DBML-subset schema and titled verbatim DDL.                                                       |
| [FileTree](/components/file-tree/)                        | Show a plain file hierarchy with optional per-entry notes.                                                           |
| [FileTreeDiff](/components/file-tree-diff/)               | Review per-entry change status as one combined change tree.                                                          |
| [GraphqlOperation](/components/graphql-operation/)        | Review one GraphQL query, mutation, or subscription with one-level input and payload shapes and executable examples. |
| [GrpcMethod](/components/grpc-method/)                    | Review one gRPC method headed by its proto signature, with message fields, status codes, and grouped examples.       |
| [HttpEndpoint](/components/http-endpoint/)                | Review one HTTP endpoint's contract: parameters, request body, and status-coded responses.                           |
| [QuickSummary](/components/quick-summary/)                | Open the plan with its few key points as a standout card, capped at five bullets and six hundred characters.         |
| [SmallDecisionSet](/components/small-decision-set/)       | Collect a plan's small questions as a compact numbered list of briefly explained options.                            |

Scoped child components are valid only in their declared hierarchy: `Annotation` in `CodeDiff` and `CodeSnippet`; `Ddl` in `DatabaseTableSchema`; `Criterion`, `Details`, `Option`, and `Reversibility` directly in `BigDecision`, with `Score` directly in an `Option`; `SmallDecision` directly in `SmallDecisionSet`, with `Option` directly in a `SmallDecision`; `Param`, `Request`, and `Response` in `HttpEndpoint`; `Argument`, `Field`, `Returns`, `Operation`, `Variables`, and `Response` in `GraphqlOperation`; and `Field`, `Error`, `Example`, and `Proto` in `GrpcMethod`.
