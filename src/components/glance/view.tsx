// Renders a compiled Glance as "The plan in one look": stacked rows of
// section title over gist, each row one link to its section. Row numbers,
// hrefs, and part group headers are document-order knowledge, so the
// renderer's deck transform fills the [data-glance-num] slots, the row
// targets, and the group headers after assembly. Hover feedback is pure CSS
// from the colocated stylesheet, so the overview needs no script.

import type { CompiledGlance } from "./compile.js";

export const Glance = ({ model }: { readonly model: CompiledGlance }) => (
  <nav data-glance aria-label="The plan in one look" className="glance mb-10">
    <p className="mb-2 text-[1.0625rem] font-semibold text-ink">
      The plan in one look
    </p>
    {model.items.map((item, index) => (
      <a
        key={index}
        data-glance-row
        href="#"
        className="glance-row -mx-2 grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-[0.9rem] rounded-md px-2 py-1.5 no-underline"
      >
        <span data-glance-num className="text-xs font-medium text-muted" />
        <span className="glance-name block text-[0.9375rem] font-semibold text-ink">
          {item.section}
        </span>
        <span className="col-start-2 text-sm text-muted">{item.gist}</span>
      </a>
    ))}
  </nav>
);
