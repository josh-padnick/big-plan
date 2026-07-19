// Owns the Lucide "info" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const INFO_ICON: LucideIcon = {
  name: "info",
  node: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M12 16v-4" }],
    ["path", { d: "M12 8h.01" }],
  ],
};
