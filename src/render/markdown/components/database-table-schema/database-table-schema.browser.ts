// Owns DatabaseTableSchema's progressively enhanced actions menu, the
// name/source clipboard behavior, full-screen viewing, and the tab bar that
// folds the Indexes and DDL bands; the grid stays readable without any of it.

import {
  openComponentFullScreen,
  updateFullScreenControl,
} from "../shared/full-screen/full-screen.browser.js";

let nextSchemaPanelId = 1;

// The reader's grid-column layout is one document-wide preference holding a
// full order permutation plus the hidden set: every schema grid follows it,
// hiding a column never forgets its place in the order, and the pair
// survives reloads through localStorage.
const COLUMNS_STORAGE_KEY = "big-plan:table-schema-columns";

type SchemaColumnKey =
  "column" | "type" | "constraints" | "default" | "comment";

const COLUMN_KEYS: ReadonlyArray<SchemaColumnKey> = [
  "column",
  "type",
  "constraints",
  "default",
  "comment",
];

// The head row calls the name column "column" while body cells call it
// "name"; the pair maps one order key onto both row shapes.
const CELL_CLASS_BY_KEY: Readonly<Record<SchemaColumnKey, string>> = {
  column: "table-schema-cell-name",
  type: "table-schema-cell-type",
  constraints: "table-schema-cell-constraints",
  default: "table-schema-cell-default",
  comment: "table-schema-cell-comment",
};

const isColumnKey = (value: string): value is SchemaColumnKey =>
  COLUMN_KEYS.some((key) => key === value);

const headKeyOf = (head: HTMLElement): SchemaColumnKey | undefined => {
  for (const key of COLUMN_KEYS) {
    if (head.classList.contains(`table-schema-head-${key}`)) {
      return key;
    }
  }
  return undefined;
};

// A stored layout is honored only when its order is a full permutation of
// the known keys and its hidden set never includes the name column, so stale
// or foreign values fall back to the authored layout.
const readStoredColumnLayout = ():
  | {
      readonly order: ReadonlyArray<SchemaColumnKey>;
      readonly hidden: ReadonlyArray<SchemaColumnKey>;
    }
  | undefined => {
  try {
    const stored = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const order: unknown = Reflect.get(parsed, "order");
    const hidden: unknown = Reflect.get(parsed, "hidden");
    if (
      Array.isArray(order) &&
      order.length === COLUMN_KEYS.length &&
      COLUMN_KEYS.every(
        (key) =>
          order.filter((value) => typeof value === "string" && value === key)
            .length === 1,
      ) &&
      Array.isArray(hidden) &&
      hidden.every(
        (value) =>
          typeof value === "string" && isColumnKey(value) && value !== "column",
      )
    ) {
      return {
        order: order.filter(
          (value): value is SchemaColumnKey =>
            typeof value === "string" && isColumnKey(value),
        ),
        hidden,
      };
    }
  } catch {
    // Private modes without storage read as "no preference".
  }
  return undefined;
};

const storedLayout = readStoredColumnLayout();
let columnOrder: ReadonlyArray<SchemaColumnKey> =
  storedLayout?.order ?? COLUMN_KEYS;
let hiddenColumns: ReadonlySet<SchemaColumnKey> = new Set(
  storedLayout?.hidden ?? [],
);

const persistColumnLayout = (): void => {
  try {
    if (
      hiddenColumns.size === 0 &&
      columnOrder.every((key, index) => key === COLUMN_KEYS[index])
    ) {
      window.localStorage.removeItem(COLUMNS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        COLUMNS_STORAGE_KEY,
        JSON.stringify({ order: columnOrder, hidden: [...hiddenColumns] }),
      );
    }
  } catch {
    // The layout still applies for this page when storage is unavailable.
  }
};

