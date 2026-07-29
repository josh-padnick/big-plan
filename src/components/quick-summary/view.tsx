// Renders a compiled QuickSummary as the standout key-points card a reviewer
// reads first: each facet is its own bounded box with an accent label inside,
// under a sentence-case title that outranks the facet labels.

import type { CompiledQuickSummary, QuickSummaryFacetName } from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

const FACET_LABELS: Readonly<Record<QuickSummaryFacetName, string>> = {
  What: "What",
  How: "How",
  OpenQuestions: "Open questions",
};

export const QuickSummary = ({
  model,
}: {
  readonly model: CompiledQuickSummary;
}) => (
  <aside
    data-quick-summary
    className="mb-8 rounded-lg border border-edge bg-surface px-5 py-4"
  >
    <p className="mb-3 text-[1.0625rem] font-semibold text-ink">
      Quick summary
    </p>
    <dl className="m-0 space-y-3">
      {model.facets.map((facet) => (
        <div
          key={facet.name}
          className="rounded-lg border border-edge bg-paper px-4 pt-2.5 pb-3"
        >
          <dt className="mb-1.5 text-xs font-semibold tracking-[0.08em] uppercase text-accent">
            {FACET_LABELS[facet.name]}
          </dt>
          <dd className="m-0">
            <ul className="m-0 list-disc space-y-1 pl-4">
              {facet.items.map((item, index) => (
                <li key={index} className="m-0">
                  {hastContentToReact(item)}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  </aside>
);
