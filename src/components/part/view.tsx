// Renders a compiled Part as the act divider between slide groups: a
// borderless surface-tinted band carrying the accent part tag and the act
// title, anchored by its allocated id so the TOC's part headers can link to
// it. The tag's number is document-order knowledge, so the renderer's deck
// transform fills the [data-part-number] slot after assembly.

import type { CompiledPart } from "./compile.js";

export const Part = ({ model }: { readonly model: CompiledPart }) => (
  <div
    data-part
    data-part-title={model.title}
    id={model.id}
    className="plan-part mt-[3.8rem] mb-[1.3rem] flex items-baseline gap-3 rounded-[0.6rem] bg-surface px-[1.1rem] py-[0.55rem]"
  >
    <span
      data-part-number
      className="text-[0.8125rem] font-bold tracking-[0.1em] whitespace-nowrap uppercase text-accent"
    />
    <span className="text-[1.45rem] leading-tight font-bold text-ink">
      {model.title}
    </span>
  </div>
);
