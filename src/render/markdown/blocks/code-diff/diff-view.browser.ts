// Owns CodeDiff's progressively enhanced view preference and raw-source copy
// behavior; server-rendered unified content remains the no-JavaScript default.

const DIFF_VIEW_STORAGE_KEY = "grandplan-diff-view";
const DIFF_COPY_RESET_MS = 2_000;

type CodeDiffView = "unified" | "split";
type DiffCopyStatus = "idle" | "success" | "failure";

const diffCopyTimers = new WeakMap<HTMLButtonElement, number>();

const isCodeDiffView = (value: string | null): value is CodeDiffView =>
  value === "unified" || value === "split";

const updateDiffToggle = ({
  block,
}: {
  readonly block: HTMLElement;
}): void => {
  const button = block.querySelector<HTMLButtonElement>("[data-diff-toggle]");
  if (button === null) {
    return;
  }
  const nextView = block.dataset.diffView === "split" ? "unified" : "split";
  const label = nextView === "split"
    ? "Use side-by-side diff view"
    : "Use unified diff view";
  button.setAttribute("aria-label", label);
  button.title = label;
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
  block.dataset.diffView = storedDiffView;
  const toggle = block.querySelector<HTMLButtonElement>("[data-diff-toggle]");
  const copy = block.querySelector<HTMLButtonElement>("[data-diff-copy]");
  toggle?.removeAttribute("hidden");
  copy?.removeAttribute("hidden");
  updateDiffToggle({ block });

  toggle?.addEventListener("click", () => {
    const nextView: CodeDiffView = block.dataset.diffView === "split"
      ? "unified"
      : "split";
    block.dataset.diffView = nextView;
    try {
      window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, nextView);
    } catch {
      // Keep the block-local selection when persistence is unavailable.
    }
    updateDiffToggle({ block });
  });

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
