// Owns the Lucide "git-branch" icon's catalog identity and path data.

import type { LucideIcon } from "../lucide-icon.js";

export const GIT_BRANCH_ICON: LucideIcon = {
  name: "git-branch",
  node: [
    ["path", { d: "M15 6a9 9 0 0 0-9 9V3" }],
    ["circle", { cx: "18", cy: "6", r: "3" }],
    ["circle", { cx: "6", cy: "18", r: "3" }],
  ],
};
