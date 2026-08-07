// Adapts framework-neutral Lucide catalog data to the review island's React
// presentation edge so browser controls never define private icon geometry.

import { createElement } from "react";
import type { LucideIcon } from "../../icons/lucide-icon.js";

/** Renders one catalog glyph at the size owned by its surrounding control. */
export const Icon = ({ icon }: { readonly icon: LucideIcon }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="size-4"
  >
    {icon.node.map(([tagName, properties], index) =>
      createElement(tagName, {
        ...properties,
        key: `${tagName}-${index}`,
      }),
    )}
  </svg>
);
