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

export const MAXIMIZE_ICON: IconNode = [
  ["path", { d: "M15 3h6v6" }],
  ["path", { d: "m21 3-7 7" }],
  ["path", { d: "m3 21 7-7" }],
  ["path", { d: "M9 21H3v-6" }],
];

export const MINIMIZE_ICON: IconNode = [
  ["path", { d: "M4 14h6v6" }],
  ["path", { d: "m10 14-7 7" }],
  ["path", { d: "m21 3-7 7" }],
  ["path", { d: "M20 10h-6V4" }],
];
