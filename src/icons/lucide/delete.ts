// Owns the Lucide "delete" icon's catalog identity and path data. The glyph is
// the backspace key, which is the key the action it labels is bound to.

import type { LucideIcon } from "../lucide-icon.js";

export const DELETE_ICON: LucideIcon = {
  name: "delete",
  node: [
    [
      "path",
      {
        d: "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
      },
    ],
    ["path", { d: "m12 9 6 6" }],
    ["path", { d: "m18 9-6 6" }],
  ],
};
