// Owns CodeDiff's persisted unified/split selection and full-screen dialog.

import { enhanceVisibleAnnotations } from "./code-diff-annotations.browser.js";
import {
  ownedCodeDiffElement,
  ownedCodeDiffElements,
} from "./code-diff-dom.browser.js";

const DIFF_VIEW_STORAGE_KEY = "big-plan-diff-view";
let nextDiffDialogLabelId = 1;

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

// Mirrors the expanded state into the expand control's icon and label.
const updateExpandControl = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  const button = ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-expand]",
  });
  if (button === null) {
    return;
  }
  const expanded = component.dataset.diffExpanded !== undefined;
  const label = expanded ? "Exit full screen" : "View diff full screen";
  button.setAttribute("aria-label", label);
  button.title = label;
  button
    .querySelector<SVGElement>('[data-lucide="maximize-2"]')
    ?.toggleAttribute("hidden", expanded);
  button
    .querySelector<SVGElement>('[data-lucide="minimize-2"]')
    ?.toggleAttribute("hidden", !expanded);
};

// Moves the component into a modal rather than cloning it, preserving listeners
// and the selected view, then restores its DOM and page-scroll positions.
const openFullScreen = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  const article = component.closest("article");
  const fileCaption = ownedCodeDiffElement<HTMLElement>({
    component,
    selector: ".code-diff-file",
  });
  if (article === null || fileCaption === null) {
    return;
  }
  const scrollY = window.scrollY;
  let labelId = fileCaption.id;
  if (labelId === "" || document.getElementById(labelId) !== fileCaption) {
    do {
      labelId = `code-diff-dialog-label-${nextDiffDialogLabelId}`;
      nextDiffDialogLabelId += 1;
    } while (document.getElementById(labelId) !== null);
    fileCaption.id = labelId;
  }
  const placeholder = document.createElement("span");
  placeholder.hidden = true;
  component.before(placeholder);
  const dialog = document.createElement("dialog");
  dialog.className = "code-diff-dialog";
  dialog.setAttribute("aria-labelledby", labelId);
  dialog.append(component);
  article.append(dialog);
  component.dataset.diffExpanded = "";
  updateExpandControl({ component });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    placeholder.before(component);
    placeholder.remove();
    dialog.remove();
    delete component.dataset.diffExpanded;
    updateExpandControl({ component });
    window.scrollTo({ top: scrollY });
  });
  dialog.showModal();
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
  expand?.removeAttribute("hidden");
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
