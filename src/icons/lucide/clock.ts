// Owns the Lucide "clock" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const CLOCK_ICON: LucideIcon = {
  name: "clock",
  node: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M12 6v6l4 2" }],
  ],
};
