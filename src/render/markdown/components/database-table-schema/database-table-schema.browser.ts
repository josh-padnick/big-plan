// Owns DatabaseTableSchema's progressively enhanced actions menu, the
// name/source clipboard behavior, full-screen viewing, and the tab bar that
// folds the Indexes and DDL bands; the grid stays readable without any of it.

import {
  openComponentFullScreen,
  updateFullScreenControl,
} from "../shared/full-screen/full-screen.browser.js";

let nextSchemaPanelId = 1;

// Folds the bands below the grid behind a tab bar when there is more than one,
// following the HttpEndpoint pattern: the stacked sections stay the
// no-JavaScript document, and each section's own label becomes its tab.
const enhanceSchemaTabs = (block: HTMLElement): void => {
  const body = block.querySelector<HTMLElement>(".table-schema-body");
  if (body === null) {
    return;
  }
  const sections = [
    ...body.querySelectorAll<HTMLElement>(
      ":scope > section[data-schema-section]",
    ),
  ];
  if (sections.length < 2) {
    return;
  }

  const bar = document.createElement("div");
  bar.className =
    "table-schema-tabs flex flex-wrap items-center gap-1 border-t border-edge px-2";
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Table schema sections");

  const tabs: Array<HTMLButtonElement> = [];
  const activate = (index: number): void => {
    for (const [position, section] of sections.entries()) {
      const tab = tabs[position];
      const active = position === index;
      section.hidden = !active;
      if (tab !== undefined) {
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
      }
    }
  };

  for (const [index, section] of sections.entries()) {
    const panelId = `table-schema-panel-${nextSchemaPanelId}`;
    nextSchemaPanelId += 1;
    section.id = panelId;
    section.setAttribute("role", "tabpanel");
    const label = section.querySelector<HTMLElement>(
      ".table-schema-section-label",
    );
    label?.setAttribute("hidden", "");

    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `${panelId}-tab`;
    tab.className =
      "table-schema-tab cursor-pointer border-0 bg-transparent px-2.5 py-2 font-sans text-xs font-semibold";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    section.setAttribute("aria-labelledby", tab.id);
    tab.append(
      section.dataset.schemaSection === "indexes"
        ? "Indexes"
        : (section.dataset.schemaDdlTitle ?? "DDL"),
    );
    // The label's badge marks a verbatim-DDL band; the tab inherits it so the
    // marker survives the fold.
    const labelBadge = label?.querySelector('[data-schema-badge="ddl"]');
    if (labelBadge !== null && labelBadge !== undefined) {
      const tabBadge = labelBadge.cloneNode(true);
      if (tabBadge instanceof HTMLElement) {
        tabBadge.classList.add("ml-1.5");
        tab.append(tabBadge);
      }
    }
    tab.addEventListener("click", () => {
      activate(index);
    });
    tab.addEventListener("keydown", (event) => {
      const destination =
        event.key === "ArrowRight"
          ? (index + 1) % sections.length
          : event.key === "ArrowLeft"
            ? (index - 1 + sections.length) % sections.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? sections.length - 1
                : undefined;
      if (destination === undefined) {
        return;
      }
      event.preventDefault();
      activate(destination);
      tabs[destination]?.focus();
    });
    tabs.push(tab);
    bar.append(tab);
  }

  const firstSection = sections[0];
  if (firstSection !== undefined) {
    body.insertBefore(bar, firstSection);
  }
  block.dataset.schemaTabbed = "";
  activate(0);
};

const SCHEMA_MESSAGE_RESET_MS = 2_000;
const schemaMessageTimers = new WeakMap<HTMLElement, number>();

// Flashes transient clipboard feedback through the same header convention as
// CodeSnippet while retaining the stable actions-menu label between operations.
const showSchemaMessage = ({
  block,
  message,
}: {
  readonly block: HTMLElement;
  readonly message: string;
}): void => {
  const slot = block.querySelector<HTMLElement>("[data-schema-copy-message]");
  if (slot === null) {
    return;
  }
  const previousTimer = schemaMessageTimers.get(slot);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-schema-menu-button]",
  );
  slot.textContent = message;
  slot.hidden = false;
  menuButton?.setAttribute("aria-label", message);
  const timer = window.setTimeout(() => {
    slot.hidden = true;
    menuButton?.setAttribute("aria-label", "More actions");
    schemaMessageTimers.delete(slot);
  }, SCHEMA_MESSAGE_RESET_MS);
  schemaMessageTimers.set(slot, timer);
};

// Keeps copy available for local file previews where Clipboard API access is
// unavailable or denied, without selecting the visible grid.
const writeSchemaClipboard = async ({
  schemaBlock,
  value,
}: {
  readonly schemaBlock: HTMLElement;
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
  schemaBlock.append(textarea);
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
  "[data-database-table-schema]",
)) {
  enhanceSchemaTabs(block);
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-schema-menu-button]",
  );
  const menuList = block.querySelector<HTMLElement>("[data-schema-menu-list]");
  menuButton?.removeAttribute("hidden");

  const expand = block.querySelector<HTMLButtonElement>("[data-schema-expand]");
  expand?.removeAttribute("hidden");
  expand?.addEventListener("click", () => {
    if (block.dataset.schemaExpanded !== undefined) {
      block.closest("dialog")?.close();
      return;
    }
    openComponentFullScreen({
      component: block,
      labelElement: block.querySelector<HTMLElement>(".table-schema-identity"),
      fallbackLabel: "Table schema",
      onToggle: ({ expanded }) => {
        if (expanded) {
          block.dataset.schemaExpanded = "";
        } else {
          delete block.dataset.schemaExpanded;
        }
        if (expand !== null) {
          updateFullScreenControl({
            button: expand,
            expanded,
            expandLabel: "View table schema full screen",
          });
        }
      },
    });
  });

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
    .querySelector<HTMLElement>("[data-schema-menu]")
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
      await writeSchemaClipboard({ schemaBlock: block, value });
      showSchemaMessage({ block, message: successMessage });
    } catch {
      showSchemaMessage({ block, message: "Could not copy" });
    }
  };

  block
    .querySelector<HTMLButtonElement>("[data-schema-copy-name]")
    ?.addEventListener("click", () => {
      void copyToClipboard({
        value: block.dataset.schemaTableName ?? "",
        successMessage: "Name copied!",
      });
    });

  block
    .querySelector<HTMLButtonElement>("[data-schema-copy-source]")
    ?.addEventListener("click", () => {
      const source = block.querySelector<HTMLTextAreaElement>(
        "[data-schema-source]",
      );
      if (source === null) {
        return;
      }
      void copyToClipboard({
        value: source.value,
        successMessage: "Source copied!",
      });
    });
}

// One document-level dismissal handles every schema menu without coupling
// menu instances or installing redundant global listeners.
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll<HTMLElement>(
    "[data-schema-menu]",
  )) {
    const button = menu.querySelector<HTMLButtonElement>(
      "[data-schema-menu-button]",
    );
    const list = menu.querySelector<HTMLElement>("[data-schema-menu-list]");
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
