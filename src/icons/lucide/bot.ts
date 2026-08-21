// Owns the Lucide "bot" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const BOT_ICON: LucideIcon = {
  name: "bot",
  node: [
    ["path", { d: "M12 8V4H8" }],
    ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2" }],
    ["path", { d: "M2 14h2" }],
    ["path", { d: "M20 14h2" }],
    ["path", { d: "M15 13v2" }],
    ["path", { d: "M9 13v2" }],
  ],
};
