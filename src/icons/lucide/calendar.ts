// Owns the Lucide "calendar" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const CALENDAR_ICON: LucideIcon = {
  name: "calendar",
  node: [
    ["path", { d: "M8 2v3" }],
    ["path", { d: "M16 2v3" }],
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M3 9h18" }],
  ],
};
