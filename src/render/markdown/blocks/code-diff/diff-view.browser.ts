// Owns CodeDiff's progressively enhanced view preference, raw-source copy,
// and full-screen dialog behavior; server-rendered unified content remains
// the no-JavaScript default.

const DIFF_VIEW_STORAGE_KEY = "grandplan-diff-view";
const DIFF_COPY_RESET_MS = 2_000;
let nextDiffDialogLabelId = 1;

type CodeDiffView = "unified" | "split";
type DiffCopyStatus = "idle" | "success" | "failure";

const diffCopyTimers = new WeakMap<HTMLButtonElement, number>();

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

const setDiffCopyStatus = ({
  button,
  status,
}: {
  readonly button: HTMLButtonElement;
  readonly status: DiffCopyStatus;
}): void => {
  const copyIcon = button.querySelector<SVGElement>('[data-lucide="copy"]');
  const checkIcon = button.querySelector<SVGElement>('[data-lucide="check"]');
  const message = button
    .closest("[data-code-diff]")
    ?.querySelector<HTMLElement>("[data-diff-copy-message]");
  const succeeded = status === "success";
  copyIcon?.toggleAttribute("hidden", succeeded);
  checkIcon?.toggleAttribute("hidden", !succeeded);
  if (message !== null && message !== undefined) {
    if (status !== "idle") {
      message.textContent = status === "success" ? "Copied!" : "Could not copy";
    }
    message.hidden = status === "idle";
  }
};

// Mirrors fenced-code fallback behavior for local file previews where the
// Clipboard API is unavailable or denied.
const writeDiffClipboard = async (value: string): Promise<void> => {
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
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy was unavailable");
  }
};

const showDiffCopyStatus = ({
  button,
  status,
}: {
  readonly button: HTMLButtonElement;
  readonly status: Exclude<DiffCopyStatus, "idle">;
}): void => {
  const previousTimer = diffCopyTimers.get(button);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  setDiffCopyStatus({ button, status });
  button.setAttribute(
    "aria-label",
    status === "success" ? "Diff copied" : "Could not copy diff",
  );
  const timer = window.setTimeout(() => {
    setDiffCopyStatus({ button, status: "idle" });
    button.setAttribute("aria-label", "Copy diff");
    diffCopyTimers.delete(button);
  }, DIFF_COPY_RESET_MS);
  diffCopyTimers.set(button, timer);
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
// and the selected view survive; closing restores its original position.
const openFullScreen = ({ block }: { readonly block: HTMLElement }): void => {
  const article = block.closest("article");
  const fileCaption = block.querySelector<HTMLElement>(".code-diff-file");
  if (article === null || fileCaption === null) {
    return;
  }
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
  const copy = block.querySelector<HTMLButtonElement>("[data-diff-copy]");
  const expand = block.querySelector<HTMLButtonElement>("[data-diff-expand]");
  toggleGroup?.removeAttribute("hidden");
  copy?.removeAttribute("hidden");
  expand?.removeAttribute("hidden");
  applyDiffView({ block, view: storedDiffView });

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

  copy?.addEventListener("click", async (event) => {
    const source = block.querySelector<HTMLTextAreaElement>("[data-diff-source]");
    if (source === null) {
      return;
    }
    try {
      await writeDiffClipboard(source.value);
      showDiffCopyStatus({ button: copy, status: "success" });
    } catch {
      showDiffCopyStatus({ button: copy, status: "failure" });
    }
    if (event.detail === 0) {
      copy.focus();
    } else {
      copy.blur();
    }
  });
}
