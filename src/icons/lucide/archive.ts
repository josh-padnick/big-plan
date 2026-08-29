// Owns the Lucide "archive" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const ARCHIVE_ICON: LucideIcon = {
  name: "archive",
  node: [
    ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1" }],
    ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
    ["path", { d: "M10 12h4" }],
  ],
};
