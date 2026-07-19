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
  block,
  view,
}: {
  readonly block: HTMLElement;
  readonly view: CodeDiffView;
}): void => {
  block.dataset.diffView = view;
  for (const button of ownedCodeDiffElements<HTMLButtonElement>({
    block,
    selector: "[data-diff-set-view]",
  })) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.diffSetView === view ? "true" : "false",
    );
  }
  enhanceVisibleAnnotations({ block });
};

// Mirrors the expanded state into the expand control's icon and label.
const updateExpandControl = ({
  block,
}: {
  readonly block: HTMLElement;
}): void => {
  const button = ownedCodeDiffElement<HTMLButtonElement>({
    block,
    selector: "[data-diff-expand]",
  });
  if (button === null) {
    return;
  }
  const expanded = block.dataset.diffExpanded !== undefined;
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

// Moves the block into a modal rather than cloning it, preserving listeners
// and the selected view, then restores its DOM and page-scroll positions.
const openFullScreen = ({ block }: { readonly block: HTMLElement }): void => {
  const article = block.closest("article");
  const fileCaption = ownedCodeDiffElement<HTMLElement>({
    block,
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
  block.before(placeholder);
  const dialog = document.createElement("dialog");
  dialog.className = "code-diff-dialog";
  dialog.setAttribute("aria-labelledby", labelId);
  dialog.append(block);
  article.append(dialog);
  block.dataset.diffExpanded = "";
  updateExpandControl({ block });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    placeholder.before(block);
    placeholder.remove();
    dialog.remove();
    delete block.dataset.diffExpanded;
    updateExpandControl({ block });
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
  block,
  initialView,
}: {
  readonly block: HTMLElement;
  readonly initialView: CodeDiffView;
}): void => {
  const toggleGroup = ownedCodeDiffElement<HTMLElement>({
    block,
    selector: "[data-diff-toggle-group]",
  });
  const expand = ownedCodeDiffElement<HTMLButtonElement>({
    block,
    selector: "[data-diff-expand]",
  });
  toggleGroup?.removeAttribute("hidden");
  expand?.removeAttribute("hidden");
  applyDiffView({ block, view: initialView });

  expand?.addEventListener("click", () => {
    const openDialog = block.closest("dialog");
    if (openDialog !== null) {
      openDialog.close();
      return;
    }
    openFullScreen({ block });
  });

  for (const button of ownedCodeDiffElements<HTMLButtonElement>({
    block,
    selector: "[data-diff-set-view]",
  })) {
    button.addEventListener("click", () => {
      const view = button.dataset.diffSetView ?? null;
      if (!isCodeDiffView(view)) {
        return;
      }
      applyDiffView({ block, view });
      try {
        window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, view);
      } catch {
        // Keep the block-local selection when persistence is unavailable.
      }
    });
  }
};
