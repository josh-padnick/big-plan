---
title: Rendered plans are inert
description: Why a plan cannot introduce script into its own rendered document, and what that buys you.
---

**The problem.** A plan is written by an agent, and a rendered plan is an HTML file a person
opens. If the plan could put code in that file, opening a plan would mean running whatever the
agent wrote. Big Plan removes the possibility rather than trying to sanitise it.

## The model

A rendered plan is one self-contained HTML file. Plan sources are MDX, but **plan-authored code never executes**: the compiler rejects ESM `import`/`export` statements, flow and text expressions, and inline JSX as compile errors rather than evaluating them. A plan cannot introduce script into its own rendered document.

The document embeds its own styles, fonts, and branding and makes no external requests, so opening one does not contact any server. It stays fully readable with JavaScript disabled.

Because arbitrary HTML is arbitrary script, `big-plan review` always renders the document in process from the authoritative MDX and never serves a pre-existing `.html` file.

## What follows from it

- **You can open a plan someone sent you.** It contacts no server, phones nothing home, and
  needs no network at all.
- **The document is readable with JavaScript disabled.** Scripts add the documented reader
  interactions; they never render or gate plan content.
- **`review` never serves a pre-existing `.html` file.** Arbitrary HTML is arbitrary script, so
  the runtime always renders the document in process from the authoritative MDX.
- **A failed plan renders nothing at all.** An invalid document never renders partially;
  validation collects every recoverable problem and fails with the complete list. A silently
  degraded document would be worse than a failed one, because the entire product is trust in
  what the reviewer approves.

## Related

- [How Big Plan works](/concepts/how-it-works/) — the compilation path that rejects the code.
- [Writing plans](/authoring/) — exactly what a plan may and may not contain.

## Next

[Reporting a vulnerability](/security/reporting/) — how to reach us privately.
