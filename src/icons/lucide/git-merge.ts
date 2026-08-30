// Owns the Lucide "git-merge" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const GIT_MERGE_ICON: LucideIcon = {
  name: "git-merge",
  node: [
    ["circle", { cx: "18", cy: "18", r: "3" }],
    ["circle", { cx: "6", cy: "6", r: "3" }],
    ["path", { d: "M6 21V9a9 9 0 0 0 9 9" }],
  ],
};