// Reorders and shows or hides every schema grid's columns to the current
// preference by re-appending each row's cells; the width-bearing head
// classes travel with their cells, and hidden cells drop out through the
// hidden attribute.
const applyColumnLayout = (): void => {
  for (const grid of document.querySelectorAll<HTMLTableElement>(
    ".table-schema-grid",
  )) {
    const headRow = grid.querySelector("thead tr");
    if (headRow !== null) {
      for (const key of columnOrder) {
        const head = headRow.querySelector<HTMLElement>(
          `.table-schema-head-${key}`,
        );
        if (head !== null) {
          head.hidden = hiddenColumns.has(key);
          headRow.append(head);
        }
      }
    }
    for (const row of grid.querySelectorAll("tbody tr")) {
      for (const key of columnOrder) {
        const cell = row.querySelector<HTMLElement>(
          `.${CELL_CLASS_BY_KEY[key]}`,
        );
        if (cell !== null) {
          cell.hidden = hiddenColumns.has(key);
          row.append(cell);
        }
      }
    }
  }
  // Every columns menu mirrors the shared state, whatever figure it sits on.
  for (const toggle of document.querySelectorAll<HTMLElement>(
    "[data-schema-column-toggle]",
  )) {
    const key = toggle.dataset.schemaColumnToggle ?? "";
    const visible = !isColumnKey(key) || !hiddenColumns.has(key);
    toggle.setAttribute("aria-checked", visible ? "true" : "false");
    toggle
      .querySelector('[data-lucide="check"]')
      ?.toggleAttribute("hidden", !visible);
  }
};

const moveColumn = ({
  key,
  toIndex,
}: {
  readonly key: SchemaColumnKey;
  readonly toIndex: number;
}): void => {
  const fromIndex = columnOrder.indexOf(key);
  if (
    fromIndex === -1 ||
    toIndex < 0 ||
    toIndex >= columnOrder.length ||
    fromIndex === toIndex
  ) {
    return;
  }
  const next = [...columnOrder];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, key);
  columnOrder = next;
  applyColumnLayout();
  persistColumnLayout();
};

const resetColumnLayout = (): void => {
  columnOrder = COLUMN_KEYS;
  hiddenColumns = new Set();
  applyColumnLayout();
  persistColumnLayout();
};

const toggleColumn = (key: SchemaColumnKey): void => {
  if (key === "column") {
    return;
  }
  const next = new Set(hiddenColumns);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  hiddenColumns = next;
  applyColumnLayout();
  persistColumnLayout();
};

// Column headers reorder by drag or by arrow keys; the moved header keeps
// focus so keyboard readers can walk a column across the grid.
const enhanceColumnReordering = (block: HTMLElement): void => {
  const heads = block.querySelectorAll<HTMLElement>(
    ".table-schema-grid thead .table-schema-head",
  );
  if (heads.length < 2) {
    return;
  }
  block.dataset.schemaReorderable = "";
  let draggedKey: SchemaColumnKey | undefined;
  for (const head of heads) {
    const key = headKeyOf(head);
    if (key === undefined) {
      continue;
    }
    head.draggable = true;
    head.tabIndex = 0;
    head.title = "Drag or use arrow keys to reorder columns";
    head.addEventListener("dragstart", (event) => {
      draggedKey = key;
      event.dataTransfer?.setData("text/plain", key);
    });
    head.addEventListener("dragend", () => {
      draggedKey = undefined;
      head.classList.remove("table-schema-head-drop");
    });
    head.addEventListener("dragover", (event) => {
      if (draggedKey !== undefined && draggedKey !== key) {
        event.preventDefault();
        head.classList.add("table-schema-head-drop");
      }
    });
    head.addEventListener("dragleave", () => {
      head.classList.remove("table-schema-head-drop");
    });
    head.addEventListener("drop", (event) => {
      head.classList.remove("table-schema-head-drop");
      if (draggedKey === undefined || draggedKey === key) {
        return;
      }
      event.preventDefault();
      const keyBeingDragged = draggedKey;
      const orderWithoutDragged = columnOrder.filter(
        (columnKey) => columnKey !== keyBeingDragged,
      );
      moveColumn({
        key: keyBeingDragged,
        toIndex: orderWithoutDragged.indexOf(key),
      });
      draggedKey = undefined;
    });
    head.addEventListener("keydown", (event) => {
      const offset =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (offset === 0) {
        return;
      }
      event.preventDefault();
      // A one-step move lands past any hidden neighbors, so the column
      // visibly changes place instead of swapping with an invisible slot.
      let toIndex = columnOrder.indexOf(key) + offset;
      while (
        toIndex >= 0 &&
        toIndex < columnOrder.length &&
        hiddenColumns.has(columnOrder[toIndex] ?? "column")
      ) {
        toIndex += offset;
      }
      moveColumn({ key, toIndex });
      head.focus();
    });
  }
};

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
    let panelId: string;
    let tabId: string;
    while (true) {
      const candidatePanelId = `table-schema-panel-${nextSchemaPanelId}`;
      const candidateTabId = `${candidatePanelId}-tab`;
      nextSchemaPanelId += 1;
      if (
        document.getElementById(candidatePanelId) === null &&
        document.getElementById(candidateTabId) === null
      ) {
        panelId = candidatePanelId;
        tabId = candidateTabId;
        break;
      }
    }
    section.id = panelId;
    section.setAttribute("role", "tabpanel");
    const label = section.querySelector<HTMLElement>(
      ".table-schema-section-label",
    );
    label?.setAttribute("hidden", "");

    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = tabId;
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

