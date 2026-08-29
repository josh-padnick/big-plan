# Adding an icon

Start with the root [agent guide](../../AGENTS.md) for Big Plan's overall architecture.
This page answers the narrower question this directory keeps being asked: where does a glyph's path data come from, and what does adding one involve?

## Provenance

Big Plan takes no dependency on a Lucide package.
Each glyph is one hand-transcribed module holding Lucide's own icon-node data for that name, so the whole set is readable in the repository and ships without a build step resolving it.
That is also the only reason a set ever looks small: it holds the marks something has asked for, one file at a time, with no cap and no upstream limit behind it.

Upstream's `icon-nodes.json`, published in the `lucide-static` package, is the authoritative source for the node array.
Copy a name's entry verbatim rather than redrawing it, and keep the local file's name and its `name` field as upstream spells them, so the next person can diff one against the other.

## What a new glyph touches

A file here is only path data; nothing draws until a consumer names it.
Adding a glyph a wireframe author can write therefore means adding the mark here and the meaning it draws for in the wireframe slice's `model.ts` and `view-glyphs.ts` — that slice owns the vocabulary, and its key is exhaustive, so a meaning added without a mark fails to compile rather than shipping a placeholder.
