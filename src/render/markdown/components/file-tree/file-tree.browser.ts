// Owns FileTreeDiff's progressively enhanced view preference and full-screen
// control; the combined change tree remains the server-rendered default when
// JavaScript is unavailable.

import {
  openComponentFullScreen,
  updateFullScreenControl,
} from "../shared/full-screen.browser.js";

const TREE_DIFF_VIEW_STORAGE_KEY = "big-plan:file-tree-diff-view";

type FileTreeDiffView = "combined" | "before-after";

const isFileTreeDiffView = (value: string | null): value is FileTreeDiffView =>
  value === "combined" || value === "before-after";

// Applies one view and mirrors it into the segmented control's pressed state.
const applyTreeDiffView = ({
  component,
  view,
}: {
  readonly component: HTMLElement;
  readonly view: FileTreeDiffView;
}): void => {
  component.dataset.treeView = view;
  for (const button of component.querySelectorAll<HTMLButtonElement>(
    "[data-tree-set-view]",
  )) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.treeSetView === view ? "true" : "false",
    );
  }
};

const readStoredTreeDiffView = (): FileTreeDiffView => {
  try {
    const stored = window.localStorage.getItem(TREE_DIFF_VIEW_STORAGE_KEY);
    if (isFileTreeDiffView(stored)) {
      return stored;
    }
  } catch {
    // Every in-page interaction still works when persistence is unavailable.
  }
  return "combined";
};

const storedTreeDiffView = readStoredTreeDiffView();

// Mirrors the expanded state into the tree's dataset and expand control.
const applyTreeExpandedState = ({
  component,
  expanded,
}: {
  readonly component: HTMLElement;
  readonly expanded: boolean;
}): void => {
  if (expanded) {
    component.dataset.treeExpanded = "";
  } else {
    delete component.dataset.treeExpanded;
  }
  const button =
    component.querySelector<HTMLButtonElement>("[data-tree-expand]");
  if (button !== null) {
    updateFullScreenControl({
      button,
      expanded,
      expandLabel: "View file tree full screen",
    });
  }
};

for (const component of document.querySelectorAll<HTMLElement>(
  "[data-file-tree-diff]",
)) {
  component
    .querySelector<HTMLElement>("[data-tree-toggle-group]")
    ?.removeAttribute("hidden");
  const expand =
    component.querySelector<HTMLButtonElement>("[data-tree-expand]");
  expand?.removeAttribute("hidden");
  applyTreeDiffView({ component, view: storedTreeDiffView });

  expand?.addEventListener("click", () => {
    const openDialog = component.closest("dialog");
    if (openDialog !== null) {
      openDialog.close();
      return;
    }
    // The optional title captions the dialog; a bare tree gets a plain label.
    openComponentFullScreen({
      component,
      labelElement: component.querySelector<HTMLElement>(
        ".file-tree-diff-title",
      ),
      fallbackLabel: "File tree diff",
      onToggle: ({ expanded }) =>
        applyTreeExpandedState({ component, expanded }),
    });
  });

  for (const button of component.querySelectorAll<HTMLButtonElement>(
    "[data-tree-set-view]",
  )) {
    button.addEventListener("click", () => {
      const view = button.dataset.treeSetView ?? null;
      if (!isFileTreeDiffView(view)) {
        return;
      }
      applyTreeDiffView({ component, view });
      try {
        window.localStorage.setItem(TREE_DIFF_VIEW_STORAGE_KEY, view);
      } catch {
        // Keep the component-local selection when persistence is unavailable.
      }
    });
  }
}
