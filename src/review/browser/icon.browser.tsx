// Adapts framework-neutral Lucide and vendor brand-mark catalog data to the
// review island's React presentation edge so browser controls never define
// private icon geometry.

import { createElement } from "react";
import type { BrandIcon } from "../../icons/brand-icon.js";
import {
  DEFAULT_LUCIDE_STROKE_WIDTH,
  type LucideIcon,
} from "../../icons/lucide-icon.js";

/** Renders one catalog glyph at the size owned by its surrounding control. */
export const Icon = ({ icon }: { readonly icon: LucideIcon }) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth={icon.strokeWidth ?? DEFAULT_LUCIDE_STROKE_WIDTH}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {icon.node.map(([tagName, properties], index) =>
      createElement(tagName, {
        ...properties,
        key: `${tagName}-${index}`,
      }),
    )}
  </svg>
);

/** Renders one vendor brand mark on its own source-defined canvas. */
export const BrandIconView = ({ icon }: { readonly icon: BrandIcon }) => (
  <svg viewBox={icon.viewBox} width="1em" height="1em" aria-hidden="true">
    {icon.node.map(([tagName, properties], index) =>
      createElement(tagName, {
        ...properties,
        key: `${tagName}-${index}`,
      }),
    )}
  </svg>
);
