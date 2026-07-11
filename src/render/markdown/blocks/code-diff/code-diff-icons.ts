// Owns the small Lucide icon-node assets used by CodeDiff's view toggle.

import type { IconNode } from "../../../icons/lucide-icon.js";

export const COLUMNS_ICON: IconNode = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M12 3v18" }],
];

export const ROWS_ICON: IconNode = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M3 12h18" }],
];
