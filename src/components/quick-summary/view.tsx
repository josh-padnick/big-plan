// Renders a compiled QuickSummary as one slide that starts with the why: an
// accent-banded Why hero above quieter What and How cards.
//
// The panel is the approved shape and inverts the usual depth model on purpose.
// The card is a tinted tray that sits BELOW the page, and each facet is a
// lighter block raised on top of it, so the three answers read as cards laid
// out on a surface rather than as wells cut into one.
//
// This component carries the metrics and the hairlines approved before the
// design pass, so several values here are exact rather than scale steps. The
// approved render is the reference; scripts/design-system/check.mjs records the
// exemption and .big-plan/refui-b-report.md records why.

import type { ElementContent } from "hast";
import type { CompiledQuickSummary } from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

// A facet label keeps the accent. It is the one label in the product that names
// the reader's question rather than the product's own structure, which is why
// it survives the rule that a label is tertiary.
const Label = ({ text }: { readonly text: string }) => (
  // approved-metric: the label tracking of the approved panel
  <dt className="mb-1 text-xs font-semibold tracking-[0.08em] uppercase text-accent">
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
      // approved-metric: the panel inset and hairline of the approved panel
      className="mb-8 max-w-[var(--measure)] rounded-lg border border-edge bg-tray px-5 py-4"
    >
      {/* approved-metric: the panel heading size */}
      <p className="mb-3 text-[1.0625rem] font-semibold text-ink">
        Quick summary
      </p>
      <dl className="m-0">
        {why === undefined ? null : (
          // approved-metric: the why hero size and its gap to the pair below
          <div className="quick-summary-why mb-[0.875rem] rounded-r-lg border-l-[3px] border-accent bg-accent-wash px-4 py-3 text-[1.0625rem] text-ink">
            <Label text="Why" />
            <dd className="m-0">
              <FacetBody items={why.items} />
            </dd>
          </div>
        )}
        <div className="grid gap-3">
          {rest.map((facet) => (
            <div
              key={facet.name}
              // approved-metric: the facet block inset and hairline
              className="rounded-lg border border-edge bg-paper px-4 pt-2.5 pb-3"
            >
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
