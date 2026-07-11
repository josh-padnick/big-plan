// Owns code-block clipboard behavior for the static viewer. Markdown fences
// and the future CodeSnippet component opt in through data attributes, keeping
// the browser behavior independent of either renderer.

const COPY_RESET_MS = 2_000;
const copyResetTimers = new WeakMap<HTMLButtonElement, number>();

// Supports file:// previews where the modern Clipboard API may be unavailable
// or denied, while preferring it when the browser permits it.
const writeClipboard = async (value: string): Promise<void> => {
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
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy was unavailable");
  }
};

// Reports copy state in both visible and accessible text, then restores the
// idle label so repeated copies remain clear.
const showCopied = (button: HTMLButtonElement): void => {
  const previousTimer = copyResetTimers.get(button);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  button.textContent = "Copied!";
  button.setAttribute("aria-label", "Code copied");
  const timer = window.setTimeout(() => {
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code");
    copyResetTimers.delete(button);
  }, COPY_RESET_MS);
  copyResetTimers.set(button, timer);
};

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy-code]",
)) {
  button.addEventListener("click", async () => {
    const wrapper = button.closest("[data-code-block]");
    const code = wrapper?.querySelector("pre code");
    if (code === null || code === undefined) {
      return;
    }
    try {
      await writeClipboard(code.textContent ?? "");
      showCopied(button);
    } catch {
      button.textContent = "Copy failed";
      button.setAttribute("aria-label", "Could not copy code");
    }
    button.focus();
  });
}
