// Composes CodeDiff's independent browser enhancements over the complete
// server-rendered unified fallback.

import {
  enhanceCodeDiffActions,
  installCodeDiffMenuDismissal,
} from "./code-diff-actions.browser.js";
import {
  enhanceCodeDiffView,
  readStoredCodeDiffView,
} from "./code-diff-view.browser.js";

const initialView = readStoredCodeDiffView();
for (const block of document.querySelectorAll<HTMLElement>(
  "[data-code-diff]",
)) {
  enhanceCodeDiffView({ block, initialView });
  enhanceCodeDiffActions({ block });
}
installCodeDiffMenuDismissal();
