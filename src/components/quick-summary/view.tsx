// Renders a compiled QuickSummary as the standout key-points card a reviewer
// reads first, visually distinct from body prose.

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
    <ul className="m-0 list-disc space-y-1.5 pl-5">
      {model.items.map((item, index) => (
        <li key={index} className="m-0">
          {hastContentToReact(item)}
        </li>
      ))}
    </ul>
  </aside>
);
