// Renders the local official Lucide icon-node data directly as React SVGs.

import { createElement } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "../render/icons/lucide-icon.js";

/** Renders one decorative Lucide SVG as a React node. */
export const lucideIconToReact = ({
  icon,
  hidden,
}: {
  readonly icon: LucideIcon;
  readonly hidden: boolean;
}): ReactNode => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    data-lucide={icon.name}
    {...(hidden ? { hidden: true } : {})}
  >
    {icon.node.map(([tagName, properties], index) =>
      createElement(tagName, { ...properties, key: index }),
    )}
  </svg>
);
