// Adapts framework-neutral Lucide icon data to an SVG markup string, the one
// rendering edge a script template can use. The React edge lives in
// components/_shared/lucide-icon and the HAST edge in
// markdown/lucide-icon-hast; none of the three owns glyph data.
//
// The viewer script builds affordances the reader only ever sees with scripts
// running - a comment chip, an actions popover, a tray - so their glyphs
// cannot ship as server-rendered markup the way a dormant control's do.

import type { LucideIcon } from "../../icons/lucide-icon.js";

const ATTRIBUTES = [
  'xmlns="http://www.w3.org/2000/svg"',
  'viewBox="0 0 24 24"',
  'fill="none"',
  'stroke="currentColor"',
  'stroke-width="2"',
  'stroke-linecap="round"',
  'stroke-linejoin="round"',
  'aria-hidden="true"',
].join(" ");

/**
 * Renders one decorative Lucide glyph as inert SVG markup.
 *
 * Glyph data is authored, never user content, so the path attributes are
 * emitted verbatim; nothing here interpolates anything a plan could write.
 */
export const lucideIconToMarkup = (icon: LucideIcon): string => {
  const children = icon.node
    .map(([tagName, properties]) => {
      const attributes = Object.entries(properties)
        .map(([name, value]) => `${name}="${value}"`)
        .join(" ");
      return `<${tagName} ${attributes}/>`;
    })
    .join("");
  return `<svg ${ATTRIBUTES} data-lucide="${icon.name}">${children}</svg>`;
};
