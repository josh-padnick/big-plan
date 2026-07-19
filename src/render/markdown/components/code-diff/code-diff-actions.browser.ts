// Owns CodeDiff's keyboard-accessible overflow menu, clipboard actions, and
// transient copy feedback.

import {
  ownedCodeDiffElement,
  ownedCodeDiffElements,
} from "./code-diff-dom.browser.js";

const DIFF_MESSAGE_RESET_MS = 2_000;
const diffMessageTimers = new WeakMap<HTMLElement, number>();

// Flashes transient copy feedback above the actions button and mirrors the
// result into that button's accessible label.
const showDiffMessage = ({
  component,
  message,
}: {
  readonly component: HTMLElement;
  readonly message: string;
}): void => {
  const slot = ownedCodeDiffElement<HTMLElement>({
    component,
    selector: "[data-diff-copy-message]",
  });
  if (slot === null) {
    return;
  }
  const previousTimer = diffMessageTimers.get(slot);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  const menuButton = ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-menu-button]",
  });
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

// Mirrors fenced-code fallback behavior when the Clipboard API is unavailable
// or denied, including local file previews.
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

/** Reveals and wires one CodeDiff overflow menu and its copy actions. */
export const enhanceCodeDiffActions = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  const menuButton = ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-menu-button]",
  });
  const menuList = ownedCodeDiffElement<HTMLElement>({
    component,
    selector: "[data-diff-menu-list]",
  });
  menuButton?.removeAttribute("hidden");

  const menuItems = (): ReadonlyArray<HTMLButtonElement> =>
    menuList === null
      ? []
      : ownedCodeDiffElements<HTMLButtonElement>({
          component,
          selector: '[role="menuitem"]',
        });

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

  // Escape closes only the menu when it is inside a full-screen dialog.
  ownedCodeDiffElement<HTMLElement>({
    component,
    selector: "[data-diff-menu]",
  })?.addEventListener("keydown", (event) => {
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
    const destination =
      event.key === "Home"
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
      await writeDiffClipboard({ container: component, value });
      showDiffMessage({ component, message: successMessage });
    } catch {
      showDiffMessage({ component, message: "Could not copy" });
    }
  };

  ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-copy-path]",
  })?.addEventListener("click", () => {
    void copyToClipboard({
      value: component.dataset.diffPath ?? "",
      successMessage: "Path copied!",
    });
  });

  ownedCodeDiffElement<HTMLButtonElement>({
    component,
    selector: "[data-diff-copy]",
  })?.addEventListener("click", () => {
    const source = ownedCodeDiffElement<HTMLTextAreaElement>({
      component,
      selector: "[data-diff-source]",
    });
    if (source === null) {
      return;
    }
    void copyToClipboard({
      value: source.value,
      successMessage: "Diff copied!",
    });
  });
};

/** Installs one outside-click dismissal handler for every CodeDiff menu. */
export const installCodeDiffMenuDismissal = (): void => {
  document.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll<HTMLElement>(
      "[data-diff-menu]",
    )) {
      const component = menu.closest<HTMLElement>("[data-code-diff]");
      if (component === null) {
        continue;
      }
      const button = ownedCodeDiffElement<HTMLButtonElement>({
        component,
        selector: "[data-diff-menu-button]",
      });
      const list = ownedCodeDiffElement<HTMLElement>({
        component,
        selector: "[data-diff-menu-list]",
      });
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
};
