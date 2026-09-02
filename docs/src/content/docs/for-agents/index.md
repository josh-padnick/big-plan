---
title: For Agents
description: Documentation written for coding agents that operate Big Plan; humans are welcome, but it is not written for them.
---

This section is written for coding agents, not people.
It carries operational steps, exact commands, and machine-readable endpoints, with none of the context or persuasion a human reader wants.

If you're a human, the same ground is covered for you in [What is Big Plan?](/intro/what-is-big-plan/) and [Installation](/intro/installation/).
Reading on anyway is a fine way to audit exactly what your agent is told.

## Section guide

| Read this                                                    | When                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| [Set Big Plan up for your human](/for-agents/setup/)         | You were asked to set Big Plan up, once                            |
| [Write and validate a plan](/for-agents/write-and-validate/) | Every session, before you implement anything                       |
| [Answer reviewer feedback](/for-agents/answer-feedback/)     | A human is commenting on a live review                             |
| [Handle a handoff or disconnect](/for-agents/handoff/)       | You got `NOT_PRIMARY`, `AGENT_DISCONNECTED`, or an observer result |
| [Handle an approval](/for-agents/approval/)                  | An `approval` request arrived in your mailbox                      |
| [Install and update the skill](/for-agents/use-the-skill/)   | A harness wants a discoverable `SKILL.md`                          |

The plan **format** is not in this section, because a human plan author needs it as much as
you do: it is [Writing plans](/authoring/).

## Read these docs as Markdown

Every page on this site is published twice: as HTML for humans, and as clean Markdown for agents.
Do not scrape the HTML pages; fetch the Markdown endpoints instead.

| Endpoint                           | What it returns                                                                                                | Fetch it when                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`/llms.txt`](/llms.txt)           | A curated map of every page, grouped by section, with one-line descriptions and links to each page's `.md` URL | You want to discover what documentation exists           |
| Any page path + `.md`              | That single page as raw Markdown                                                                               | You need specific pages and want to spend minimal tokens |
| [`/llms-full.txt`](/llms-full.txt) | The complete documentation concatenated into one Markdown document                                             | You want everything in one request                       |

Replace a page's trailing slash with `.md`:

```text
https://bigplan.dev/intro/installation/       ->  https://bigplan.dev/intro/installation.md
https://bigplan.dev/reference/error-codes/    ->  https://bigplan.dev/reference/error-codes.md
https://bigplan.dev/for-agents/handoff/       ->  https://bigplan.dev/for-agents/handoff.md
```

Each `.md` response starts with frontmatter carrying `title`, `description`, and `canonical` (the page's HTML URL), followed by a clean Markdown projection of the page that removes presentation-only MDX.
Fetch [`/llms.txt`](/llms.txt) once to see the map, fetch the `.md` URLs your task needs, and fall back to [`/llms-full.txt`](/llms-full.txt) only when you genuinely need the whole corpus.

## Next

[Set Big Plan up for your human](/for-agents/setup/) — the one-time setup, also published at
[/setup.md](/setup.md) for the stable install prompt.
