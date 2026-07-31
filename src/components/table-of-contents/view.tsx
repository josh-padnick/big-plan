// Renders a compiled TableOfContents as "The plan in one look": stacked rows of
// section title over gist, each row one link to its section. Row numbers,
// hrefs, and part group headers are document-order knowledge read from the
// completed document outline: rows map to the outline's sections in document
// order, a group header precedes the first row of every part, and a row
// beyond the outline keeps its placeholder link (the
// table-of-contents-matches-sections lint rule owns reporting mismatches).
// Hover feedback is pure CSS - the row wash from the colocated stylesheet,
// the title accent from a group variant here - so the overview needs no
// script.

import { Fragment } from "react";
import type { DocumentOutlinePart } from "../_model/document-outline/document-outline.js";
import type { DocumentOutline } from "../_model/document-outline/document-outline.js";
import type { CompiledTableOfContents } from "./compile.js";

const GroupHeader = ({ part }: { readonly part: DocumentOutlinePart }) => (
  <p
    data-table-of-contents-group=""
    className="table-of-contents-group mt-2.5 mb-0.5 text-xs font-semibold uppercase tracking-[0.1em] text-accent"
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
      className="table-of-contents mb-10"
    >
      <p className="mb-2 text-[1.0625rem] font-semibold text-ink">
        The plan in one look
      </p>
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
              className="table-of-contents-row group -mx-2 grid w-fit max-w-full grid-cols-[2rem_minmax(0,max-content)] items-baseline gap-x-[0.9rem] rounded-md px-2 py-1.5 no-underline"
            >
              <span
                data-table-of-contents-num
                className="text-xs font-medium text-muted"
              >
                {section?.number}
              </span>
              {/* The title turns accent through a group variant; a stylesheet rule
                  on this span would lose to its own text-ink utility. */}
              <span className="table-of-contents-name block text-[0.9375rem] font-semibold text-ink group-hover:text-accent">
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
