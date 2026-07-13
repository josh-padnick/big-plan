// Owns CodeDiff's progressively enhanced view preference, overflow actions
// menu, and full-screen dialog behavior; server-rendered unified content
// remains the no-JavaScript default.

const DIFF_VIEW_STORAGE_KEY = "big-plan-diff-view";
const DIFF_MESSAGE_RESET_MS = 2_000;
let nextDiffDialogLabelId = 1;

type CodeDiffView = "unified" | "split";

const diffMessageTimers = new WeakMap<HTMLElement, number>();

const isCodeDiffView = (value: string | null): value is CodeDiffView =>
  value === "unified" || value === "split";

// Applies one view to a block and mirrors it into the segmented control's
// pressed states so the active view is always visible in the header.
const applyDiffView = ({
  block,
  view,
}: {
  readonly block: HTMLElement;
  readonly view: CodeDiffView;
}): void => {
  block.dataset.diffView = view;
  for (const button of block.querySelectorAll<HTMLButtonElement>(
    "[data-diff-set-view]",
  )) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.diffSetView === view ? "true" : "false",
    );
  }
};

// Flashes transient action feedback in the header's message slot.
const showDiffMessage = ({
  block,
  message,
}: {
  readonly block: HTMLElement;
  readonly message: string;
}): void => {
  const slot = block.querySelector<HTMLElement>("[data-diff-copy-message]");
  if (slot === null) {
    return;
  }
  const previousTimer = diffMessageTimers.get(slot);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-diff-menu-button]",
  );
  slot.textContent = message;
  slot.hidden = false;
  menuButton?.setAttribute("aria-label", message);
  const timer = window.setTimeout(() => {
    slot.hidden = true;
    menuButton?.setAttribute("aria-label", "More actions");
    diffMessageTimers.delete(slot);
  }, DIFF_MESSAGE_RESET_MS);
  diffMessageTimers.set(slot, timer);
};

// Mirrors fenced-code fallback behavior for local file previews where the
// Clipboard API is unavailable or denied.
const writeDiffClipboard = async ({
  container,
  value,
}: {
  readonly container: HTMLElement;
  readonly value: string;
}): Promise<void> => {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // The selection fallback remains available for file:// documents.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  const previousFocus = document.activeElement;
  const activeDialog = document.querySelector<HTMLDialogElement>(
    "dialog.code-diff-dialog[open]",
  );
  (activeDialog ?? container).append(textarea);
  let copied: boolean;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus();
    }
  }
  if (!copied) {
    throw new Error("Clipboard copy was unavailable");
  }
};

