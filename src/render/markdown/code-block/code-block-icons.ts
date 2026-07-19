// Owns the small Lucide icon-node assets used by rendered code-block controls
// without loading the library's complete runtime icon catalog.

import type { IconNode } from "../../icons/lucide-icon.js";

export const COPY_ICON: IconNode = [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
];

export const CHECK_ICON: IconNode = [["path", { d: "M20 6 9 17l-5-5" }]];
