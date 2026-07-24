---
title: Roadmap
description: What has shipped, what is in progress, and the component and review capabilities coming next.
---

Big Plan is pre-alpha and is being built in the open, one registry capability at a time.

## Shipped

- **The static viewer.** `big-plan render` converts a plan into one self-contained themed HTML document: section navigation, syntax highlighting, copy controls, and light/dark themes, readable with JavaScript disabled.
- **Components.** Plans parse as a static subset of MDX; a closed registry renders components server-side, and invalid documents fail loudly with positional diagnostics that aggregate recoverable problems. [`Callout`](/components/callout/) and [`CodeDiff`](/components/code-diff/) shipped first, including line-anchored `Annotation` notes on diffs.
- **Code and file-tree review.** [`CodeSnippet`](/components/code-snippet/) inspects annotated excerpts of existing code with file-absolute line numbers, while [`FileTree`](/components/file-tree/) and [`FileTreeDiff`](/components/file-tree-diff/) show plain hierarchies and per-entry change status with combined or side-by-side views.
- **API contract review.** [`HttpEndpoint`](/components/http-endpoint/), [`GraphqlOperation`](/components/graphql-operation/), and [`GrpcMethod`](/components/grpc-method/) render protocol-native contracts with validated fields, examples, and errors.
- **Table schema review.** [`DatabaseTableSchema`](/components/database-table-schema/) renders one table's validated DBML-subset schema with titled verbatim-DDL bands.

## Planned components

- **`Decision`.** Options-considered cards with nested `Option` children.
- **`Diagram`.** Diagram source rendered to inline SVG at build time, preserving the no-external-requests invariant.

## Planned review experience

- A local review server with a live bridge to the authoring agent.
- Highlight-to-comment threads the agent replies to in place.
- Versioned change review across plan revisions.
- Full keyboard control, and interactive components such as forms once the live server exists.

## Follow along

Big Plan is built in the open at [github.com/josh-padnick/big-plan](https://github.com/josh-padnick/big-plan).

## Next step

[Install Big Plan and render your first plan.](/intro/installation/)
