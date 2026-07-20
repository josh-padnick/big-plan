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
import { linkAnnotationHover } from "../shared/annotation-hover.browser.js";

const initialView = readStoredCodeDiffView();
for (const component of document.querySelectorAll<HTMLElement>(
  "[data-code-diff]",
)) {
  enhanceCodeDiffView({ component, initialView });
  enhanceCodeDiffActions({ component });
  for (const card of component.querySelectorAll<HTMLElement>(
    "[data-annotation-id]",
  )) {
    const id = card.dataset.annotationId ?? "";
    if (id === "") {
      continue;
    }
    linkAnnotationHover({
      card,
      targets: [
        ...component.querySelectorAll<HTMLElement>(
          `[data-annotation-anchor~="${CSS.escape(id)}"]`,
        ),
      ],
    });
  }
}
installCodeDiffMenuDismissal();
