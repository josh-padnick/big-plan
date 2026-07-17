---
title: The viewer
description: Understand the navigation, code, theme, and branding experience in a rendered plan.
---

The static viewer turns a GFM Markdown plan into a focused local review document.

## Navigate sections

The viewer builds its table of contents from level-two headings.
On wide screens, the table of contents stays in a sticky sidebar.
On narrower screens, a sticky `Sections` disclosure shows the section count.

Both navigation variants track the current section while the reader scrolls, including short final sections at the bottom of the page.
Section links scroll smoothly unless the reader has requested reduced motion.

## Read and copy code

Fenced code blocks receive syntax highlighting when they declare a supported language.
Undeclared and unknown languages remain plain and readable.
Every block code sample includes a copy control.

## Choose a theme

The light and dark theme follows the operating system preference until the reader chooses an override.
The viewer remembers that choice locally.

## Recognize the document

A sticky branding bar spans every viewport.
Its logo follows the active viewer theme.
Embedded light and dark favicons follow the operating system preference.

## Read without JavaScript

The document remains readable with JavaScript disabled.
Inline scripts progressively enhance the table of contents, theme control, and code-copy controls.
