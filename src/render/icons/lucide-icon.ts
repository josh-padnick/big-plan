// Converts official Lucide icon-node data into HAST elements so renderer
// features can inline real Lucide SVGs without adding browser dependencies.

import type { Element } from "hast";
import type { IconNode } from "lucide";

// Builds one decorative Lucide SVG; the button or other owning control keeps
// responsibility for the accessible name.
export const renderLucideIcon = ({
  icon,
  name,
  hidden,
}: {
  readonly icon: IconNode;
  readonly name: string;
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
    "data-lucide": name,
    ...(hidden ? { hidden: true } : {}),
  },
  children: icon.map(([tagName, properties]) => ({
    type: "element",
    tagName,
    properties: { ...properties },
    children: [],
  })),
});
