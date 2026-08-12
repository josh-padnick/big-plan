<!--
Owns Big Plan's two-artifact delivery contract and the boundary between its
server-rendered content floor and React interaction islands.
-->

# ADR 0001: Two-artifact plan delivery

- Status: Accepted
- Date: 2026-08-06

## Context

Big Plan's authoritative plan is an MDX source document, while reviewers need a
self-contained HTML document with the viewer chrome and interactive reading
affordances. The HTML render is the human review artifact; the MDX source is the
static export and source of truth. A script-free HTML export would create a
second delivery pipeline and invite the two artifacts to drift.

The rendered document must preserve a readable content floor when JavaScript is
disabled. That floor does not promise that every interactive affordance can
operate without scripts: sorting, collapse, maximize, comments, and similar
interactions may require the embedded viewer scripts. Script-dependent controls
must remain dormant until their behavior is wired.

## Decision

A plan ships as exactly two review artifacts: the authoritative MDX source and
one self-contained interactive HTML render. Big Plan does not ship a separate
script-free HTML variant.

The interaction tier uses React and off-the-shelf shadcn/ui for new commenting surfaces, themed through the design tokens.
React owns interaction islands only.
The server-rendered readable HTML content floor is an explicit inviolable line.

## Rationale

This keeps one human delivery path and makes the source on disk authoritative.
It also gives reviewers dependable access to the plan's content offline or with
scripts disabled, while allowing interaction-rich review work to use the viewer
runtime where it provides real value.

## Rejected alternatives

We rejected shipping a separate script-free HTML export. It would duplicate the
delivery model, increase packaging and verification cost, and blur which HTML
artifact is authoritative for human review.

## Consequences

- Documentation and engineering guardrails describe readability as the floor,
  not universal no-JS operation.
- Interactive affordances may depend on the embedded viewer scripts and must be
  hidden or otherwise dormant before those scripts wire them.
- New commenting UI uses React and shadcn/ui inside interaction islands, with
  design-token theming; React must not replace the server-rendered content floor.
- Changes to the delivery contract require amending this ADR and updating the
  docs and tests that enforce it.
