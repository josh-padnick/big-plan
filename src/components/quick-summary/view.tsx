// Renders a compiled QuickSummary as one slide that starts with the why: an
// accent-banded Why hero above quieter What and How cards.

import type { ElementContent } from "hast";
import type { CompiledQuickSummary } from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

// /* off-scale */ Phase A preserves the legacy hero type, 3px accent rule,
// tracking, and token wash exactly; Phase B will select scale-backed values.
const Label = ({ text }: { readonly text: string }) => (
  <dt className="mb-1 text-xs font-semibold tracking-caps uppercase text-subtle">
    {text}
  </dt>
);

const FacetBody = ({
  items,
}: {
  readonly items: ReadonlyArray<ReadonlyArray<ElementContent>>;
}) =>
  items.length === 1 ? (
    <div className="[&>:last-child]:mb-0">
      {hastContentToReact(items[0] ?? [])}
    </div>
  ) : (
    <ul className="m-0 list-disc space-y-1 pl-4">
      {items.map((item, index) => (
        <li key={index} className="m-0">
          {hastContentToReact(item)}
        </li>
      ))}
    </ul>
  );

export const QuickSummary = ({
  model,
}: {
  readonly model: CompiledQuickSummary;
}) => {
  const why = model.facets.find((facet) => facet.name === "Why");
  const rest = model.facets.filter((facet) => facet.name !== "Why");
  return (
    <aside
      data-quick-summary
      className="mb-8 max-w-[var(--measure)] rounded-xl bg-raised px-6 py-4 shadow-raised"
    >
      <p className="mb-3 text-lg font-semibold text-subtle">Quick summary</p>
      <dl className="m-0">
        {why === undefined ? null : (
          <div className="quick-summary-why mb-4 rounded-r-lg border-l-[3px] border-accent bg-accent-soft px-4 py-3 text-lg text-[var(--accent-soft-ink-c)]">
            <Label text="Why" />
            <dd className="m-0">
              <FacetBody items={why.items} />
            </dd>
          </div>
        )}
        <div className="grid gap-3">
          {rest.map((facet) => (
            <div key={facet.name} className="rounded-lg bg-well px-4 py-3">
              <Label text={facet.name} />
              <dd className="m-0">
                <FacetBody items={facet.items} />
              </dd>
            </div>
          ))}
        </div>
      </dl>
    </aside>
  );
};
