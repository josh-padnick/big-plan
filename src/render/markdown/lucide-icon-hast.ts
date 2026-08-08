// Adapts framework-neutral Lucide icon data to HAST, the rendering edge the
// deck and code-figure transforms build against. The React edge has its own adapter in
// components/_shared/lucide-icon; neither owns glyph data.

import type { Element } from "hast";
import {
  DEFAULT_LUCIDE_STROKE_WIDTH,
  type LucideIcon,
} from "../../icons/lucide-icon.js";

/**
 * Renders one decorative Lucide glyph as an inert HAST SVG.
 *
 * The glyph is drawn centered in Lucide's 24x24 viewBox, which is what makes
 * a rotated icon keep its apparent position: rotating about the box center
 * moves ink that is already centered on that point. A hand-drawn chevron
 * (say, two borders of a square) has its ink off-center, so each rotation
 * lands it somewhere different and the icon appears to jump between states.
 */
export const lucideIconToHast = ({
  icon,
  hidden = false,
}: {
  readonly icon: LucideIcon;
  // A control that swaps between two glyphs ships both and hides one, so the
  // viewer script only ever toggles visibility rather than building markup.
  readonly hidden?: boolean;
}): Element => ({
  type: "element",
  tagName: "svg",
  properties: {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": icon.strokeWidth ?? DEFAULT_LUCIDE_STROKE_WIDTH,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    "data-lucide": icon.name,
    ...(hidden ? { hidden: true } : {}),
  },
  children: icon.node.map(([tagName, properties]) => ({
    type: "element" as const,
    tagName,
    properties: { ...properties },
    children: [],
  })),
});