// Mirrors the expanded state into the expand control's icon and label.
const updateExpandControl = ({
  block,
}: {
  readonly block: HTMLElement;
}): void => {
  const button = block.querySelector<HTMLButtonElement>("[data-diff-expand]");
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

// Moves the block into a modal dialog rather than cloning it, so listeners
// and the selected view survive; closing restores its DOM and page-scroll positions.
const openFullScreen = ({ block }: { readonly block: HTMLElement }): void => {
  const article = block.closest("article");
  const fileCaption = block.querySelector<HTMLElement>(".code-diff-file");
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

let storedDiffView: CodeDiffView = "unified";
try {
  const stored = window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY);
  if (isCodeDiffView(stored)) {
    storedDiffView = stored;
  }
} catch {
  // Every in-page interaction still works when persistence is unavailable.
}

for (const block of document.querySelectorAll<HTMLElement>("[data-code-diff]")) {
  const toggleGroup = block.querySelector<HTMLElement>("[data-diff-toggle-group]");
  const expand = block.querySelector<HTMLButtonElement>("[data-diff-expand]");
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-diff-menu-button]",
  );
  const menuList = block.querySelector<HTMLElement>("[data-diff-menu-list]");
  toggleGroup?.removeAttribute("hidden");
  expand?.removeAttribute("hidden");
  menuButton?.removeAttribute("hidden");
  applyDiffView({ block, view: storedDiffView });

  const menuItems = (): ReadonlyArray<HTMLButtonElement> =>
    menuList === null
      ? []
      : [...menuList.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

  const setMenuOpen = ({
    open,
    focus,
  }: {
    readonly open: boolean;
    readonly focus?: "first" | "last";
  }): void => {
    if (menuButton === null || menuList === null) {
      return;
    }
    menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    menuList.hidden = !open;
    const items = menuItems();
    for (const item of items) {
      item.tabIndex = -1;
    }
    if (open && focus !== undefined) {
      const item = items[focus === "first" ? 0 : items.length - 1];
      if (item !== undefined) {
        item.tabIndex = 0;
        item.focus();
      }
    }
  };

  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    setMenuOpen({ open, ...(open ? { focus: "first" } : {}) });
  });

  // Escape closes the menu without also dismissing an enclosing full-screen
  // dialog; preventDefault stops the dialog's native cancel behavior.
  block
    .querySelector<HTMLElement>("[data-diff-menu]")
    ?.addEventListener("keydown", (event) => {
      if (menuList === null) {
        return;
      }
      if (event.key === "Escape" && !menuList.hidden) {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen({ open: false });
        menuButton?.focus();
        return;
      }
      if (event.target === menuButton && event.key === "ArrowDown") {
        event.preventDefault();
        setMenuOpen({ open: true, focus: "first" });
        return;
      }
      if (event.target === menuButton && event.key === "ArrowUp") {
        event.preventDefault();
        setMenuOpen({ open: true, focus: "last" });
        return;
      }
      if (menuList.hidden) {
        return;
      }
      if (event.key === "Tab") {
        setMenuOpen({ open: false });
        return;
      }
      const items = menuItems();
      const currentIndex = items.findIndex((item) => item === event.target);
      if (currentIndex === -1) {
        return;
      }
      const destination = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1) % items.length
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + items.length) % items.length
              : undefined;
      if (destination !== undefined) {
        event.preventDefault();
        const item = items[destination];
        if (item !== undefined) {
          for (const menuItem of items) {
            menuItem.tabIndex = menuItem === item ? 0 : -1;
          }
          item.focus();
        }
      }
    });

  const copyToClipboard = async ({
    value,
    successMessage,
  }: {
    readonly value: string;
    readonly successMessage: string;
  }): Promise<void> => {
    setMenuOpen({ open: false });
    menuButton?.focus();
    try {
      await writeDiffClipboard({ container: block, value });
      showDiffMessage({ block, message: successMessage });
    } catch {
      showDiffMessage({ block, message: "Could not copy" });
    }
  };

  block
    .querySelector<HTMLButtonElement>("[data-diff-copy-path]")
    ?.addEventListener("click", () => {
      void copyToClipboard({
        value: block.dataset.diffPath ?? "",
        successMessage: "Path copied!",
      });
    });

  block
    .querySelector<HTMLButtonElement>("[data-diff-copy]")
    ?.addEventListener("click", () => {
      const source = block.querySelector<HTMLTextAreaElement>(
        "[data-diff-source]",
      );
      if (source === null) {
        return;
      }
      void copyToClipboard({
        value: source.value,
        successMessage: "Diff copied!",
      });
    });

  expand?.addEventListener("click", () => {
    const openDialog = block.closest("dialog");
    if (openDialog !== null) {
      openDialog.close();
      return;
    }
    openFullScreen({ block });
  });

  for (const button of block.querySelectorAll<HTMLButtonElement>(
    "[data-diff-set-view]",
  )) {
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
}

// One document-level dismissal for every diff menu: clicking anywhere
// outside an open menu closes it.
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll<HTMLElement>("[data-diff-menu]")) {
    const button = menu.querySelector<HTMLButtonElement>(
      "[data-diff-menu-button]",
    );
    const list = menu.querySelector<HTMLElement>("[data-diff-menu-list]");
    if (button === null || list === null || list.hidden) {
      continue;
    }
    if (event.target instanceof Node && menu.contains(event.target)) {
      continue;
    }
    button.setAttribute("aria-expanded", "false");
    list.hidden = true;
  }
});
