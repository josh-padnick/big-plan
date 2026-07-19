// Owns clipboard behavior for rendered code blocks. Markdown fences and the
// future CodeSnippet component opt in through the same data attributes.

const COPY_RESET_MS = 2_000;
const copyStatusTimers = new WeakMap<HTMLButtonElement, number>();
type CopyStatus = "idle" | "success" | "failure";

const setCopyStatus = ({
  button,
  status,
}: {
  readonly button: HTMLButtonElement;
  readonly status: CopyStatus;
}): void => {
  const copyIcon = button.querySelector<SVGElement>('[data-lucide="copy"]');
  const checkIcon = button.querySelector<SVGElement>('[data-lucide="check"]');
  const message = button
    .closest("[data-code-block]")
    ?.querySelector<HTMLElement>("[data-copy-message]");
  const succeeded = status === "success";
  if (copyIcon !== null) {
    copyIcon.toggleAttribute("hidden", succeeded);
  }
  if (checkIcon !== null) {
    checkIcon.toggleAttribute("hidden", !succeeded);
  }
  if (message !== null && message !== undefined) {
    if (status !== "idle") {
      message.textContent = status === "success" ? "Copied!" : "Could not copy";
    }
    message.hidden = status === "idle";
  }
};

// Supports file:// previews where the modern Clipboard API may be unavailable
// or denied, while preferring it when the browser permits it.
const writeClipboard = async ({
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
      // The selection-based fallback below also works in local file viewers.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  const activeDialog = container.closest<HTMLDialogElement>("dialog[open]");
  (activeDialog ?? document.body).append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy was unavailable");
  }
};

// Reports copy state in both visible and accessible text, then restores the
// idle label so repeated copies remain clear.
const showCopyStatus = ({
  button,
  status,
}: {
  readonly button: HTMLButtonElement;
  readonly status: Exclude<CopyStatus, "idle">;
}): void => {
  const previousTimer = copyStatusTimers.get(button);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  setCopyStatus({ button, status });
  button.setAttribute(
    "aria-label",
    status === "success" ? "Code copied" : "Could not copy code",
  );
  const timer = window.setTimeout(() => {
    setCopyStatus({ button, status: "idle" });
    button.setAttribute("aria-label", "Copy code");
    copyStatusTimers.delete(button);
  }, COPY_RESET_MS);
  copyStatusTimers.set(button, timer);
};

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy-code]",
)) {
  button.addEventListener("click", async (event) => {
    const wrapper = button.closest<HTMLElement>("[data-code-block]");
    if (wrapper === null) {
      return;
    }
    const code = wrapper.querySelector("pre code");
    if (code === null) {
      return;
    }
    try {
      await writeClipboard({
        container: wrapper,
        value: code.textContent ?? "",
      });
      showCopyStatus({ button, status: "success" });
    } catch {
      showCopyStatus({ button, status: "failure" });
    }
    if (event.detail === 0) {
      button.focus();
    } else {
      button.blur();
    }
  });
}
