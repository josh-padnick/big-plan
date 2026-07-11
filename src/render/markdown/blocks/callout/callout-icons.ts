// Owns the small Lucide icon-node assets used by the four Callout variants
// without loading the library's complete runtime icon catalog.

import type { IconNode } from "../../../icons/lucide-icon.js";

export const INFO_ICON: IconNode = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "M12 16v-4" }],
  ["path", { d: "M12 8h.01" }],
];

export const LIGHTBULB_ICON: IconNode = [
  ["path", { d: "M9 18h6" }],
  ["path", { d: "M10 22h4" }],
  [
    "path",
    {
      d: "M15.09 14c.18-.32.42-.65.66-.91A6 6 0 1 0 8.25 13.09c.25.25.48.58.66.91",
    },
  ],
];

export const TRIANGLE_ALERT_ICON: IconNode = [
  [
    "path",
    {
      d: "M21.73 18 13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    },
  ],
  ["path", { d: "M12 9v4" }],
  ["path", { d: "M12 17h.01" }],
];

export const OCTAGON_ALERT_ICON: IconNode = [
  [
    "path",
    {
      d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688A2 2 0 0 1 15.312 22H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",
    },
  ],
  ["path", { d: "M12 8v4" }],
  ["path", { d: "M12 16h.01" }],
];
