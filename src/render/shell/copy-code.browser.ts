// Owns code-block clipboard behavior for the static viewer. Markdown fences
// and the future CodeSnippet component opt in through data attributes, keeping
// the browser behavior independent of either renderer.

const COPY_RESET_MS = 2_000;
const copyResetTimers = new WeakMap<HTMLButtonElement, number>();

const setCopiedState = ({
  button,
  copied,
}: {
  readonly button: HTMLButtonElement;
  readonly copied: boolean;
}): void => {
  const copyIcon = button.querySelector<SVGElement>('[data-lucide="copy"]');
  const checkIcon = button.querySelector<SVGElement>('[data-lucide="check"]');
  const message = button
    .closest("[data-code-block]")
    ?.querySelector<HTMLElement>("[data-copy-message]");
  if (copyIcon !== null) {
    copyIcon.toggleAttribute("hidden", copied);
  }
  if (checkIcon !== null) {
    checkIcon.toggleAttribute("hidden", !copied);
  }
  if (message !== null && message !== undefined) {
    message.hidden = !copied;
  }
};

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
  setCopiedState({ button, copied: true });
  button.setAttribute("aria-label", "Code copied");
  const timer = window.setTimeout(() => {
    setCopiedState({ button, copied: false });
    button.setAttribute("aria-label", "Copy code");
    copyResetTimers.delete(button);
  }, COPY_RESET_MS);
  copyResetTimers.set(button, timer);
};

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy-code]",
)) {
  button.addEventListener("click", async (event) => {
    const wrapper = button.closest("[data-code-block]");
    const code = wrapper?.querySelector("pre code");
    if (code === null || code === undefined) {
      return;
    }
    try {
      await writeClipboard(code.textContent ?? "");
      showCopied(button);
    } catch {
      button.setAttribute("aria-label", "Could not copy code");
    }
    if (event.detail === 0) {
      button.focus();
    } else {
      button.blur();
    }
  });
}
