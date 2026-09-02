---
title: Choose the right component
description: Pick between the components that look interchangeable, and know when prose beats all of them.
---

Twenty components is enough that several pairs look like each other. This page is only about
those choices. For what one component accepts, go to its own page under
[Components](/components/).

## First: does this need a component at all?

A component earns its place when it presents information better than a paragraph can. If the
content is an argument, prose is usually right. Reach for a component when the reader needs to
compare, scan, sort, or point at something.

Never draw an illustration as ASCII art in a code fence: it breaks on a narrow screen, says
nothing to a screen reader, and gives the reviewer nothing to comment on.

## Decisions

| Reach for | When |
| --- | --- |
| [`QuickDecision`](/components/quick-decision/) | One small question with a couple of options and no comparison worth showing. Repeat it for a batch of independent calls |
| [`Decision`](/components/decision/) | One tradeoff read option by option, where each option carries a few verdict-lined considerations |
| [`DecisionAnalysis`](/components/decision-analysis/) | A weighty choice the reviewer should audit across explicit criteria, optionally with 1–5 impacts and scores |

The dividing line is what the reviewer needs to *see* to answer. If the answer is obvious once
the options are named, use `QuickDecision`. If they need the considerations side by side, use
`Decision`. If they need to check your arithmetic, use `DecisionAnalysis`.

Mark a decision `critical` only when the reviewer must settle it before work begins. A plan
where everything is critical tells the reviewer nothing about where to start.

## Code

| Reach for | When |
| --- | --- |
| [`CodeSnippet`](/components/code-snippet/) | Existing code the reviewer should read, with optional file identity and file-absolute line numbers |
| [`CodeDiff`](/components/code-diff/) | A change to one file, with gutters, change counts, and line-anchored annotations |
| A fenced code block | A command to run, a config sample, or output to expect — anything with no file identity and no change to show |

## Files

| Reach for | When |
| --- | --- |
| [`FileTree`](/components/file-tree/) | The current layout, or where new code will live, with no change status |
| [`FileTreeDiff`](/components/file-tree-diff/) | Entry-level added, modified, removed, and renamed status across a tree |

`FileTreeDiff` rejects a tree with no change status and points you at `FileTree`; `FileTree`
rejects change badges and points you back. Show only the subtree the plan touches.

## Diagrams

| Reach for | When |
| --- | --- |
| [`FlowDiagram`](/components/flow-diagram/) | A staged left-to-right story: a flow, a dependency, or a fan-out, drawn as cards joined by verb-labeled connectors |
| [`MermaidDiagram`](/components/mermaid-diagram/) | A general graph beyond a staged story, or a sequence, class, state, entity-relationship, schedule, journey, pie, mindmap, timeline, or git view |

Neither is for a list of claims. If the arrows would not say anything, it is a list.

## Reference data

| Reach for | When |
| --- | --- |
| A Markdown table | The default. Under roughly ten rows and four columns |
| [`DataTable`](/components/data-table/) | The grid runs past about ten rows, carries more than four columns, would scroll sideways as prose, or is a reference the reviewer returns to |

A prose table cannot wrap, sort, or filter; that is the whole difference. One or two
`DataTable`s per plan — a plan that is mostly grids has stopped making an argument.

## Contracts

Each of these is for one thing, so the choice is just which thing you are describing:
[`HttpEndpoint`](/components/http-endpoint/) for one HTTP endpoint,
[`GraphqlOperation`](/components/graphql-operation/) for one query, mutation, or subscription,
[`GrpcMethod`](/components/grpc-method/) for one gRPC method, and
[`DatabaseTableSchema`](/components/database-table-schema/) for one table.

## Structure

| Reach for | When |
| --- | --- |
| [`QuickSummary`](/components/quick-summary/) | Exactly once, directly after the lede: the points a reviewer reads first |
| [`TableOfContents`](/components/table-of-contents/) | Directly after the quick summary: one row per section, so the whole argument is visible before any of it is read |
| [`Part`](/components/part/) | Dividing the deck into about three acts |
| [`Slide`](/components/slide/) | A section whose purpose matches one of the [five registered types](/authoring/slide-types/) |
| [`Callout`](/components/callout/) | The one thing a skimming reviewer must not miss |

A callout interrupts reading, so use one only when the interruption is the point. More than a
few and they stop working.

## UI

[`Wireframe`](/components/wireframe/) draws true-size product screens and connects them into a
short walkable prototype. Reach for it when a reviewer must see a screen to judge the plan,
and not otherwise. Run `big-plan guidance Wireframe` before drawing: it owns the fixed-envelope
rules and the visual fundamentals, and it is long because drawing UI badly is easy.

## Next

[Fix a validation error](/authoring/fix-a-validation-error/) — when the validator says no.
