---
title: FileTreeDiff
description: A component for a project file hierarchy annotated with per-file change status, viewable as a combined tree or side-by-side before and after trees.
---

`FileTreeDiff` renders a file hierarchy where each entry can carry a change status - added, modified, removed, or renamed - so a reviewer sees the shape of a change across the tree.
It offers a combined change tree by default and a derived before-and-after view.

## When to use it

Use `FileTreeDiff` to show which files a plan touches and how: the additions, modifications, deletions, and renames, in their real directory structure, before any code is written.

### When not to use it

- A structure that does not change - a plain hierarchy is [`FileTree`](/components/file-tree/)'s job, and a `FileTreeDiff` with no change status is rejected
- The contents of one edit - showing the changed lines is [`CodeDiff`](/components/code-diff/)'s job

## Use cases

- Summarize the file-level footprint of a plan at a glance
- Confirm a rename lands where intended by reading the before and after trees side by side

## How it looks

:::note[📸 Screenshot placeholder]
A bordered tree titled and topped with a Combined / Before-After toggle; entries tint their names by change status - deletions struck through - and spell out Added, Modified, Deleted, or Renamed at the row's edge, with the before and after trees shown as two panes.
:::

## Usage

````mdx
<FileTreeDiff title="Planned changes">

```tree
src/
  catalog/
    refresh-worker.ts [modified] - Move refresh work behind the queue.
    refresh-queue.ts [added] - Deduplicate refresh jobs by cache key.
  metrics/
    legacy-cache-counter.ts [removed] - Replace the ambiguous cache counter.
config/
  catalog-worker.env -> catalog-cache-worker.env [renamed] - Rename the worker config.
README.md [modified] - Document the stale-while-revalidate path.
```

</FileTreeDiff>
````

## Authoring

### Attributes

| Attribute | Type               | Required | Behavior                                                               |
| --------- | ------------------ | -------- | ---------------------------------------------------------------------- |
| `title`   | string (non-empty) | No       | Header caption beside the view toggle; omitted, only the toggle shows. |

Any other attribute is a positional authoring error.

### Children

The component takes exactly one fenced code block with the `tree` language, and nothing else.
It must carry at least one change status; a tree with none is rejected with a pointer to `FileTree`.

### Tree grammar

`FileTreeDiff` uses the same indentation, directory, and note grammar as [`FileTree`](/components/file-tree/#tree-grammar), plus change syntax:

- Append a status in brackets after the name: `[added]`, `[modified]`, `[removed]`, or `[renamed]`.
- Write a rename as `old -> new [renamed]`; both sides must stay files or stay directories, and the arrow only pairs with `[renamed]`.

Each status tints the entry name in its change color and spells out Added, Modified, Deleted, or Renamed at the row's edge beside a GitHub-style status square, the way git tooling presents working-tree status; deleted names are additionally struck through.
A note on an entry renders as a hoverable comment hint rather than inline text, keeping rows status-first; the note stays available to assistive technology and in copied selections.
Every violation - an unknown badge, a rename without its `[renamed]` badge, or a tree with no change at all - reports a positional diagnostic.

## Views

The combined tree is the default and the only view rendered without JavaScript.
A reviewer can switch to the before-and-after view, which derives two trees from the single authored tree: the before tree drops added entries and shows old rename names, and the after tree drops removed entries and shows new rename names.
The before tree is a snapshot of today's hierarchy, so it marks only entries that will disappear (removed files and old rename names); added and modified markers read on the after tree where they land.
The selection persists across documents, and the two panes sit side by side on wide screens and stack, before above after, below the layout breakpoint.
A full-screen control expands the tree into a modal dialog - named by the component's title when one is set - and closing it returns the reader to their exact scroll position.
