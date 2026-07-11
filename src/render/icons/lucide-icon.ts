// Converts official Lucide icon-node data into HAST elements so renderer
// features can inline real Lucide SVGs without adding browser dependencies.
//
// Lucide's normal packages create DOM nodes or framework components, but this
// renderer runs in Node and constructs HAST before any browser DOM exists.
// Importing Lucide's root catalog for two icons also imposes a large install
// and startup cost, so callers keep the small official icon-node assets local
// and use this adapter to serialize them into the self-contained HTML. A future
// Vite-powered server UI can use Lucide's framework package directly; the
// static render path should retain this lightweight HAST boundary (or consume
// equivalent generated icon data) while it still promises one offline file.

import type { Element } from "hast";

export type IconNode = ReadonlyArray<
  readonly [tagName: string, properties: Readonly<Record<string, string>>]
>;

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
