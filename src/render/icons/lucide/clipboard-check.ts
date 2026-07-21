// Owns the Lucide "clipboard-check" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const CLIPBOARD_CHECK_ICON: LucideIcon = {
  name: "clipboard-check",
  node: [
    ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1" }],
    [
      "path",
      {
        d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
      },
    ],
    ["path", { d: "m9 14 2 2 4-4" }],
  ],
};
