// Renders a compiled Part as the act divider between slide groups: a
// borderless surface-tinted band carrying the accent part tag and the act
// title, anchored by its allocated id so the TOC's part headers can link to
// it. The tag's number is document-order knowledge read from the completed
// document outline; without one the tag stays empty. Collapse chrome is
// injected by the deck transform around this band, not by the Part view.

import type { DocumentOutline } from "../_model/document-outline/document-outline.js";
import type { CompiledPart } from "./compile.js";

export const Part = ({
  model,
  outline,
}: {
  readonly model: CompiledPart;
  readonly outline: DocumentOutline;
}) => {
  const number = outline.parts.find(
    (part) => part.id !== undefined && part.id === model.id,
  )?.number;
  return (
    <div
      data-part
      data-part-title={model.title}
      id={model.id}
      className="plan-part flex items-baseline gap-3 rounded-xl bg-surface px-4 py-2"
    >
      <span
        data-part-number
        className="text-sm font-semibold tracking-caps whitespace-nowrap uppercase text-subtle"
      >
        {number === undefined ? null : `Part ${number}`}
      </span>
      <span className="text-2xl font-bold tracking-tight text-ink">
        {model.title}
      </span>
    </div>
  );
};
