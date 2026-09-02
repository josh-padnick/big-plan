---
title: Sample plans
description: Real Big Plan documents you can read in your browser, rendered from the repository's own example plans.
---

The fastest way to understand Big Plan is to read one. These are real documents, rendered by
the current CLI from plans that live in the repository — not screenshots, and not mockups.

Open one and try it: the section navigation, the collapse controls, the copy and maximize
buttons on code and tables. Everything except commenting works in a standalone document,
because commenting needs a live review behind it.

## The samples

| Plan                                                      | What it shows                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Rate limiting for a public API](/samples/rate-limiting/) | A short, ordinary plan: a decision, a code diff, a schema, and a verification contract.        |
| [A payments retry queue](/samples/retry-queue/)           | A plan structured as a deck: numbered acts, typed slides, and a decision the reviewer answers. |
| [A workflow builder surface](/samples/workflow-builder/)  | A UI-heavy plan whose wireframes you can click through as a short prototype.                   |
| [Every component at once](/samples/all-components/)       | A deliberately maximal plan that renders all twenty components in one document.                |

## What you are looking at

Each sample is one MDX file rendered with `big-plan render`, which produces a single
self-contained HTML document: embedded styles, fonts, and images, no external requests, and a
complete reading experience with JavaScript disabled.

Every sample page links to both the rendered document and the plain Markdown source it came
from, so you can see exactly what the agent wrote and what Big Plan made of it.

## Next

[Rate limiting for a public API](/samples/rate-limiting/) — the one to read first.
