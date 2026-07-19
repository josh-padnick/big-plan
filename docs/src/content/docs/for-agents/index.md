---
title: Render a plan for human review
description: Follow the exact operational workflow an agent uses to hand a rendered plan to a person.
---

Use this workflow after writing a plan as a GFM Markdown file and before acting on it.

## Prerequisite

Confirm that Node.js 22 or newer is available.

```sh
node --version
```

## Render the review document

From the working directory that contains the plan path, run:

```sh
npx big-plan render <plan.md>
```

Replace `<plan.md>` with the actual path to the plan.
For example:

```sh
npx big-plan render plans/implementation.md
```

The command creates `plans/implementation.html` next to the source plan.
Give the human reviewer that HTML path and wait for agreement before acting on the plan.

To choose a different location, pass it as the second argument:

```sh
npx big-plan render plans/implementation.md reviews/implementation.html
```

The command creates missing parent directories for that output path.

## Read these docs as Markdown

Every page on this site is published twice: as HTML for humans, and as clean Markdown for agents.
Do not scrape the HTML pages; fetch the Markdown endpoints instead.

### The three endpoints

| Endpoint | What it returns | Fetch it when |
| --- | --- | --- |
| [`/llms.txt`](/llms.txt) | A curated map of every page, grouped by section, with one-line descriptions and links to each page's `.md` URL | You want to discover what documentation exists |
| Any page path + `.md` | That single page as raw Markdown | You need specific pages and want to spend minimal tokens |
| [`/llms-full.txt`](/llms-full.txt) | The complete documentation concatenated into one Markdown document | You want everything in one request |

### How per-page Markdown URLs work

Replace a page's trailing slash with `.md`:

```text
https://big-plan.ai/intro/installation/     ->  https://big-plan.ai/intro/installation.md
https://big-plan.ai/reference/cli/        ->  https://big-plan.ai/reference/cli.md
https://big-plan.ai/for-agents/           ->  https://big-plan.ai/for-agents.md
```

Each `.md` response starts with frontmatter carrying `title`, `description`, and `canonical` (the page's HTML URL), followed by the page's untouched Markdown source.
There is no navigation chrome, no sidebar, and no HTML to parse.

### Recommended flow

1. Fetch [`/llms.txt`](/llms.txt) once to see the map.
2. Fetch the `.md` URLs of only the pages your task needs; start with [`/reference/cli.md`](/reference/cli.md) for command details.
3. Fall back to [`/llms-full.txt`](/llms-full.txt) only when you genuinely need the whole corpus.
