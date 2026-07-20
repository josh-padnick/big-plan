// Owns the file tree components' progressive enhancements: directory folding
// for FileTree and FileTreeDiff, plus FileTreeDiff's view preference and
// full-screen control. Server-rendered trees stay fully expanded when
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

// Reveals the folding chevrons and header fold-all controls, and lets a
// click anywhere on a directory row (outside its note hint) toggle that
// subtree.
const wireTreeFolding = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  const setCollapsed = ({
    item,
    collapsed,
  }: {
    readonly item: HTMLElement;
    readonly collapsed: boolean;
  }): void => {
    const toggle = item.querySelector<HTMLButtonElement>(
      ":scope > .file-tree-row [data-tree-toggle]",
    );
    if (toggle === null) {
      return;
    }
    if (collapsed) {
      item.dataset.treeCollapsed = "";
    } else {
      delete item.dataset.treeCollapsed;
    }
    const name =
      item.querySelector(":scope > .file-tree-row .file-tree-name")
        ?.textContent ?? "";
    const label = `${collapsed ? "Expand" : "Collapse"} ${name}`;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };
  const toggleItem = (item: HTMLElement): void => {
    setCollapsed({ item, collapsed: item.dataset.treeCollapsed === undefined });
  };
  for (const toggle of component.querySelectorAll<HTMLButtonElement>(
    "[data-tree-toggle]",
  )) {
    toggle.removeAttribute("hidden");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const item = toggle.closest<HTMLElement>(".file-tree-item");
      if (item !== null) {
        toggleItem(item);
      }
    });
  }
  for (const row of component.querySelectorAll<HTMLElement>(
    '.file-tree-row[data-tree-entry="directory"]',
  )) {
    row.classList.add("cursor-pointer");
    row.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".file-tree-note-hint") !== null
      ) {
        return;
      }
      const item = row.closest<HTMLElement>(".file-tree-item");
      if (item !== null) {
        toggleItem(item);
      }
    });
  }
  for (const button of component.querySelectorAll<HTMLButtonElement>(
    "[data-tree-fold]",
  )) {
    button.removeAttribute("hidden");
    button.addEventListener("click", () => {
      const collapsed = button.dataset.treeFold === "collapse";
      for (const item of component.querySelectorAll<HTMLElement>(
        ".file-tree-item",
      )) {
        setCollapsed({ item, collapsed });
      }
    });
  }
};

// Upgrades each note hint's slow native title tooltip to an instant floating
// card shown while hovered or focused. The card uses fixed positioning so the
// tree's scroll container cannot clip it, and mounts inside an open dialog so
// the full-screen top layer cannot bury it.
const wireNoteHints = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  for (const hint of component.querySelectorAll<HTMLButtonElement>(
    ".file-tree-note-hint",
  )) {
    const note = hint.getAttribute("title") ?? "";
    if (note === "") {
      continue;
    }
    hint.removeAttribute("title");
    let tip: HTMLDivElement | null = null;
    let hovered = false;
    let focused = false;
    const update = (): void => {
      if (!hovered && !focused) {
        tip?.remove();
        tip = null;
        return;
      }
      if (tip !== null) {
        return;
      }
      tip = document.createElement("div");
      tip.className = "file-tree-note-tip";
      tip.textContent = note;
      tip.setAttribute("aria-hidden", "true");
      (component.closest("dialog") ?? document.body).append(tip);
      const rect = hint.getBoundingClientRect();
      const width = tip.getBoundingClientRect().width;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8),
      );
      tip.style.left = `${left}px`;
      tip.style.top = `${rect.bottom + 6}px`;
    };
    hint.addEventListener("pointerenter", () => {
      hovered = true;
      update();
    });
    hint.addEventListener("pointerleave", () => {
      hovered = false;
      update();
    });
    hint.addEventListener("focus", () => {
      focused = true;
      update();
    });
    hint.addEventListener("blur", () => {
      focused = false;
      update();
    });
    hint.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hovered = false;
        focused = false;
        update();
      }
    });
  }
};

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
  wireNoteHints({ component });
  wireTreeFolding({ component });
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

for (const component of document.querySelectorAll<HTMLElement>(
  "[data-file-tree]",
)) {
  wireTreeFolding({ component });
}
