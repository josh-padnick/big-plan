// Renders a compiled QuickSummary as one slide that starts with the why: an
// accent-banded Why hero above quieter What and How cards.
//
// The panel is the approved shape and inverts the usual depth model on purpose.
// The card is a tinted tray that sits BELOW the page, and each facet is a
// lighter block raised on top of it, so the three answers read as cards laid
// out on a surface rather than as wells cut into one. The captain approved this
// treatment before Phase B and it is the reference for this component.

import type { ElementContent } from "hast";
import type { CompiledQuickSummary } from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

// A facet label keeps the accent. It is the one label in the product that names
// the reader's question rather than the product's own structure, which is why
// it survives the rule that a label is tertiary.
const Label = ({ text }: { readonly text: string }) => (
  <dt className="mb-1 text-xs leading-4 font-semibold tracking-caps uppercase text-accent">
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
      className="mb-8 max-w-[var(--measure)] rounded-lg bg-tray px-6 py-4"
    >
      <p className="mb-3 text-lg font-semibold text-ink">Quick summary</p>
      <dl className="m-0">
        {why === undefined ? null : (
          <div className="quick-summary-why mb-4 rounded-r-lg border-l-[3px] border-accent bg-accent-wash px-4 py-3 text-lg text-ink">
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
              className="rounded-lg bg-paper px-4 py-3 shadow-raised"
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
