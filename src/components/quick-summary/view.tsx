// Renders a compiled QuickSummary as the standout key-points card a reviewer
// reads first: a label column of facets beside their few short bullets, so
// the card scans as a grid rather than a wall of bullets.

import { Fragment } from "react";
import type { CompiledQuickSummary } from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

export const QuickSummary = ({
  model,
}: {
  readonly model: CompiledQuickSummary;
}) => (
  <aside
    data-quick-summary
    className="mb-8 rounded-lg border border-edge bg-surface px-5 py-4"
  >
    <p className="mb-3 text-xs font-semibold tracking-[0.08em] uppercase text-accent">
      Quick summary
    </p>
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5">
      {model.facets.map((facet) => (
        <Fragment key={facet.name}>
          <dt className="pt-px text-xs font-semibold tracking-[0.08em] uppercase text-muted">
            {facet.name}
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
        </Fragment>
      ))}
    </dl>
  </aside>
);
