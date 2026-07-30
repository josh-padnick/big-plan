# Using TableOfContents well

The plan in one look: one row per section, so a reviewer sees the whole argument before reading any of it.
Place it directly after the `QuickSummary`, before the first `Part` or section.

- Write one `<Entry section="..." gist="..." />` per section, in document order; `section` repeats the h2 title exactly, and lint verifies the 1:1 match.
- A `gist` is the section's one-line takeaway at the altitude of a decision - "Embed the skill in the CLI (recommended) vs docs download" - never a topic label like "Distribution details".
- Big Plan links every row to its section and groups rows under the plan's `Part` acts automatically; author only the entries.
- Keep gists under roughly a dozen words; a TableOfContents that needs scrolling no longer fits in one look.
- Skip the TableOfContents only in a very short plan whose sidebar navigation already tells the whole story.
