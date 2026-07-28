// Renders Lucide icons inside React components by reusing the icons layer's
// HAST construction instead of maintaining a parallel icon pipeline.

import type { ReactNode } from "react";
import type { LucideIcon } from "../render/icons/lucide-icon.js";
import { renderLucideIcon } from "../render/icons/lucide-icon.js";
import { hastContentToReact } from "./hast-content.js";

/** Renders one decorative Lucide SVG as a React node. */
export const lucideIconToReact = ({
  icon,
  hidden,
}: {
  readonly icon: LucideIcon;
  readonly hidden: boolean;
}): ReactNode => hastContentToReact([renderLucideIcon({ icon, hidden })]);
