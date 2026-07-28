// Converts official Lucide icon-node data into HAST elements so renderer
// features can inline real Lucide SVGs without adding browser dependencies.
//
// Lucide's normal packages create DOM nodes or framework components, but this
// renderer runs in Node and constructs HAST before any browser DOM exists.
// Importing Lucide's root catalog for two icons also imposes a large install
// and startup cost, so callers keep the small official icon-node assets local
// and use this adapter to serialize them into the self-contained HTML. React
// views consume the same local icon-node data directly, while this HAST adapter
// remains for non-React renderer features.

import type { Element } from "hast";
import type { LucideIcon } from "../../icons/lucide-icon.js";

// Builds one decorative Lucide SVG; the button or other owning control keeps
// responsibility for the accessible name.
export const renderLucideIcon = ({
  icon,
  hidden,
}: {
  readonly icon: LucideIcon;
  readonly hidden: boolean;
}): Element => ({
  type: "element",
  tagName: "svg",
  properties: {
    xmlns: "http://www.w3.org/2000/svg",
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ariaHidden: "true",
    "data-lucide": icon.name,
    ...(hidden ? { hidden: true } : {}),
  },
  children: icon.node.map(([tagName, properties]) => ({
    type: "element",
    tagName,
    properties: { ...properties },
    children: [],
  })),
});
