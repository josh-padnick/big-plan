# Using DataTable well

A dataset the reviewer queries - sortable columns, an optional filter, chooseable columns, and text that wraps instead of scrolling off the page.

- Default to a plain markdown table. Reach for `DataTable` when the grid runs past roughly ten rows, carries more than four columns, would scroll sideways as prose, or is a reference the reviewer returns to. A prose table cannot wrap, sort, or filter; that is the whole difference.
- The body is one fenced block with language `table` holding an ordinary GFM pipe grid, so a markdown table that outgrew itself is wrapped, not rewritten. The delimiter row's colons still set alignment.
- Add `filter` only when the table is long enough that the reviewer will hunt a row. On a short table the search box is chrome that earns nothing.
- Declare `<Column name="..." />` only to override a default: `type="number"` or `type="date"` for a correct comparator, `align`, `sort="asc"` on at most one column for the opening order, and `fit` when one column should behave differently from the rest.
- Leave `fit` alone unless you mean it. Wrapping is the default because horizontal scrollbars hide content the reviewer cannot tell is there, and the reader can change it from the Text fit control anyway. Use `fit="truncate"` when cells are long identifiers - paths, URLs, ids - that wrap into unreadable stacks, and `fit="scroll"` only when side-by-side adjacency is itself the information.
- `groupBy="Importance"` bands the rows under one column's values. The column stays a real column - listed, sortable, revealable - and only hides while it supplies the bands, because grouping is a setting over the data rather than a different shape of data. You choose the default; the reader can regroup by any column or turn it off. Sorting stays inside a group. One level only.
- Cells carry plain text and `inline code`. Anything needing a sentence of explanation belongs in the prose around the table, not inside a cell.
- A table sizes to its contents and only reaches for the full reading width when the content needs it. Three narrow columns stay narrow; nothing stretches to fill the page. You do not set a width, and there is no attribute for one - if a table looks too wide, the cause is a column carrying prose that belongs in the paragraph around it.
- One or two per plan. A plan that is mostly grids has stopped making an argument.
