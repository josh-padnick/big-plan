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
| [Callout](/components/callout/)                           | Surface a note, tip, warning, or danger so reviewers cannot miss it.                                                 |
| [CodeDiff](/components/code-diff/)                        | Review one file's unified diff with gutters and line-anchored annotations.                                           |
| [CodeSnippet](/components/code-snippet/)                  | Inspect existing code with optional file identity, file-absolute line numbers, and annotations.                      |
| [DataTable](/components/data-table/)                      | Query a dataset in place: sortable columns, optional search, selectable columns, grouping, and text fit.             |
| [DatabaseTableSchema](/components/database-table-schema/) | Review one table's DBML-subset schema and titled verbatim DDL.                                                       |
| [Decision](/components/decision/)                         | Review one tradeoff option by option, each carrying its own verdict-lined considerations.                            |
| [DecisionAnalysis](/components/decision-analysis/)        | Audit or choose a weighty decision in a keyed qualitative or weighted scoring matrix.                                |
| [FileTree](/components/file-tree/)                        | Show a plain file hierarchy with optional per-entry notes.                                                           |
| [FileTreeDiff](/components/file-tree-diff/)               | Review per-entry change status as one combined change tree.                                                          |
| [FlowDiagram](/components/flow-diagram/)                  | Diagram a flow, dependency, or fan-out as staged cards joined by verb-labeled, directed connectors.                  |
| [GraphqlOperation](/components/graphql-operation/)        | Review one GraphQL query, mutation, or subscription with one-level input and payload shapes and executable examples. |
| [GrpcMethod](/components/grpc-method/)                    | Review one gRPC method headed by its proto signature, with message fields, status codes, and grouped examples.       |
| [HttpEndpoint](/components/http-endpoint/)                | Review one HTTP endpoint's contract: parameters, request body, and status-coded responses.                           |
| [Part](/components/part/)                                 | Divide the plan's sections into numbered acts rendered as anchored divider bands.                                    |
| [QuickSummary](/components/quick-summary/)                | Open the plan with its few key points as a standout card, capped at five bullets and six hundred characters.         |
| [QuickDecision](/components/quick-decision/)              | Answer one small brief-format question; repeat the component to batch independent calls.                             |
| [TableOfContents](/components/table-of-contents/)         | Show the plan in one look: one linked row per section with its one-line gist.                                        |
| [Wireframe](/components/wireframe/)                       | Draw true-size product screens and connect them into a short walkable prototype.                                     |

## Decision-family review

`Decision`, `QuickDecision`, and `DecisionAnalysis` share the viewer's anchored comment workflow. Reviewers can click a target or reach it with the keyboard, add a comment, and see comment presence at that target. Each card keeps its notes in an inline tray; switching targets or collapsing the card saves an unfinished comment instead of discarding it, and **Add to plan feedback** hands the card's batch to the page-level feedback package when one is available.

Every card, option, recommendation, and other meaningful family-specific target has a stable address rooted at `component/<ComponentName>#<ordinal>`. A child without an authored `id` uses a slug of its visible label. Explicit ids reserve their namespace before those prose-derived slugs are allocated, so an earlier label cannot take a later authored address; duplicate explicit ids fail validation instead of receiving silent suffixes.

Scoped child components are valid only in their declared hierarchy: `Annotation` in `CodeDiff` and `CodeSnippet`; `Column` in `DataTable`; `Ddl` in `DatabaseTableSchema`; `Stage` and `Edge` directly in `FlowDiagram`, with `Node` directly in that `Stage`; `Entry` in `TableOfContents`; `Option` directly in `Decision`, with `Consideration` directly in that `Option`; `Criterion`, `Details`, `Option`, and `Reversibility` directly in `DecisionAnalysis`, with `Score` directly in an `Option`; `Option` directly in `QuickDecision`; `Param`, `Request`, and `Response` in `HttpEndpoint`; `Argument`, `Field`, `Returns`, `Operation`, `Variables`, and `Response` in `GraphqlOperation`; `Field`, `Error`, `Example`, and `Proto` in `GrpcMethod`; and the screen and drawing vocabulary documented under [`Wireframe`](/components/wireframe/).
