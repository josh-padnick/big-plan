// Owns the Lucide "circle-x" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const CIRCLE_X_ICON: LucideIcon = {
  name: "circle-x",
  node: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m15 9-6 6" }],
    ["path", { d: "m9 9 6 6" }],
  ],
};
