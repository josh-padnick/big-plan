---
title: Philosophy
description: Plans are for human review, components make review first-class, and plans stay local and private.
---

Every design decision in Big Plan follows from three beliefs about what a plan should be.

## Plans are for human review

A plan has one reader who matters: the human who has to agree to it.
The agent doesn't need the rendering; it wrote the plan.
The rendered document exists to move the decision from the agent's output into a human's understanding.

So Big Plan optimizes everything for the reviewer.
Typography, navigation, and structure are judged by one test: does this help a person read, question, and decide?

## Components make review first-class

Humans don't consume all information the same way.
A code change wants a diff.
A schema wants a table.
A risk wants to stand out from the prose around it.
An architecture wants a diagram.

A wall of prose flattens all of those into identical paragraphs, and the reader pays the cost.
The best way to optimize a plan for human review is a collection of typed [components](/components/) that render each kind of information the way humans actually consume it.
That is why Big Plan is building a fixed component library instead of freeform pages: the agent picks the right component, and the reviewer gets the right presentation, every time.

## Plans are local and private

Plans routinely contain sensitive information: unreleased features, security fixes, architecture details, customer context.
Reading your own plan should never mean uploading it, and sharing it should be a deliberate choice, never a side effect.

Big Plan keeps the whole loop on your disk.
A markdown file goes in, one self-contained HTML file comes out, and nothing requires an account, a server, or an external request.

## Where this shows up

- The [viewer](/guides/the-viewer/) is the first belief shipped: a reading experience built for review.
- The [component library](/components/) is the second belief on the [roadmap](/intro/roadmap/).
- The third belief is why the comparison with hosted tools in [Big Plan vs. Other](/intro/vs-other/) comes down to custody.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