// Turns each grid-side INDX reference into a jump control: activate the
// Indexes tab when the band is folded away, bring the entry into view, and
// flash it so the reader sees what the reference named.
const FLASH_RESET_MS = 1_600;
const flashTimers = new WeakMap<HTMLElement, number>();

const jumpToIndex = ({
  block,
  position,
}: {
  readonly block: HTMLElement;
  readonly position: string;
}): void => {
  const entry = block.querySelector<HTMLElement>(
    `[data-schema-index="${position}"]`,
  );
  if (entry === null) {
    return;
  }
  const section = entry.closest<HTMLElement>("section[data-schema-section]");
  if (section !== null && section.hidden) {
    block
      .querySelector<HTMLButtonElement>(
        `.table-schema-tab[aria-controls="${section.id}"]`,
      )
      ?.click();
  }
  // The page's smooth-unless-reduced-motion scroll preference comes from the
  // global scroll-behavior rule, so the default behavior inherits it.
  entry.scrollIntoView({ block: "center" });
  entry.tabIndex = -1;
  entry.focus({ preventScroll: true });
  const previousTimer = flashTimers.get(entry);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  entry.classList.remove("table-schema-index-flash");
  // Forcing a reflow restarts the flash when the same entry is hit twice.
  void entry.offsetWidth;
  entry.classList.add("table-schema-index-flash");
  flashTimers.set(
    entry,
    window.setTimeout(() => {
      entry.classList.remove("table-schema-index-flash");
      flashTimers.delete(entry);
    }, FLASH_RESET_MS),
  );
};

// The server renders INDX references as inert spans so the no-JavaScript
// document never shows a dead control; the enhancement swaps each for a
// same-looking button that jumps to its band entry.
const enhanceIndexJumps = (block: HTMLElement): void => {
  for (const marker of block.querySelectorAll<HTMLElement>(
    "[data-schema-indx]",
  )) {
    const position = marker.dataset.schemaIndx ?? "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${marker.className} table-schema-index-jump`;
    for (const [name, value] of Object.entries(marker.dataset)) {
      if (value !== undefined) {
        button.dataset[name] = value;
      }
    }
    button.textContent = marker.textContent;
    button.title = `Show index ${position}`;
    marker.replaceWith(button);
    button.addEventListener("click", () => {
      jumpToIndex({ block, position });
    });
  }
};

type MenuController = {
  readonly setOpen: (input: {
    readonly open: boolean;
    readonly focus?: "first" | "last";
  }) => void;
};

