// Owns FileTreeDiff's progressively enhanced view preference; the combined
// change tree remains the server-rendered default when JavaScript is
// unavailable.

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

for (const component of document.querySelectorAll<HTMLElement>(
  "[data-file-tree-diff]",
)) {
  component
    .querySelector<HTMLElement>("[data-tree-toggle-group]")
    ?.removeAttribute("hidden");
  applyTreeDiffView({ component, view: storedTreeDiffView });

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
