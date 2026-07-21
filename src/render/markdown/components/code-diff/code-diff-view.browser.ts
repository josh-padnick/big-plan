// Owns CodeDiff's persisted unified/split selection and full-screen dialog.

import { enhanceVisibleAnnotations } from "./code-diff-annotations.browser.js";
import {
  ownedCodeDiffElement,
  ownedCodeDiffElements,
} from "./code-diff-dom.browser.js";
import {
  fullScreenSupported,
  openComponentFullScreen,
  updateFullScreenControl,
} from "../shared/full-screen.browser.js";

const DIFF_VIEW_STORAGE_KEY = "big-plan-diff-view";

export type CodeDiffView = "unified" | "split";

const isCodeDiffView = (value: string | null): value is CodeDiffView =>
  value === "unified" || value === "split";

// Applies a view and mirrors it into the segmented control's pressed states.
const applyDiffView = ({
  component,
  view,
}: {
  readonly component: HTMLElement;
  readonly view: CodeDiffView;
}): void => {
  component.dataset.diffView = view;
  for (const button of ownedCodeDiffElements<HTMLButtonElement>({
    component,
    selector: "[data-diff-set-view]",
  })) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.diffSetView === view ? "true" : "false",
    );
  }
  enhanceVisibleAnnotations({ component });
};

// Mirrors the expanded state into the diff's dataset and expand control.
const applyExpandedState = ({
  component,
  expanded,
}: {
  readonly component: HTMLElement;
  readonly expanded: boolean;
}): void => {
  if (expanded) {
    component.dataset.diffExpanded = "";
  } else {
    delete component.dataset.diffExpanded;
  }
  const button = ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-expand]",
  });
  if (button !== null) {
    updateFullScreenControl({
      button,
      expanded,
      expandLabel: "View diff full screen",
    });
  }
};

// The shared dialog moves the component rather than cloning it, preserving
// listeners and the selected view; the file caption names the dialog.
const openFullScreen = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  const fileCaption = ownedCodeDiffElement<HTMLElement>({
    component,
    selector: ".file-identity",
  });
  if (fileCaption === null) {
    return;
  }
  openComponentFullScreen({
    component,
    labelElement: fileCaption,
    fallbackLabel: "Code diff",
    onToggle: ({ expanded }) => applyExpandedState({ component, expanded }),
  });
};

/** Reads the shared view preference while tolerating unavailable storage. */
export const readStoredCodeDiffView = (): CodeDiffView => {
  try {
    const stored = window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY);
    if (isCodeDiffView(stored)) {
      return stored;
    }
  } catch {
    // Every in-page interaction still works when persistence is unavailable.
  }
  return "unified";
};

/** Reveals and wires one CodeDiff's view and full-screen controls. */
export const enhanceCodeDiffView = ({
  component,
  initialView,
}: {
  readonly component: HTMLElement;
  readonly initialView: CodeDiffView;
}): void => {
  const toggleGroup = ownedCodeDiffElement<HTMLElement>({
    component,
    selector: "[data-diff-toggle-group]",
  });
  const expand = ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-expand]",
  });
  toggleGroup?.removeAttribute("hidden");
  if (fullScreenSupported({ component })) {
    expand?.removeAttribute("hidden");
  }
  applyDiffView({ component, view: initialView });

  expand?.addEventListener("click", () => {
    const openDialog = component.closest("dialog");
    if (openDialog !== null) {
      openDialog.close();
      return;
    }
    openFullScreen({ component });
  });

  for (const button of ownedCodeDiffElements<HTMLButtonElement>({
    component,
    selector: "[data-diff-set-view]",
  })) {
    button.addEventListener("click", () => {
      const view = button.dataset.diffSetView ?? null;
      if (!isCodeDiffView(view)) {
        return;
      }
      applyDiffView({ component, view });
      try {
        window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, view);
      } catch {
        // Keep the component-local selection when persistence is unavailable.
      }
    });
  }
};