// Wires one header popover's button, list, and roving keyboard focus; both
// the actions menu and the columns checkbox menu share this shape, and item
// activation behavior stays with the caller.
const wireSchemaMenu = ({
  button,
  list,
  itemsSelector,
}: {
  readonly button: HTMLButtonElement | null;
  readonly list: HTMLElement | null;
  readonly itemsSelector: string;
}): MenuController => {
  const items = (): ReadonlyArray<HTMLButtonElement> =>
    list === null
      ? []
      : [...list.querySelectorAll<HTMLButtonElement>(itemsSelector)];

  const setOpen = ({
    open,
    focus,
  }: {
    readonly open: boolean;
    readonly focus?: "first" | "last";
  }): void => {
    if (button === null || list === null) {
      return;
    }
    button.setAttribute("aria-expanded", open ? "true" : "false");
    list.hidden = !open;
    const all = items();
    for (const item of all) {
      item.tabIndex = -1;
    }
    if (open && focus !== undefined) {
      const item = all[focus === "first" ? 0 : all.length - 1];
      if (item !== undefined) {
        item.tabIndex = 0;
        item.focus();
      }
    }
  };

  button?.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    setOpen({ open, ...(open ? { focus: "first" } : {}) });
  });

  button
    ?.closest<HTMLElement>("[data-schema-menu]")
    ?.addEventListener("keydown", (event) => {
      if (list === null) {
        return;
      }
      if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        setOpen({ open: false });
        button?.focus();
        return;
      }
      if (event.target === button && event.key === "ArrowDown") {
        event.preventDefault();
        setOpen({ open: true, focus: "first" });
        return;
      }
      if (event.target === button && event.key === "ArrowUp") {
        event.preventDefault();
        setOpen({ open: true, focus: "last" });
        return;
      }
      if (list.hidden) {
        return;
      }
      if (event.key === "Tab") {
        setOpen({ open: false });
        return;
      }
      const all = items();
      const currentIndex = all.findIndex((item) => item === event.target);
      if (currentIndex === -1) {
        return;
      }
      const destination =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? all.length - 1
            : event.key === "ArrowDown"
              ? (currentIndex + 1) % all.length
              : event.key === "ArrowUp"
                ? (currentIndex - 1 + all.length) % all.length
                : undefined;
      if (destination !== undefined) {
        event.preventDefault();
        const item = all[destination];
        if (item !== undefined) {
          for (const menuItem of all) {
            menuItem.tabIndex = menuItem === item ? 0 : -1;
          }
          item.focus();
        }
      }
    });

  return { setOpen };
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
  enhanceColumnReordering(block);
  enhanceIndexJumps(block);
  const menuButton = block.querySelector<HTMLButtonElement>(
    "[data-schema-menu-button]",
  );
  const menuList = block.querySelector<HTMLElement>("[data-schema-menu-list]");
  menuButton?.removeAttribute("hidden");
  const actionsMenuControl = wireSchemaMenu({
    button: menuButton,
    list: menuList,
    itemsSelector: '[role="menuitem"]',
  });

  const columnsButton = block.querySelector<HTMLButtonElement>(
    "[data-schema-columns-button]",
  );
  columnsButton?.removeAttribute("hidden");
  wireSchemaMenu({
    button: columnsButton,
    list: block.querySelector<HTMLElement>("[data-schema-columns-list]"),
    itemsSelector: '[role="menuitemcheckbox"]',
  });
  // Checkbox toggles keep the menu open so several columns flip in one visit.
  for (const toggle of block.querySelectorAll<HTMLButtonElement>(
    "[data-schema-column-toggle]",
  )) {
    toggle.addEventListener("click", () => {
      const key = toggle.dataset.schemaColumnToggle ?? "";
      if (isColumnKey(key)) {
        toggleColumn(key);
      }
    });
  }

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

  const copyToClipboard = async ({
    value,
    successMessage,
  }: {
    readonly value: string;
    readonly successMessage: string;
  }): Promise<void> => {
    actionsMenuControl.setOpen({ open: false });
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

  block
    .querySelector<HTMLButtonElement>("[data-schema-reset-columns]")
    ?.addEventListener("click", () => {
      actionsMenuControl.setOpen({ open: false });
      menuButton?.focus();
      resetColumnLayout();
      showSchemaMessage({ block, message: "Columns reset" });
    });
}

// A stored preference applies once every grid is enhanced, so first paint and
// reloads agree on the reader's arrangement.
applyColumnLayout();

// One document-level dismissal handles every schema menu without coupling
// menu instances or installing redundant global listeners; both popovers
// share the container-button-list shape.
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll<HTMLElement>(
    "[data-schema-menu]",
  )) {
    const button = menu.querySelector<HTMLButtonElement>(":scope > button");
    const list = menu.querySelector<HTMLElement>(':scope > [role="menu"]');
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
