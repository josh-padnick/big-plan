// Renders a compiled TableOfContents as "The plan in one look": stacked rows of
// structural section name over gist, each row one link to its section. Row numbers,
// hrefs, and part group headers are document-order knowledge read from the
// completed document outline: rows map to the outline's sections in document
// order, a group header precedes the first row of every part, and a row
// beyond the outline keeps its placeholder link (the
// table-of-contents-matches-sections lint rule owns reporting mismatches).
// Hover feedback is pure utilities, so the overview needs no script.

import { Fragment } from "react";
import type { DocumentOutlinePart } from "../_model/document-outline/document-outline.js";
import type { DocumentOutline } from "../_model/document-outline/document-outline.js";
import type { CompiledTableOfContents } from "./compile.js";

// /* off-scale */ Phase A preserves the legacy title size, row gap, tracking,
// and adaptive ink wash exactly; Phase B will choose scale-backed successors.
const GroupHeader = ({ part }: { readonly part: DocumentOutlinePart }) => (
  <p
    data-table-of-contents-group=""
    className="table-of-contents-group mt-3 mb-0.5 text-xs font-semibold uppercase tracking-caps text-subtle"
  >
    {`[${part.number}] ${part.title}`}
  </p>
);

export const TableOfContents = ({
  model,
  outline,
}: {
  readonly model: CompiledTableOfContents;
  readonly outline: DocumentOutline;
}) => {
  // Tracks the last headed part while rows render in order, so exactly one
  // group header precedes each part's first row.
  let headedPart: number | undefined;
  return (
    <nav
      data-table-of-contents
      aria-label="The plan in one look"
      className="table-of-contents mb-12"
    >
      {/* Semantic h2 for chrome only: nested inside the overview nav so it
          is not a deck slide, and sized to match slide-title h2 scale. */}
      <h2 className="table-of-contents-title m-0 mb-3 border-0 p-0 text-2xl font-semibold tracking-tight text-ink">
        The plan in one look
      </h2>
      {model.entries.map((entry, index) => {
        const section = outline.sections[index];
        const group =
          section?.part !== undefined && section.part.number !== headedPart
            ? section.part
            : undefined;
        if (group !== undefined) {
          headedPart = group.number;
        }
        return (
          <Fragment key={index}>
            {group === undefined ? null : <GroupHeader part={group} />}
            <a
              data-table-of-contents-row
              href={section?.id === undefined ? "#" : `#${section.id}`}
              className="table-of-contents-row group -mx-2 grid w-fit max-w-full grid-cols-[2rem_minmax(0,max-content)] items-baseline gap-x-4 rounded-md px-2 py-1.5 no-underline hover:bg-[color-mix(in_srgb,var(--ink-c)_4%,transparent)]"
            >
              <span
                data-table-of-contents-num
                className="text-xs font-medium text-subtle"
              >
                {section?.number}
              </span>
              {/* The name turns accent through a group variant; a stylesheet rule
                  on this span would lose to its own text-ink utility. */}
              <span className="table-of-contents-name block text-base font-semibold text-ink group-hover:text-accent">
                {entry.section}
              </span>
              <span className="col-start-2 text-sm text-muted">
                {entry.gist}
              </span>
            </a>
          </Fragment>
        );
      })}
    </nav>
  );
};
