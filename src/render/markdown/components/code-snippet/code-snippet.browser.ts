// Owns CodeSnippet's progressively enhanced actions menu and raw-source/path
// clipboard behavior; the snippet and annotations remain readable without it.

import { linkAnnotationHover } from "../shared/annotation-hover/annotation-hover.browser.js";

const SNIPPET_MESSAGE_RESET_MS = 2_000;
const snippetMessageTimers = new WeakMap<HTMLElement, number>();

// Flashes transient clipboard feedback through the same header convention as
// CodeDiff while retaining the stable actions-menu label between operations.
const showSnippetMessage = ({
  block,
  message,
}: {
  readonly block: HTMLElement;
  readonly message: string;
}): void => {
  const slot = block.querySelector<HTMLElement>("[data-snippet-copy-message]");
  if (slot === null) {
    return;
  }
  const previousTimer = snippetMessageTimers.get(slot);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-snippet-menu-button]",
  );
  slot.textContent = message;
  slot.hidden = false;
  menuButton?.setAttribute("aria-label", message);
  const timer = window.setTimeout(() => {
    slot.hidden = true;
    menuButton?.setAttribute("aria-label", "More actions");
    snippetMessageTimers.delete(slot);
  }, SNIPPET_MESSAGE_RESET_MS);
  snippetMessageTimers.set(slot, timer);
};

// Keeps copy available for local file previews where Clipboard API access is
// unavailable or denied, without selecting visible rows or annotations.
const writeSnippetClipboard = async ({
  snippetBlock,
  value,
}: {
  readonly snippetBlock: HTMLElement;
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
  snippetBlock.append(textarea);
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

for (const block of document.querySelectorAll<HTMLElement>(
  "[data-code-snippet]",
)) {
  for (const card of block.querySelectorAll<HTMLElement>(
    "[data-snippet-annotation]",
  )) {
    const range = /^(\d+)(?:-(\d+))?$/u.exec(
      card.getAttribute("data-snippet-annotation") ?? "",
    );
    if (range === null) {
      continue;
    }
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    linkAnnotationHover({
      card,
      targets: [
        ...block.querySelectorAll<HTMLElement>("[data-snippet-line]"),
      ].filter((row) => {
        const line = Number(row.dataset.snippetLine);
        return line >= start && line <= end;
      }),
    });
  }
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-snippet-menu-button]",
  );
  const menuList = block.querySelector<HTMLElement>("[data-snippet-menu-list]");
  menuButton?.removeAttribute("hidden");

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

  block
    .querySelector<HTMLElement>("[data-snippet-menu]")
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
      await writeSnippetClipboard({ snippetBlock: block, value });
      showSnippetMessage({ block, message: successMessage });
    } catch {
      showSnippetMessage({ block, message: "Could not copy" });
    }
  };

  block
    .querySelector<HTMLButtonElement>("[data-snippet-copy-path]")
    ?.addEventListener("click", () => {
      void copyToClipboard({
        value: block.dataset.snippetPath ?? "",
        successMessage: "Path copied!",
      });
    });

  block
    .querySelector<HTMLButtonElement>("[data-snippet-copy-code]")
    ?.addEventListener("click", () => {
      const source = block.querySelector<HTMLTextAreaElement>(
        "[data-snippet-source]",
      );
      if (source === null) {
        return;
      }
      void copyToClipboard({
        value: source.value,
        successMessage: "Code copied!",
      });
    });
}

// One document-level dismissal handles every snippet menu without coupling
// menu instances or installing redundant global listeners.
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll<HTMLElement>(
    "[data-snippet-menu]",
  )) {
    const button = menu.querySelector<HTMLButtonElement>(
      "[data-snippet-menu-button]",
    );
    const list = menu.querySelector<HTMLElement>("[data-snippet-menu-list]");
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
