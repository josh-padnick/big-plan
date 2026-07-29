// Renders a compiled TableOfContents as "The plan in one look": stacked rows of
// section title over gist, each row one link to its section. Row numbers,
// hrefs, and part group headers are document-order knowledge, so the
// renderer's deck transform fills the [data-table-of-contents-num] slots, the row
// targets, and the group headers after assembly. Hover feedback is pure CSS -
// the row wash from the colocated stylesheet, the title accent from a group
// variant here - so the overview needs no script.

import type { CompiledTableOfContents } from "./compile.js";

export const TableOfContents = ({
  model,
}: {
  readonly model: CompiledTableOfContents;
}) => (
  <nav
    data-table-of-contents
    aria-label="The plan in one look"
    className="table-of-contents mb-10"
  >
    <p className="mb-2 text-[1.0625rem] font-semibold text-ink">
      The plan in one look
    </p>
    {model.entries.map((entry, index) => (
      <a
        key={index}
        data-table-of-contents-row
        href="#"
        className="table-of-contents-row group -mx-2 grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-[0.9rem] rounded-md px-2 py-1.5 no-underline"
      >
        <span
          data-table-of-contents-num
          className="text-xs font-medium text-muted"
        />
        {/* The title turns accent through a group variant; a stylesheet rule
            on this span would lose to its own text-ink utility. */}
        <span className="table-of-contents-name block text-[0.9375rem] font-semibold text-ink group-hover:text-accent">
          {entry.section}
        </span>
        <span className="col-start-2 text-sm text-muted">{entry.gist}</span>
      </a>
    ))}
  </nav>
);
