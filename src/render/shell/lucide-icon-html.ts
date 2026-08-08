// Adapts framework-neutral Lucide icon data to the HTML strings the shell
// builds. The HAST edge (markdown/lucide-icon-hast) and the React edge
// (components/_shared/lucide-icon) have their own adapters; none owns glyph
// data, which lives only in the icons catalog.

import {
  DEFAULT_LUCIDE_STROKE_WIDTH,
  type LucideIcon,
} from "../../icons/lucide-icon.js";

/**
 * Renders one decorative Lucide glyph as an inert SVG string.
 *
 * Values come from the local catalog rather than plan source, so there is no
 * authored content to escape here; keep it that way by never passing
 * user-supplied attributes through this function.
 */
export const lucideIconToHtml = ({
  icon,
  className,
}: {
  readonly icon: LucideIcon;
  readonly className: string;
}): string => {
  const children = icon.node
    .map(
      ([tagName, properties]) =>
        `<${tagName} ${Object.entries(properties)
          .map(([name, value]) => `${name}="${value}"`)
          .join(" ")} />`,
    )
    .join("");
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${icon.strokeWidth ?? DEFAULT_LUCIDE_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-lucide="${icon.name}">${children}</svg>`;
};
