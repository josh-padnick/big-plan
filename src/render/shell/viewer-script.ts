// The one script a rendered document ships, carrying the viewer enhancements:
// a scroll-spy that marks the section being read with aria-current on its TOC
// links (falling back to the overview links above the first section), hover
// popovers that float [data-info-popover] disclosures beside their triggers,
// annotation-to-code cross-highlighting, collapse toggles for deck parts,
// slides, and sub-slides, table-schema column state, a document comment draft,
// DataTable sorting, filtering, text fit, column layout and grouping, and one
// maximize behavior shared by every figure family, a decision matrix's column
// highlight, rationale swap, and confirm step, wireframe screen navigation
// driven entirely by renderer-emitted data attributes plus true-width scaling,
// and the diagram leg in ./diagram-script.ts. Plan content never contributes
// script, and every affordance keeps a no-JS fallback.
//
// The collapse leg reads the DOM contract owned by markdown/deck-collapse.ts:
// one header per collapsible, holding chrome only, with the body as its
// sibling. Every collapse query here is a direct-child lookup relying on that
// shape, so read those invariants before changing this or the deck transform.
//
// The DataTable leg reads the contract owned by components/data-table/view.tsx:
// [data-data-table] wraps one scroll container holding one table whose head
// cells carry data-table-column indices matching every body cell's index, and
// whose rows carry data-table-row in authored order. Group subheadings live in
// the same tbody but are chrome, so they never count, sort, or match a filter.
//
// The maximize leg reads the contract owned by
// components/_model/figure-controls/figure-controls.ts. This file is a string
// template and cannot import it, so a change to those attribute spellings
// changes the strings here too.
import { compareDataTableValues } from "../../components/data-table/sort-values.js";
import { DIAGRAM_SCRIPT } from "./diagram-script.js";

const COMPARE_DATA_TABLE_VALUES_SOURCE = compareDataTableValues.toString();

export const VIEWER_SCRIPT = `<script>
(() => {
  const links = Array.from(document.querySelectorAll("[data-section-link]"));
  const overviewLinks = Array.from(
    document.querySelectorAll("[data-overview-link]"),
  );
  const targets = new Map();
  for (const link of links) {
    const id = decodeURIComponent((link.getAttribute("href") || "").slice(1));
    const heading = document.getElementById(id);
    if (heading === null) continue;
    targets.set(heading, (targets.get(heading) || []).concat(link));
  }
  const headings = Array.from(targets.keys());
  if (headings.length === 0) {
    window.__bigPlanRefreshScrollSpy = () => {};
    return;
  }
  const isReadableHeading = (heading) => {
    if (!(heading instanceof Element)) return false;
    if (typeof heading.checkVisibility === "function") {
      try {
        if (
          !heading.checkVisibility({
            checkOpacity: false,
            checkVisibilityCSS: true,
          })
        )
          return false;
      } catch (_) {}
    }
    const rect = heading.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    // A heading is hidden exactly when it sits in the body of a collapsed
    // frame. Header chrome is never inside a body, so it always stays
    // readable - no per-kind special cases needed.
    let node = heading;
    while (node instanceof Element) {
      const parent = node.parentElement;
      if (
        parent !== null &&
        node.hasAttribute("data-collapse-body") &&
        parent.hasAttribute("data-collapsed")
      )
        return false;
      node = parent;
    }
    return true;
  };
  const apply = () => {
    const readingLine = window.innerHeight * 0.25;
    let current = null;
    for (const heading of headings) {
      if (!isReadableHeading(heading)) continue;
      if (heading.getBoundingClientRect().top <= readingLine) current = heading;
    }
    for (const [heading, sectionLinks] of targets) {
      for (const link of sectionLinks) {
        if (heading === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
    for (const link of overviewLinks) {
      if (current === null) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  window.__bigPlanRefreshScrollSpy = apply;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  apply();
})();
(() => {
  const infos = document.querySelectorAll("details[data-info-popover]");
  for (const info of infos) {
    const summary = info.querySelector("summary");
    const body = info.querySelector("[data-info-popover-body]");
    if (summary === null || body === null) continue;
    info.setAttribute("data-info-popover-floating", "");
    // Hover/focus openings are transient; a click or tap pins the same
    // disclosure until an outside activation or Escape.
    // Tracking that distinction prevents a pointerenter immediately before a
    // click from opening and then closing the popover in one gesture.
    let pinned = false;
    const open = () => {
      info.open = true;
      const anchor = summary.getBoundingClientRect();
      body.style.left = "0px";
      body.style.top = "0px";
      const size = body.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          anchor.left + anchor.width / 2 - size.width / 2,
          innerWidth - size.width - 8,
        ),
      );
      const below = anchor.bottom + 6;
      const top =
        below + size.height > innerHeight - 8
          ? Math.max(8, anchor.top - size.height - 6)
          : below;
      body.style.left = left + "px";
      body.style.top = top + "px";
    };
    const close = () => {
      info.open = false;
    };
    info.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") open();
    });
    info.addEventListener("pointerleave", () => {
      if (!pinned && !info.matches(":focus-within")) close();
    });
    summary.addEventListener("focus", () => {
      if (summary.matches(":focus-visible")) open();
    });
    info.addEventListener("focusout", (event) => {
      if (
        !pinned &&
        (!(event.relatedTarget instanceof Node) ||
          !info.contains(event.relatedTarget))
      )
        close();
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      pinned = true;
      // Chrome's trusted Summary activation may apply its native toggle
      // after this listener when hover already opened the Details. Reassert
      // the intended pinned state after that default-action phase.
      setTimeout(() => {
        open();
      }, 0);
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !info.open) return;
      pinned = false;
      event.bigPlanEscapeHandled = true;
      close();
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        pinned &&
        event.target instanceof Node &&
        !info.contains(event.target)
      ) {
        pinned = false;
        close();
      }
    });
    document.addEventListener(
      "scroll",
      () => {
        if (info.open) open();
      },
      { capture: true, passive: true },
    );
  }
})();
(() => {
  // One shared enhancement links annotation cards to their covered code rows
  // in both component families. The authored rows and cards remain complete
  // without it; this leg changes emphasis only while the pointer relates them.
  const linkHover = (card, targets) => {
    const linked = Array.from(new Set([card, ...targets]));
    const setHighlighted = (highlighted) => {
      for (const element of linked) {
        element.classList.toggle("annotation-hover", highlighted);
      }
    };
    for (const element of linked) {
      element.addEventListener("pointerenter", () => setHighlighted(true));
      element.addEventListener("pointerleave", () => setHighlighted(false));
    }
  };

  for (const diff of document.querySelectorAll("[data-code-diff]")) {
    const lines = Array.from(
      diff.querySelectorAll("[data-annotation-anchor]"),
    );
    for (const card of diff.querySelectorAll("[data-annotation-id]")) {
      const id = card.getAttribute("data-annotation-id");
      if (id === null || id === "") continue;
      linkHover(
        card,
        lines.filter((line) =>
          (line.getAttribute("data-annotation-anchor") || "")
            .split(/\\s+/u)
            .includes(id),
        ),
      );
    }
  }

  for (const snippet of document.querySelectorAll("[data-code-snippet]")) {
    const lines = Array.from(snippet.querySelectorAll("[data-snippet-line]"));
    for (const card of snippet.querySelectorAll("[data-snippet-annotation]")) {
      const range = /^(\\d+)(?:-(\\d+))?$/u.exec(
        card.getAttribute("data-snippet-annotation") || "",
      );
      if (range === null) continue;
      const start = Number(range[1]);
      const end = Number(range[2] || range[1]);
      linkHover(
        card,
        lines.filter((line) => {
          const lineNumber = Number(line.getAttribute("data-snippet-line"));
          return lineNumber >= start && lineNumber <= end;
        }),
      );
    }
  }
})();
(() => {
  const figures = Array.from(
    document.querySelectorAll("[data-database-table-schema]"),
  );
  if (figures.length === 0) return;
  const planId = document.documentElement.getAttribute("data-plan-id");
  const storageKey = (figure) => {
    const tableName = figure.getAttribute("data-schema-table-name");
    return planId === null ||
      planId === "" ||
      tableName === null ||
      tableName === ""
      ? null
      : "big-plan:table:" + planId + ":" + tableName;
  };
  let activeColumnDrag = null;
  for (const figure of figures) {
    const grid = figure.querySelector(".table-schema-grid");
    const headRow = grid?.querySelector("thead tr");
    if (grid === null || grid === undefined || headRow === null) continue;
    const rows = Array.from(grid.querySelectorAll("tbody tr"));
    const authoredOrder = Array.from(headRow.children)
      .map((head) => head.getAttribute("data-schema-grid-column"))
      .filter((column) => column !== null && column !== "");
    const allowedColumns = new Set(authoredOrder);
    if (
      authoredOrder.length !== headRow.children.length ||
      allowedColumns.size !== authoredOrder.length
    )
      continue;
    const button = figure.querySelector("[data-schema-columns-button]");
    const list = figure.querySelector("[data-schema-columns-list]");
    if (button === null || list === null) continue;
    const toggles = Array.from(
      list.querySelectorAll("[data-schema-column-toggle]"),
    );
    const toggleableColumns = new Set(
      toggles.map((toggle) =>
        toggle.getAttribute("data-schema-column-toggle"),
      ),
    );
    const hiddenColumns = new Set();

    const currentOrder = () =>
      Array.from(headRow.children)
        .map((head) => head.getAttribute("data-schema-grid-column"))
        .filter((column) => column !== null && column !== "");
    const persist = () => {
      const key = storageKey(figure);
      if (key === null) return;
      const order = currentOrder();
      const isAuthoredOrder = order.every(
        (column, index) => column === authoredOrder[index],
      );
      try {
        if (isAuthoredOrder && hiddenColumns.size === 0) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(
            key,
            JSON.stringify({
              order,
              hidden: order.filter((column) => hiddenColumns.has(column)),
            }),
          );
        }
      } catch (_) {}
    };
    const setColumnHidden = (column, hidden, save) => {
      if (!toggleableColumns.has(column)) return;
      if (hidden) hiddenColumns.add(column);
      else hiddenColumns.delete(column);
      for (const cell of figure.querySelectorAll(
        '[data-schema-grid-column="' + column + '"]',
      )) {
        cell.hidden = hidden;
      }
      const toggle = toggles.find(
        (candidate) =>
          candidate.getAttribute("data-schema-column-toggle") === column,
      );
      if (toggle !== undefined) {
        toggle.setAttribute("aria-checked", hidden ? "false" : "true");
        const check = toggle.querySelector('[data-lucide="check"]');
        if (check !== null) check.toggleAttribute("hidden", hidden);
      }
      if (save !== false) persist();
    };
    const moveColumn = (column, toIndex, save) => {
      const order = currentOrder();
      const fromIndex = order.indexOf(column);
      if (
        fromIndex === -1 ||
        toIndex < 0 ||
        toIndex >= order.length ||
        fromIndex === toIndex
      )
        return;
      const moveWithin = (parent) => {
        const items = Array.from(parent.children);
        const moving = items[fromIndex];
        const target = items[toIndex];
        if (moving === undefined || target === undefined) return;
        parent.insertBefore(
          moving,
          fromIndex < toIndex ? target.nextSibling : target,
        );
      };
      moveWithin(headRow);
      for (const row of rows) moveWithin(row);
      if (save !== false) persist();
    };
    const applyOrder = (order) => {
      for (let toIndex = 0; toIndex < order.length; toIndex += 1) {
        moveColumn(order[toIndex], toIndex, false);
      }
    };
    const readLayout = () => {
      const key = storageKey(figure);
      if (key === null) return null;
      try {
        const stored = JSON.parse(localStorage.getItem(key) || "null");
        if (stored === null || typeof stored !== "object") return null;
        const order = stored.order;
        const hidden = stored.hidden;
        if (
          !Array.isArray(order) ||
          order.length !== authoredOrder.length ||
          new Set(order).size !== authoredOrder.length ||
          !order.every(
            (column) =>
              typeof column === "string" && allowedColumns.has(column),
          ) ||
          !Array.isArray(hidden) ||
          new Set(hidden).size !== hidden.length ||
          !hidden.every(
            (column) =>
              typeof column === "string" && toggleableColumns.has(column),
          )
        )
          return null;
        return { order, hidden };
      } catch (_) {
        return null;
      }
    };
    const stored = readLayout();
    if (stored !== null) {
      applyOrder(stored.order);
      for (const column of stored.hidden) {
        setColumnHidden(column, true, false);
      }
    }

    const status = figure.querySelector("[data-schema-reorder-status]");
    const announceMove = (column) => {
      if (status === null) return;
      const head = Array.from(headRow.children).find(
        (candidate) =>
          candidate.getAttribute("data-schema-grid-column") === column,
      );
      const label = (head?.textContent || column).trim();
      status.textContent =
        label +
        " column moved to position " +
        String(currentOrder().indexOf(column) + 1) +
        " of " +
        String(authoredOrder.length) +
        ".";
    };
    const setMenuOpen = (open) => {
      list.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    };

    figure.setAttribute("data-schema-reorderable", "");
    for (const head of Array.from(headRow.children)) {
      const column = head.getAttribute("data-schema-grid-column");
      if (column === null || column === "") continue;
      const label = (head.textContent || column).trim();
      head.draggable = true;
      head.tabIndex = 0;
      head.title = "Drag or use Left and Right arrow keys to reorder";
      head.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
      head.setAttribute(
        "aria-label",
        label + " column. Use Left and Right arrow keys to reorder.",
      );
      head
        .querySelector('[data-lucide="grip-vertical"]')
        ?.removeAttribute("hidden");
      head.addEventListener("keydown", (event) => {
        const direction =
          event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (direction === 0) return;
        event.preventDefault();
        const order = currentOrder();
        let toIndex = order.indexOf(column) + direction;
        while (
          toIndex >= 0 &&
          toIndex < order.length &&
          hiddenColumns.has(order[toIndex])
        ) {
          toIndex += direction;
        }
        moveColumn(column, toIndex);
        head.focus();
        announceMove(column);
      });
      head.addEventListener("dragstart", (event) => {
        activeColumnDrag = { figure, column };
        if (event.dataTransfer !== null) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", column);
        }
      });
      let dropAfter = false;
      const clearDrop = () => {
        head.classList.remove("table-schema-head-drop-before");
        head.classList.remove("table-schema-head-drop-after");
        dropAfter = false;
      };
      head.addEventListener("dragover", (event) => {
        if (
          activeColumnDrag?.figure !== figure ||
          activeColumnDrag.column === column
        ) {
          clearDrop();
          return;
        }
        event.preventDefault();
        const bounds = head.getBoundingClientRect();
        dropAfter = event.clientX > bounds.left + bounds.width / 2;
        head.classList.toggle("table-schema-head-drop-before", !dropAfter);
        head.classList.toggle("table-schema-head-drop-after", dropAfter);
      });
      head.addEventListener("dragleave", clearDrop);
      head.addEventListener("dragend", () => {
        clearDrop();
        if (activeColumnDrag?.figure === figure) activeColumnDrag = null;
      });
      head.addEventListener("drop", (event) => {
        const drag = activeColumnDrag;
        const after = dropAfter;
        clearDrop();
        if (
          drag?.figure !== figure ||
          drag.column === column ||
          !allowedColumns.has(drag.column)
        )
          return;
        event.preventDefault();
        activeColumnDrag = null;
        const order = currentOrder();
        const fromIndex = order.indexOf(drag.column);
        const targetIndex = order.indexOf(column);
        const boundary = targetIndex + (after ? 1 : 0);
        const insertion =
          boundary - (fromIndex < boundary ? 1 : 0);
        moveColumn(drag.column, insertion);
        announceMove(drag.column);
      });
    }

    for (const toggle of toggles) {
      toggle.removeAttribute("tabindex");
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        const column = toggle.getAttribute("data-schema-column-toggle");
        if (column === null || column === "") return;
        setColumnHidden(column, !hiddenColumns.has(column));
      });
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setMenuOpen(list.hidden);
    });
    const reset = list.querySelector("[data-schema-reset-columns]");
    if (reset !== null) {
      reset.removeAttribute("tabindex");
      reset.addEventListener("click", (event) => {
        event.preventDefault();
        applyOrder(authoredOrder);
        for (const column of Array.from(toggleableColumns)) {
          setColumnHidden(column, false, false);
        }
        persist();
        if (status !== null) status.textContent = "Column layout reset.";
      });
    }
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !list.hidden) {
        event.bigPlanEscapeHandled = true;
        setMenuOpen(false);
        button.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (
        !(event.target instanceof Node) ||
        list.parentElement === null ||
        !list.parentElement.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    });
    // The dormant menu becomes visible only after state restoration and every
    // reorder, visibility, persistence, and reset handler is installed.
    button.hidden = false;
  }
})();
(() => {
  const control = document.querySelector("[data-comment-draft-control]");
  if (control === null) return;
  const openButton = control.querySelector("[data-comment-draft-open]");
  const panel = control.querySelector("[data-comment-draft-panel]");
  const closeButton = control.querySelector("[data-comment-draft-close]");
  const input = control.querySelector("[data-comment-draft-input]");
  const saveButton = control.querySelector("[data-comment-draft-save]");
  const status = control.querySelector("[data-comment-draft-status]");
  if (
    openButton === null ||
    panel === null ||
    closeButton === null ||
    input === null ||
    saveButton === null ||
    status === null
  )
    return;
  const planId = document.documentElement.getAttribute("data-plan-id");
  const key =
    planId === null || planId === ""
      ? null
      : "big-plan:draft:" + planId + ":document";
  if (key !== null) {
    try {
      input.value = localStorage.getItem(key) || "";
    } catch (_) {}
  }
  const setOpen = (open) => {
    panel.hidden = !open;
    openButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) input.focus();
  };
  control.hidden = false;
  openButton.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(panel.hidden);
  });
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(false);
    openButton.focus();
  });
  input.addEventListener("input", () => {
    status.textContent = "";
  });
  saveButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (key !== null) {
      try {
        if (input.value === "") localStorage.removeItem(key);
        else localStorage.setItem(key, input.value);
      } catch (_) {}
    }
    status.textContent = key === null ? "Kept in memory" : "Draft saved";
  });
  control.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.bigPlanEscapeHandled = true;
      setOpen(false);
      openButton.focus();
    }
  });
})();
(() => {
  const roots = Array.from(document.querySelectorAll("[data-wireframe]"));
  const fit = (screen) => {
    const frame = screen.querySelector(":scope > .wireframe-frame");
    if (frame === null || screen.clientWidth === 0) return;
    // offsetWidth stays in the frame's unscaled coordinate space. Writing a
    // numeric zoom avoids relying on unsupported length division in CSS.
    frame.style.zoom = "1";
    frame.style.zoom = String(
      Math.min(1, screen.clientWidth / frame.offsetWidth),
    );
  };
  for (const root of roots) {
    const screens = Array.from(
      root.querySelectorAll("[data-wireframe-screen]"),
    );
    if (screens.length === 0) continue;
    // Fit while every screen still participates in layout. Marking the root
    // interactive then narrows it to one screen; without this script the
    // complete storyboard remains readable, with true-width frames scrolling.
    for (const screen of screens) fit(screen);
    root.setAttribute("data-wireframe-interactive", "");
    const show = (id) => {
      let current = null;
      for (const screen of screens) {
        const active = screen.getAttribute("data-wireframe-screen") === id;
        screen.toggleAttribute("data-wireframe-current", active);
        if (active) current = screen;
      }
      for (const tab of root.querySelectorAll("[data-wireframe-switch]")) {
        if (tab.getAttribute("data-wireframe-navigate") === id)
          tab.setAttribute("aria-current", "true");
        else tab.removeAttribute("aria-current");
      }
      if (current !== null) requestAnimationFrame(() => fit(current));
    };
    root.addEventListener("click", (event) => {
      const trigger =
        event.target instanceof Element
          ? event.target.closest("[data-wireframe-navigate]")
          : null;
      if (trigger === null || !root.contains(trigger)) return;
      const id = trigger.getAttribute("data-wireframe-navigate");
      if (screens.some((screen) => screen.getAttribute("data-wireframe-screen") === id))
        show(id);
    });
  }
  addEventListener("resize", () => {
    for (const root of roots) {
      const current = root.querySelector(
        "[data-wireframe-screen][data-wireframe-current]",
      );
      if (current !== null) fit(current);
    }
  }, { passive: true });
})();
(() => {
  const blocks = Array.from(document.querySelectorAll("[data-collapsible]"));
  if (blocks.length === 0) return;
  const planId = document.documentElement.getAttribute("data-plan-id");
  const storageKey = (id) =>
    planId === null || planId === ""
      ? null
      : "big-plan:collapse:" + planId + ":" + id;
  // deck-collapse.ts guarantees one header per collapsible and that the body
  // is its sibling, so every lookup here is a direct-child query.
  const headerFor = (block) =>
    block.querySelector(":scope > [data-collapse-header]");
  const toggleFor = (block) => {
    const header = headerFor(block);
    return header === null
      ? null
      : header.querySelector(":scope > [data-collapse-toggle]");
  };
  // State only: attribute, control labels, persistence. No scroll handling, so
  // a bulk run can apply it many times and correct the viewport once.
  const applyCollapsed = (block, collapsed) => {
    if (collapsed) block.setAttribute("data-collapsed", "");
    else block.removeAttribute("data-collapsed");
    const button = toggleFor(block);
    if (button !== null) {
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const kind = block.getAttribute("data-collapsible") || "section";
      button.setAttribute(
        "aria-label",
        collapsed ? "Expand " + kind : "Collapse " + kind,
      );
    }
    const id = block.getAttribute("data-collapse-id");
    if (id !== null && id !== "") {
      const key = storageKey(id);
      if (key !== null) {
        try {
          localStorage.setItem(key, collapsed ? "1" : "0");
        } catch (_) {}
      }
    }
  };
  const refreshScrollSpy = () => {
    if (typeof window.__bigPlanRefreshScrollSpy === "function") {
      window.__bigPlanRefreshScrollSpy();
    }
  };
  // Holds a chosen element still in the viewport across a layout change, then
  // refreshes the scroll-spy. Header chrome is geometry-stable, so a single
  // toggle normally measures zero drift; this still matters when the document
  // shortens enough that the browser clamps scrollTop, which would otherwise
  // slide the page under the reader.
  const holdInPlace = (anchor, change) => {
    const beforeTop = anchor === null ? 0 : anchor.getBoundingClientRect().top;
    change();
    const settle = () => {
      if (anchor !== null) {
        const delta = anchor.getBoundingClientRect().top - beforeTop;
        if (Math.abs(delta) > 0.5) {
          const se = document.scrollingElement;
          if (se) se.scrollTop += delta;
          else window.scrollBy(0, delta);
        }
      }
      refreshScrollSpy();
    };
    settle();
    requestAnimationFrame(settle);
  };
  const setCollapsed = (block, collapsed) => {
    holdInPlace(headerFor(block) || block, () =>
      applyCollapsed(block, collapsed),
    );
  };
  // Only a top-level region's header is guaranteed to stay visible in both
  // states, so bulk operations anchor on the one the reader is inside.
  const topLevel = blocks.filter(
    (block) =>
      block.parentElement === null ||
      block.parentElement.closest("[data-collapsible]") === null,
  );
  const bulkAnchor = () => {
    const readingLine = window.innerHeight * 0.25;
    let found = null;
    for (const block of topLevel) {
      const header = headerFor(block);
      if (header === null) continue;
      if (header.getBoundingClientRect().top <= readingLine) found = header;
    }
    return found === null ? headerFor(topLevel[0] || blocks[0]) : found;
  };
  const setAllCollapsed = (collapsed) => {
    holdInPlace(bulkAnchor(), () => {
      for (const block of blocks) applyCollapsed(block, collapsed);
    });
  };
  let restoredCollapse = false;
  for (const block of blocks) {
    const id = block.getAttribute("data-collapse-id");
    if (id !== null && id !== "") {
      const key = storageKey(id);
      try {
        if (key !== null && localStorage.getItem(key) === "1") {
          applyCollapsed(block, true);
          restoredCollapse = true;
        }
      } catch (_) {}
    }
    const header = headerFor(block);
    const button = toggleFor(block);
    if (header === null || button === null) continue;
    const toggle = () =>
      setCollapsed(block, !block.hasAttribute("data-collapsed"));
    // The chevron stays the keyboard and assistive-technology control;
    // stopPropagation so the header handler does not double-toggle.
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    // The whole header (chevron + kicker + title) is the hit target. It holds
    // chrome only, so this cannot capture body clicks or a nested region's
    // click - see the invariants in deck-collapse.ts.
    header.addEventListener("click", (event) => {
      if (
        event.target.closest("a, button, input, textarea, select, summary, label")
      )
        return;
      event.preventDefault();
      toggle();
    });
  }
  if (restoredCollapse) refreshScrollSpy();
  // Bulk controls ship hidden so a scripts-disabled document never offers a
  // control it cannot honour; revealing them here is what makes them real.
  for (const controls of document.querySelectorAll(
    "[data-collapse-all-controls]",
  )) {
    controls.removeAttribute("hidden");
    controls.setAttribute("data-shown", "");
  }
  for (const button of document.querySelectorAll("[data-expand-all]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setAllCollapsed(false);
    });
  }
  for (const button of document.querySelectorAll("[data-collapse-all]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setAllCollapsed(true);
    });
  }
  const expandAncestors = (target) => {
    let expanded = false;
    let node = target;
    while (node instanceof Element) {
      if (
        node.hasAttribute("data-collapsible") &&
        node.hasAttribute("data-collapsed")
      ) {
        applyCollapsed(node, false);
        expanded = true;
      }
      node = node.parentElement;
    }
    if (expanded) refreshScrollSpy();
    return expanded;
  };
  const expandHash = (hash) => {
    if (!hash || hash === "#") return null;
    const id = decodeURIComponent(hash.slice(1));
    if (id === "") return null;
    const target = document.getElementById(id);
    if (target === null) return null;
    return { revealed: expandAncestors(target), target };
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link === null) return;
    const href = link.getAttribute("href");
    if (href === null) return;
    expandHash(href);
  });
  expandHash(location.hash);
  addEventListener("hashchange", () => {
    const result = expandHash(location.hash);
    if (result !== null && result.revealed) result.target.scrollIntoView();
  });
})();
(() => {
  const tables = Array.from(document.querySelectorAll("[data-data-table]"));
  if (tables.length === 0) return;
  const planId = document.documentElement.getAttribute("data-plan-id");
  const FITS = ["wrap", "truncate", "scroll"];
  const read = (key) => {
    if (key === null) return null;
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (_) {
      return null;
    }
  };
  const write = (key, value) => {
    if (key === null) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  };
  const compareDataTableValues = ${COMPARE_DATA_TABLE_VALUES_SOURCE};
  let activeColumnDrag = null;

  for (const figure of tables) {
    const grid = figure.querySelector("table");
    if (grid === null) continue;
    const headRow = grid.querySelector("thead tr");
    const authoredBody = grid.querySelector("tbody");
    if (headRow === null || authoredBody === null) continue;
    const heads = Array.from(headRow.children);
    const rows = Array.from(authoredBody.querySelectorAll("[data-table-row]"));
    const authoredRows = rows.slice().sort(
      (a, b) =>
        Number(a.getAttribute("data-table-row")) -
        Number(b.getAttribute("data-table-row")),
    );
    const columnCount = heads.length;
    const authoredFit = figure.getAttribute("data-table-fit") || "wrap";
    const storageKey =
      planId === null || planId === ""
        ? null
        : "big-plan:datatable:" +
          planId +
          ":" +
          (figure.getAttribute("data-table-id") || "table");
    const countLabel = figure.querySelector("[data-table-count]");
    const empty = figure.querySelector("[data-table-empty]");
    const filterInput = figure.querySelector("[data-table-filter-input]");
    const fitButton = figure.querySelector("[data-table-fit-button]");
    const fitList = figure.querySelector("[data-table-fit-list]");
    const resetButton = figure.querySelector("[data-table-reset]");
    let groupBodies = [];
    const authoredGroupColumn = Number(
      figure.getAttribute("data-table-group-column") || "-1",
    );
    let groupColumn = Number.NaN;
    const menuButton = figure.querySelector("[data-table-menu-button]");
    const menuList = figure.querySelector("[data-table-menu-list]");
    // Sorting and filtering read a cell's complete text, never what the
    // current fit lets the reader see, so a clamped cell still compares and
    // still matches on everything the author wrote.
    const cellOf = (row, column) =>
      Array.from(row.children).find(
        (cell) =>
          Number(cell.getAttribute("data-table-column")) === column,
      );
    const textOf = (row, column) => {
      const cell = cellOf(row, column);
      return cell === undefined ? "" : (cell.textContent || "").trim();
    };
    let authoredSortColumn = -1;
    let authoredSortDirection = 0;
    for (const head of heads) {
      const declared = head.getAttribute("data-table-authored-sort");
      if (declared !== null) {
        authoredSortColumn = Number(head.getAttribute("data-table-column"));
        authoredSortDirection = declared === "desc" ? -1 : 1;
      }
    }
    let sortColumn = authoredSortColumn;
    let sortDirection = authoredSortDirection;

    const currentOrder = () =>
      Array.from(headRow.children).map((head) =>
        Number(head.getAttribute("data-table-column")),
      );
    const hiddenColumns = () =>
      Array.from(headRow.children)
        .filter((head) => head.hidden)
        .map((head) => Number(head.getAttribute("data-table-column")));
    const authoredHidden =
      authoredGroupColumn < 0 ? [] : [authoredGroupColumn];
    const syncGroupSpans = () => {
      const visible = columnCount - hiddenColumns().length;
      for (const body of groupBodies) {
        const cell = body.querySelector("[data-table-group-heading] > th");
        if (cell !== null) cell.colSpan = visible;
      }
    };

    const persist = () => {
      write(storageKey, {
        order: currentOrder(),
        hidden: hiddenColumns(),
        fit: figure.getAttribute("data-table-fit"),
        group: groupColumn,
      });
    };

    const setFit = (fit, save) => {
      if (FITS.indexOf(fit) === -1) return;
      figure.setAttribute("data-table-fit", fit);
      const choices = figure.querySelectorAll("[data-table-fit-choice]");
      for (const choice of choices) {
        choice.setAttribute(
          "aria-checked",
          choice.getAttribute("data-table-fit-choice") === fit
            ? "true"
            : "false",
        );
      }
      if (save !== false) persist();
    };

    const setColumnHidden = (column, hidden, save) => {
      // The first authored column carries row identity; hiding it would leave
      // every remaining cell unattributable. The grouping column is exempt,
      // because its band states the value the column would have shown - and
      // it may itself be the first column.
      if (column === 0 && column !== groupColumn) return;
      for (const head of headRow.children) {
        if (Number(head.getAttribute("data-table-column")) !== column) continue;
        head.hidden = hidden;
      }
      for (const row of rows) {
        for (const cell of row.children) {
          if (Number(cell.getAttribute("data-table-column")) !== column)
            continue;
          cell.hidden = hidden;
        }
      }
      const toggle = figure.querySelector(
        '[data-table-column-toggle="' + column + '"]',
      );
      if (toggle !== null) {
        toggle.setAttribute("aria-checked", hidden ? "false" : "true");
      }
      // A subheading spans the grid, so its span has to follow the grid.
      syncGroupSpans();
      if (save !== false) persist();
    };
    const applyHiddenColumns = (hidden) => {
      for (let column = 0; column < columnCount; column += 1) {
        setColumnHidden(column, hidden.indexOf(column) !== -1, false);
      }
    };

    const moveColumn = (from, to, save) => {
      if (from === to || to < 0 || to >= columnCount) return;
      const moveWithin = (parent) => {
        const items = Array.from(parent.children);
        const moving = items[from];
        const reference = from < to ? items[to].nextSibling : items[to];
        parent.insertBefore(moving, reference);
      };
      moveWithin(headRow);
      for (const row of rows) moveWithin(row);
      if (save !== false) persist();
    };

    const applyOrder = (order) => {
      for (let target = 0; target < order.length; target += 1) {
        const positions = currentOrder();
        const from = positions.indexOf(order[target]);
        if (from === -1 || from === target) continue;
        moveColumn(from, target, false);
      }
    };

    const applyFilter = () => {
      const query = (filterInput === null ? "" : filterInput.value || "")
        .trim()
        .toLowerCase();
      let shown = 0;
      for (const row of rows) {
        row.removeAttribute("data-table-group-end");
        row.removeAttribute("data-table-group-last");
        const match =
          query === "" ||
          currentOrder().some((column) => {
            const cell = cellOf(row, column);
            return (
              cell !== undefined &&
              !cell.hidden &&
              (cell.textContent || "").toLowerCase().indexOf(query) !== -1
            );
          });
        row.hidden = !match;
        if (match) shown += 1;
      }
      const visibleGroups = [];
      for (const groupBody of groupBodies) {
        const label = groupBody.getAttribute("data-table-row-group");
        const visibleRows = rows.filter(
          (row) => !row.hidden && row.getAttribute("data-table-group") === label,
        );
        groupBody.hidden = visibleRows.length === 0;
        if (visibleRows.length !== 0) visibleGroups.push(visibleRows);
      }
      // Only groups with another visible band after them earn the separator.
      // Filtering may hide a whole group or leave just one, so marking every
      // group's last row would turn inter-group breathing room into dead space
      // at the bottom of the table.
      for (const visibleRows of visibleGroups.slice(0, -1)) {
        visibleRows[visibleRows.length - 1].setAttribute(
          "data-table-group-end",
          "",
        );
      }
      const lastVisibleGroup = visibleGroups[visibleGroups.length - 1];
      if (lastVisibleGroup !== undefined) {
        lastVisibleGroup[lastVisibleGroup.length - 1].setAttribute(
          "data-table-group-last",
          "",
        );
      }
      if (countLabel !== null) {
        countLabel.textContent =
          query === ""
            ? rows.length + " rows"
            : shown + " of " + rows.length + " rows";
      }
      if (empty !== null) {
        empty.hidden = shown !== 0;
        if (shown === 0) empty.textContent = 'No rows match "' + query + '".';
      }
    };

    const applySort = () => {
      for (const head of headRow.children) {
        const index = Number(head.getAttribute("data-table-column"));
        const active = index === sortColumn && sortDirection !== 0;
        if (active) {
          head.setAttribute(
            "aria-sort",
            sortDirection === 1 ? "ascending" : "descending",
          );
          head.setAttribute(
            "data-table-sorted",
            sortDirection === 1 ? "asc" : "desc",
          );
        } else {
          head.setAttribute("aria-sort", "none");
          head.removeAttribute("data-table-sorted");
        }
        const glyph = head.querySelector("[data-lucide=chevrons-up-down]");
        const up = head.querySelector("[data-lucide=arrow-up]");
        const down = head.querySelector("[data-lucide=arrow-down]");
        if (glyph !== null) glyph.hidden = active;
        if (up !== null) up.hidden = !(active && sortDirection === 1);
        if (down !== null) down.hidden = !(active && sortDirection === -1);
      }
      const ordered = rows.slice();
      if (sortDirection !== 0 && sortColumn >= 0) {
        const activeHead = heads.find(
          (head) =>
            Number(head.getAttribute("data-table-column")) === sortColumn,
        );
        const type = activeHead?.getAttribute("data-table-type") || "text";
        // Sorting is stable, so a second sort keeps the previous answer as the
        // tiebreaker and two clicks build a two-key view.
        const positions = new Map();
        ordered.forEach((row, index) => positions.set(row, index));
        ordered.sort((a, b) => {
          const verdict = compareDataTableValues({
            left: textOf(a, sortColumn),
            right: textOf(b, sortColumn),
            type,
            direction: sortDirection,
          });
          return verdict === 0 ? positions.get(a) - positions.get(b) : verdict;
        });
        if (groupBodies.length !== 0) {
          // Re-append below restores group order; this keeps the array the
          // script reasons about in the same order the reader will see.
          const groupOrder = groupBodies.map((body) =>
            body.getAttribute("data-table-row-group"),
          );
          ordered.sort(
            (a, b) =>
              groupOrder.indexOf(a.getAttribute("data-table-group")) -
              groupOrder.indexOf(b.getAttribute("data-table-group")),
          );
        }
      } else {
        ordered.sort(
          (a, b) =>
            Number(a.getAttribute("data-table-row")) -
            Number(b.getAttribute("data-table-row")),
        );
      }
      // On a grouped table the subheadings are the outer order, so sorting
      // rearranges rows inside a group and never across one.
      if (groupBodies.length === 0) {
        for (const row of ordered) authoredBody.appendChild(row);
      } else {
        for (const groupBody of groupBodies) {
          const label = groupBody.getAttribute("data-table-row-group");
          for (const row of ordered) {
            if (row.getAttribute("data-table-group") === label)
              groupBody.appendChild(row);
          }
        }
      }
      rows.length = 0;
      for (const row of ordered) rows.push(row);
    };

    // Grouping is a setting, so the reader can move it to another column.
    // This is the one place the script builds markup rather than toggling it;
    // every selected value becomes one body containing its band and rows.
    const buildGroupBody = (label) => {
      const body = document.createElement("tbody");
      body.setAttribute("data-table-row-group", label);
      const row = document.createElement("tr");
      row.className = "data-table-group-row";
      row.setAttribute("data-table-group-heading", label);
      const cell = document.createElement("th");
      cell.setAttribute("scope", "rowgroup");
      cell.textContent = label;
      row.appendChild(cell);
      body.appendChild(row);
      return body;
    };
    const setGroupColumn = (next, save) => {
      if (next === groupColumn) return;
      for (const body of groupBodies) body.remove();
      groupBodies = [];
      // The old grouping column goes back to being an ordinary visible column;
      // the new one hides, because its band now says what it said.
      if (groupColumn >= 0) setColumnHidden(groupColumn, false, false);
      groupColumn = next;
      if (groupColumn >= 0) setColumnHidden(groupColumn, true, false);
      for (const row of rows) {
        if (groupColumn < 0) {
          row.removeAttribute("data-table-group");
          continue;
        }
        row.setAttribute("data-table-group", textOf(row, groupColumn));
      }
      if (groupColumn >= 0) {
        const seen = [];
        for (const row of authoredRows) {
          const label = row.getAttribute("data-table-group");
          if (seen.indexOf(label) === -1) seen.push(label);
        }
        authoredBody.remove();
        for (const label of seen) {
          const body = buildGroupBody(label);
          groupBodies.push(body);
          grid.appendChild(body);
        }
      } else {
        grid.appendChild(authoredBody);
      }
      figure.toggleAttribute("data-table-grouped", groupColumn >= 0);
      // Column 0 is only lockable while it is not the one supplying bands.
      const firstToggle = figure.querySelector('[data-table-column-toggle="0"]');
      if (firstToggle !== null) firstToggle.disabled = groupColumn !== 0;
      for (const choice of figure.querySelectorAll("[data-table-group-choice]")) {
        choice.setAttribute(
          "aria-checked",
          Number(choice.getAttribute("data-table-group-choice")) === groupColumn
            ? "true"
            : "false",
        );
      }
      applySort();
      syncGroupSpans();
      applyFilter();
      if (save !== false) persist();
    };

    // Restore the reader's saved layout before wiring controls, so the first
    // paint after a reload already matches what they left.
    const saved = read(storageKey);
    let restoredGroupColumn = authoredGroupColumn;
    if (saved !== null && typeof saved === "object") {
      if (Array.isArray(saved.order) && saved.order.length === columnCount) {
        applyOrder(saved.order);
      }
      if (typeof saved.fit === "string") setFit(saved.fit, false);
      if (
        typeof saved.group === "number" &&
        saved.group >= -1 &&
        saved.group < columnCount
      ) {
        restoredGroupColumn = saved.group;
      }
    }
    setGroupColumn(restoredGroupColumn, false);
    if (
      saved !== null &&
      typeof saved === "object" &&
      Array.isArray(saved.hidden)
    ) {
      applyHiddenColumns(saved.hidden);
    }
    // Every control ships dormant so a document read without scripts shows no
    // affordance that cannot act. Enabling them is the last thing this leg
    // does for a table, after its state is already restored.
    figure.setAttribute("data-table-reorderable", "");
    figure.setAttribute("data-table-interactive", "");
    for (const control of figure.querySelectorAll(
      "[data-table-filter],[data-table-fit-button],[data-table-menu-button],[data-table-reset]",
    )) {
      control.hidden = false;
    }

    for (const head of headRow.children) {
      head.setAttribute("draggable", "true");
      const button = head.querySelector("[data-table-sort]");
      if (button !== null) {
        button.disabled = false;
        button.addEventListener("click", () => {
          const index = Number(head.getAttribute("data-table-column"));
          if (index === sortColumn) {
            // Three states, because the author's order is information and a
            // table that cannot return to it loses that on the first click.
            sortDirection =
              sortDirection === 1 ? -1 : sortDirection === -1 ? 0 : 1;
            if (sortDirection === 0) sortColumn = -1;
          } else {
            sortColumn = index;
            sortDirection = 1;
          }
          applySort();
          applyFilter();
        });
        button.addEventListener("keydown", (event) => {
          if (!event.altKey) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const positions = Array.from(headRow.children);
          const from = positions.indexOf(head);
          moveColumn(from, from + (event.key === "ArrowLeft" ? -1 : 1));
          button.focus();
        });
      }
      head.addEventListener("dragstart", (event) => {
        const positions = Array.from(headRow.children);
        const from = positions.indexOf(head);
        activeColumnDrag = { figure, from };
        event.dataTransfer.effectAllowed = "move";
      });
      let dropAfter = false;
      const clear = () => {
        head.classList.remove("data-table-head-drop-before");
        head.classList.remove("data-table-head-drop-after");
        dropAfter = false;
      };
      head.addEventListener("dragover", (event) => {
        const from = activeColumnDrag?.from;
        if (
          activeColumnDrag?.figure !== figure ||
          !Number.isInteger(from) ||
          from < 0 ||
          from >= columnCount
        ) {
          clear();
          return;
        }
        event.preventDefault();
        const box = head.getBoundingClientRect();
        dropAfter = event.clientX > box.left + box.width / 2;
        head.classList.toggle("data-table-head-drop-before", !dropAfter);
        head.classList.toggle("data-table-head-drop-after", dropAfter);
      });
      head.addEventListener("dragleave", clear);
      head.addEventListener("dragend", () => {
        clear();
        if (activeColumnDrag?.figure === figure) activeColumnDrag = null;
      });
      head.addEventListener("drop", (event) => {
        const drag = activeColumnDrag;
        const after = dropAfter;
        clear();
        if (
          drag?.figure !== figure ||
          !Number.isInteger(drag.from) ||
          drag.from < 0 ||
          drag.from >= columnCount
        )
          return;
        event.preventDefault();
        activeColumnDrag = null;
        const from = drag.from;
        const positions = Array.from(headRow.children);
        const to = positions.indexOf(head);
        const boundary = to + (after ? 1 : 0);
        const insertion = boundary - (from < boundary ? 1 : 0);
        moveColumn(from, insertion);
      });
    }

    if (filterInput !== null) {
      filterInput.addEventListener("input", applyFilter);
      filterInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || filterInput.value === "") return;
        event.bigPlanEscapeHandled = true;
        filterInput.value = "";
        applyFilter();
      });
    }

    const resetLayout = () => {
      applyOrder(Array.from({ length: columnCount }, (_, index) => index));
      setGroupColumn(-1, false);
      sortColumn = authoredSortColumn;
      sortDirection = authoredSortDirection;
      applySort();
      setGroupColumn(authoredGroupColumn, false);
      applyHiddenColumns(authoredHidden);
      setFit(authoredFit, false);
      persist();
      applyFilter();
    };
    if (resetButton !== null) {
      resetButton.addEventListener("click", resetLayout);
    }

    // Both popovers behave identically, so they share one wiring pass; only
    // one may be open at a time, because two overlapping menus in a figure
    // header is chrome fighting itself.
    const popovers = [
      { button: menuButton, list: menuList },
      { button: fitButton, list: fitList },
    ].filter((entry) => entry.button !== null && entry.list !== null);
    const closeMenus = (restoreFocus) => {
      let trigger = null;
      for (const entry of popovers) {
        if (!entry.list.hidden) trigger = entry.button;
        entry.list.hidden = true;
        entry.button.setAttribute("aria-expanded", "false");
      }
      if (restoreFocus === true && trigger !== null) trigger.focus();
    };
    const focusMenuItem = (entry, item) => {
      const items = Array.from(
        entry.list.querySelectorAll(
          '[role="menuitemcheckbox"]:not(:disabled),[role="menuitemradio"]:not(:disabled)',
        ),
      );
      if (items.length === 0) return;
      const target = item || items.find(
        (candidate) => candidate.getAttribute("aria-checked") === "true",
      ) || items[0];
      for (const candidate of items) candidate.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    };
    for (const entry of popovers) {
      entry.button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = entry.list.hidden;
        closeMenus(false);
        entry.list.hidden = !open;
        entry.button.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) focusMenuItem(entry);
      });
      // A menu stays open across consecutive choices, because choosing
      // columns is a comparison rather than a single answer.
      entry.list.addEventListener("click", (event) => {
        event.stopPropagation();
        const toggle = event.target.closest("[data-table-column-toggle]");
        if (toggle !== null) {
          const column = Number(
            toggle.getAttribute("data-table-column-toggle"),
          );
          setColumnHidden(
            column,
            toggle.getAttribute("aria-checked") === "true",
          );
          applyFilter();
          return;
        }
        const choice = event.target.closest("[data-table-fit-choice]");
        if (choice !== null) {
          setFit(choice.getAttribute("data-table-fit-choice"));
          return;
        }
        const group = event.target.closest("[data-table-group-choice]");
        if (group !== null) {
          setGroupColumn(Number(group.getAttribute("data-table-group-choice")));
        }
      });
      entry.list.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          event.bigPlanEscapeHandled = true;
          closeMenus(true);
          return;
        }
        if (
          event.key !== "ArrowDown" &&
          event.key !== "ArrowUp" &&
          event.key !== "Home" &&
          event.key !== "End"
        ) {
          return;
        }
        event.preventDefault();
        const items = Array.from(
          entry.list.querySelectorAll(
            '[role="menuitemcheckbox"]:not(:disabled),[role="menuitemradio"]:not(:disabled)',
          ),
        );
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? current < 0
                  ? 0
                  : (current + 1) % items.length
                : current < 0
                  ? items.length - 1
                  : (current - 1 + items.length) % items.length;
        focusMenuItem(entry, items[index]);
      });
    }
    if (popovers.length !== 0) {
      document.addEventListener("click", (event) => {
        // A click inside either of this figure's popovers is the reader still
        // using it; anything else dismisses.
        const inside =
          event.target instanceof Element &&
          figure.contains(event.target) &&
          event.target.closest("[data-table-menu]") !== null;
        if (!inside) closeMenus(false);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const openMenu = popovers.some((entry) => !entry.list.hidden);
        if (!openMenu) return;
        event.bigPlanEscapeHandled = true;
        closeMenus(true);
      });
    }

    applySort();
    applyFilter();
  }
})();
(() => {
  // One maximize behavior for every supported figure family. The vocabulary
  // is owned by components/_model/figure-controls/figure-controls.ts; this leg
  // is a string template and cannot import it, so any change there changes
  // these three attribute names too.
  const frames = Array.from(
    document.querySelectorAll("[data-figure-maximizable]"),
  );
  if (frames.length === 0) return;
  let open = null;
  // How the open panel was activated. Restoring focus is required either way -
  // a keyboard reader must land back on the control they pressed - but the
  // ring and its tooltip should only reappear for the reader who needs them.
  let openedByKeyboard = false;
  let isolatedElements = [];
  let dialogAttributes = null;
  const subjectOf = (frame) =>
    frame.getAttribute("data-figure-maximizable") || "figure";
  const requestRestore = (frame) =>
    frame.dispatchEvent(
      new CustomEvent("figure-restore-request", { cancelable: true }),
    );
  const isolate = (frame) => {
    let branch = frame;
    while (branch.parentElement !== null) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          !sibling.inert
        ) {
          sibling.inert = true;
          isolatedElements.push(sibling);
        }
      }
      if (parent === document.body) break;
      branch = parent;
    }
  };
  const restoreIsolation = () => {
    for (const element of isolatedElements) element.inert = false;
    isolatedElements = [];
  };
  const restoreAttribute = (element, name, value) => {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };
  const isRendered = (element) =>
    element.getClientRects().length !== 0 &&
    getComputedStyle(element).visibility === "visible";
  const isRenderedArea = (area) => {
    const map = area.closest("map[name]");
    const name = map?.getAttribute("name");
    if (name === null || name === undefined || name === "") return false;
    const useMap = "#" + name;
    const owner = Array.from(
      document.querySelectorAll("img[usemap],object[usemap]"),
    ).find((candidate) => candidate.getAttribute("usemap") === useMap);
    return owner !== undefined && isRendered(owner);
  };
  const isTabbable = (element) => {
    if (
      !(element instanceof HTMLElement || element instanceof SVGElement) ||
      element.tabIndex < 0 ||
      element.matches(":disabled") ||
      element.closest("[hidden]") !== null ||
      element.closest("[inert]") !== null
    )
      return false;
    if (element.localName === "summary") {
      const details = element.parentElement;
      if (
        !(details instanceof HTMLDetailsElement) ||
        details.querySelector(":scope > summary") !== element
      )
        return false;
    }
    const closedDetails = element.closest("details:not([open])");
    if (closedDetails !== null) {
      const summary = closedDetails.querySelector(":scope > summary");
      if (summary === null || !summary.contains(element)) return false;
    }
    return element instanceof HTMLAreaElement
      ? isRenderedArea(element)
      : isRendered(element);
  };
  const tabbableElements = (frame) =>
    Array.from(
      frame.querySelectorAll(
        'details > summary,a[href],area[href],button,input,select,textarea,iframe,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"])',
      ),
    )
      .filter(isTabbable)
      .map((element, index) => ({ element, index, tabIndex: element.tabIndex }))
      .sort((left, right) => {
        if (left.tabIndex === right.tabIndex) return left.index - right.index;
        if (left.tabIndex === 0) return 1;
        if (right.tabIndex === 0) return -1;
        return left.tabIndex - right.tabIndex;
      })
      .map((entry) => entry.element);
  const setMaximized = (frame, maximized) => {
    const trigger = frame.querySelector("[data-figure-maximize]");
    if (maximized) {
      dialogAttributes = {
        frame,
        role: frame.getAttribute("role"),
        ariaModal: frame.getAttribute("aria-modal"),
        ariaLabel: frame.getAttribute("aria-label"),
      };
      frame.setAttribute("data-figure-maximized", "");
      frame.setAttribute("role", "dialog");
      frame.setAttribute("aria-modal", "true");
      frame.setAttribute("aria-label", "Maximized " + subjectOf(frame));
      isolate(frame);
    } else {
      frame.removeAttribute("data-figure-maximized");
      restoreIsolation();
      if (dialogAttributes?.frame === frame) {
        restoreAttribute(frame, "role", dialogAttributes.role);
        restoreAttribute(frame, "aria-modal", dialogAttributes.ariaModal);
        restoreAttribute(frame, "aria-label", dialogAttributes.ariaLabel);
        dialogAttributes = null;
      }
    }
    open = maximized ? frame : null;
    // The backdrop lives on the root so no ancestor of the figure can clip it.
    document.documentElement.toggleAttribute(
      "data-figure-maximized-open",
      open !== null,
    );
    if (trigger === null) return;
    const grow = trigger.querySelector("[data-lucide=maximize-2]");
    const shrink = trigger.querySelector("[data-lucide=minimize-2]");
    // SVGElement does not reflect a hidden property into markup the way an
    // HTMLElement does, so toggle the actual attribute both glyphs ship with.
    if (grow !== null) grow.toggleAttribute("hidden", maximized);
    if (shrink !== null) shrink.toggleAttribute("hidden", !maximized);
    const label = maximized
      ? "Restore " + subjectOf(frame) + " size"
      : "Maximize " + subjectOf(frame);
    trigger.setAttribute("aria-label", label);
    trigger.setAttribute("data-tooltip", label);
  };
  const finishRestore = (frame, keyboard, returnFocus) => {
    setMaximized(frame, false);
    if (returnFocus) {
      const trigger = frame.querySelector("[data-figure-maximize]");
      if (trigger !== null) {
        // A diagram is already its own keyboard entry point. Returning there
        // keeps Escape from highlighting a toolbar action the reader did not
        // ask to use again; other figure families retain trigger restoration.
        const diagramTarget = frame.matches("[data-flow-diagram]");
        const target = diagramTarget ? frame : trigger;
        // A restored diagram is deliberately quiet for every modality. It
        // keeps keyboard position without repainting the whole canvas as a
        // selected object.
        target.focus({ focusVisible: diagramTarget ? false : keyboard });
        // Install the fallback after focus: focusing fires blur on the old
        // trigger, and the shared cleanup listener spends quiet markers on
        // blur by design.
        if (diagramTarget || !keyboard) {
          target.setAttribute("data-figure-focus-quiet", "");
        }
      }
    }
    // Component-specific interaction state clears only after focus has
    // settled, so a focusin handler cannot immediately select it again.
    frame.dispatchEvent(new CustomEvent("figure-restored"));
  };
  for (const frame of frames) {
    const trigger = frame.querySelector("[data-figure-maximize]");
    if (trigger === null) continue;
    trigger.hidden = false;
    trigger.addEventListener("click", (event) => {
      // A click synthesised by Enter or Space carries detail 0; a pointer
      // click carries a click count. That is the activation modality, and it
      // decides whether the restored focus is visible.
      openedByKeyboard = event.detail === 0;
      const maximized = frame.hasAttribute("data-figure-maximized");
      if (maximized) {
        if (!requestRestore(frame)) return;
        finishRestore(frame, openedByKeyboard, false);
        return;
      }
      // Only one figure occupies the viewport at a time; promoting a second
      // one restores the first rather than stacking two fixed panels. That is
      // still an exit attempt, so component-owned unsaved state may block it.
      if (open !== null && open !== frame) {
        if (!requestRestore(open)) return;
        finishRestore(open, false, false);
      }
      setMaximized(frame, true);
    });
    frame.addEventListener("figure-restore-confirmed", () => {
      if (!frame.hasAttribute("data-figure-maximized")) return;
      finishRestore(frame, openedByKeyboard, true);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && open !== null) {
      const tabbable = tabbableElements(open);
      if (tabbable.length !== 0) {
        const current = document.activeElement;
        const currentIndex = tabbable.indexOf(current);
        const outside = currentIndex === -1;
        const atStart = currentIndex === 0;
        const atEnd = currentIndex === tabbable.length - 1;
        if (outside || (event.shiftKey && atStart) || (!event.shiftKey && atEnd)) {
          event.preventDefault();
          const target = event.shiftKey
            ? tabbable[tabbable.length - 1]
            : tabbable[0];
          target.focus();
        }
      }
      return;
    }
    if (
      event.key !== "Escape" ||
      event.bigPlanEscapeHandled === true ||
      open === null
    )
      return;
    const frame = open;
    const keyboard = openedByKeyboard;
    if (!requestRestore(frame)) return;
    // Focus returns to the control the reader pressed, so Escape lands them
    // where they were rather than at the top of the document. It returns
    // quietly after a pointer-opened panel: a mouse user who never saw a ring
    // should not be handed one, and the tooltip keys off :focus-visible too,
    // so one decision settles both.
    finishRestore(frame, keyboard, true);
  });
  // focusVisible is not honoured everywhere; the attribute is the fallback and
  // is spent the moment the reader does anything else.
  for (const type of ["keydown", "pointerdown", "blur"]) {
    document.addEventListener(
      type,
      (event) => {
        // This same Escape may just have installed the quiet-restoration
        // marker. Leave it for the next interaction to spend.
        if (event.type === "keydown" && event.key === "Escape") return;
        for (const quiet of document.querySelectorAll(
          "[data-figure-focus-quiet]",
        )) {
          quiet.removeAttribute("data-figure-focus-quiet");
        }
      },
      true,
    );
  }
})();
(() => {
  // Decision matrices. Native radios already own picking an option and the
  // selected column header, so this leg adds only what markup cannot express:
  // highlighting the whole column, swapping the rationale panel without
  // moving the page, gating the confirm action, and the answered state.
  for (const decision of document.querySelectorAll("[data-decision]")) {
    // A Decision may sit inside another Decision's context, so every lookup
    // is scoped to the nearest owning card. Without this an outer Decision
    // binds the inner one's controls and the two corrupt each other.
    const mine = (node) =>
      node !== null && node.closest("[data-decision]") === decision;
    const ownAll = (selector) =>
      Array.from(decision.querySelectorAll(selector)).filter(mine);
    const own = (selector) => ownAll(selector)[0] || null;

    const confirm = own("[data-decision-confirm]");
    const change = own("[data-decision-change]");
    const footer = own("[data-decision-footer]");
    const answer = own("[data-decision-answer]");
    const answerTitle = own("[data-decision-answer-title]");
    const answerLead = own("[data-decision-answer-lead]");
    const summary = own("[data-decision-selection-summary]");
    const rationale = own("[data-decision-rationale]");
    const question = own("[data-decision-question]");
    const proposalText = own("[data-decision-proposal-text]");
    const proposalCancel = own("[data-decision-proposal-cancel]");
    const proposalLink = own(".decision-propose-link");
    const propose = own("[data-option-proposal]");
    const choices = ownAll("[data-decision-choice]");
    const panels = ownAll("[data-rationale-panel]");
    const cells = ownAll("[data-decision-column]");
    const columnHeaders = ownAll(".decision-column");
    const compareZones = ownAll("[data-decision-compare]");
    const explainZone = own("[data-decision-explain]");
    const weighting = own("[data-decision-weighting]");
    const picked = () => choices.find((choice) => choice.checked) || null;
    const proposes = (choice) =>
      choice instanceof Element &&
      choice.hasAttribute("data-decision-proposal-choice");
    const proposalValue = () =>
      proposalText === null ? "" : proposalText.value.trim();
    let previousOptionChoice =
      choices.find((choice) => choice.checked && !proposes(choice)) || null;

    // Overlapping the panels freezes the region at the tallest one, so from
    // here on swapping the visible panel cannot move anything below it.
    const defaultIndex =
      rationale === null ? "0" : rationale.getAttribute("data-default-index");
    if (rationale !== null) {
      rationale.setAttribute("data-rationale-live", "");
      for (const panel of panels) {
        if (panel.getAttribute("data-option-index") === defaultIndex) {
          panel.setAttribute("data-rationale-shown", "");
        } else {
          panel.removeAttribute("data-rationale-shown");
        }
      }
    }

    // Weighted analysis follows DecisionAnalysis's direct-manipulation
    // treatment: priority squares live below criteria, star ratings keep
    // option scores compact, and the optional arithmetic matrix stays in sync.
    if (weighting !== null) {
      const weightGroups = Array.from(
        weighting.querySelectorAll("[data-decision-weight-group]"),
      );
      const scoreGroups = Array.from(
        weighting.querySelectorAll("[data-decision-score-group]"),
      );
      const compositeRows = Array.from(
        weighting.querySelectorAll("[data-decision-composite]"),
      );
      const calculationWeights = Array.from(
        weighting.querySelectorAll("[data-decision-calculation-weight]"),
      );
      const contributions = Array.from(
        weighting.querySelectorAll("[data-decision-contribution]"),
      );
      const maxTotals = Array.from(
        weighting.querySelectorAll("[data-decision-max-total]"),
      );
      const syncScoring = () => {
        const weights = weightGroups.map((group) =>
          Number(group.getAttribute("data-decision-weight-value") || "0"),
        );
        const scoresByOption = new Map();
        for (const group of scoreGroups) {
          const optionIndex = group.getAttribute("data-option-index") || "0";
          const criterionIndex = Number(
            group.getAttribute("data-criterion-index") || "0",
          );
          const scores = scoresByOption.get(optionIndex) || [];
          scores[criterionIndex] = Number(
            group.getAttribute("data-decision-score-value") || "0",
          );
          scoresByOption.set(optionIndex, scores);
        }
        const denominator = weights.reduce(
          (sum, weight) => sum + weight * 5,
          0,
        );
        for (const node of calculationWeights) {
          const criterionIndex = Number(
            node.getAttribute("data-criterion-index") || "0",
          );
          node.textContent = String(weights[criterionIndex] || 0);
        }
        for (const node of maxTotals) {
          node.textContent = String(denominator) + " max";
        }
        for (const cell of contributions) {
          const optionIndex = cell.getAttribute("data-option-index") || "0";
          const criterionIndex = Number(
            cell.getAttribute("data-criterion-index") || "0",
          );
          const weight = weights[criterionIndex] || 0;
          const score =
            scoresByOption.get(optionIndex)?.[criterionIndex] || 0;
          cell.textContent =
            String(weight) +
            " × " +
            String(score) +
            " = " +
            String(weight * score);
        }
        for (const row of compositeRows) {
          const optionIndex = row.getAttribute("data-option-index") || "0";
          const scores =
            scoresByOption.get(optionIndex) ||
            (row.getAttribute("data-score-values") || "").split(",").map(Number);
          const numerator = weights.reduce(
            (sum, weight, index) => sum + weight * (scores[index] || 0),
            0,
          );
          const percent =
            denominator === 0
              ? 0
              : Math.round((numerator / denominator) * 100);
          const numeratorNode = row.querySelector(
            "[data-decision-numerator]",
          );
          const denominatorNode = row.querySelector(
            "[data-decision-denominator]",
          );
          const percentNode = row.querySelector("[data-decision-percent]");
          if (numeratorNode !== null) {
            numeratorNode.textContent = String(numerator);
          }
          if (denominatorNode !== null) {
            denominatorNode.textContent = String(denominator);
          }
          if (percentNode !== null) {
            percentNode.textContent = String(percent) + "%";
          }
        }
      };
      const applyWeight = (group, value) => {
        group.setAttribute("data-decision-weight-value", String(value));
        const output = group.querySelector("[data-decision-weight-output]");
        if (output !== null) output.textContent = String(value) + "/5";
        for (const step of group.querySelectorAll("[data-decision-weight]")) {
          const stepValue = Number(step.getAttribute("data-weight-value"));
          step.setAttribute(
            "aria-checked",
            stepValue === value ? "true" : "false",
          );
          step.tabIndex = stepValue === value ? 0 : -1;
          if (stepValue <= value) step.setAttribute("data-weight-filled", "");
          else step.removeAttribute("data-weight-filled");
        }
        syncScoring();
      };
      const applyScore = (group, value) => {
        group.setAttribute("data-decision-score-value", String(value));
        const output = group.querySelector("[data-decision-score-output]");
        if (output !== null) output.textContent = String(value) + "/5";
        for (const star of group.querySelectorAll("[data-decision-score]")) {
          const starValue = Number(star.getAttribute("data-score-value"));
          star.setAttribute(
            "aria-checked",
            starValue === value ? "true" : "false",
          );
          star.tabIndex = starValue === value ? 0 : -1;
          if (starValue <= value) star.setAttribute("data-score-filled", "");
          else star.removeAttribute("data-score-filled");
        }
        syncScoring();
      };
      for (const group of weightGroups) {
        for (const step of group.querySelectorAll("[data-decision-weight]")) {
          step.addEventListener("click", () => {
            applyWeight(group, Number(step.getAttribute("data-weight-value")));
          });
          step.addEventListener("keydown", (event) => {
            const current = Number(
              group.getAttribute("data-decision-weight-value") || "1",
            );
            const next =
              event.key === "ArrowRight" || event.key === "ArrowUp"
                ? Math.min(5, current + 1)
                : event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? Math.max(1, current - 1)
                  : event.key === "Home"
                    ? 1
                    : event.key === "End"
                      ? 5
                      : null;
            if (next === null) return;
            event.preventDefault();
            applyWeight(group, next);
            group
              .querySelector('[data-weight-value="' + String(next) + '"]')
              ?.focus();
          });
        }
      }
      for (const group of scoreGroups) {
        for (const star of group.querySelectorAll("[data-decision-score]")) {
          star.addEventListener("click", () => {
            applyScore(group, Number(star.getAttribute("data-score-value")));
          });
          star.addEventListener("keydown", (event) => {
            const current = Number(
              group.getAttribute("data-decision-score-value") || "1",
            );
            const next =
              event.key === "ArrowRight" || event.key === "ArrowUp"
                ? Math.min(5, current + 1)
                : event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? Math.max(1, current - 1)
                  : event.key === "Home"
                    ? 1
                    : event.key === "End"
                      ? 5
                      : null;
            if (next === null) return;
            event.preventDefault();
            applyScore(group, next);
            group
              .querySelector('[data-score-value="' + String(next) + '"]')
              ?.focus();
          });
        }
      }
      syncScoring();
    }
    if (confirm === null || change === null || answer === null) continue;

    const showPanel = (index) => {
      for (const panel of panels) {
        const shown = panel.getAttribute("data-option-index") === index;
        if (shown) panel.setAttribute("data-rationale-shown", "");
        else panel.removeAttribute("data-rationale-shown");
      }
    };
    const paintColumn = (index, settled) => {
      for (const cell of cells) {
        const on = index !== null && cell.getAttribute("data-decision-column") === index;
        if (on) cell.setAttribute("data-column-selected", "");
        else cell.removeAttribute("data-column-selected");
        if (on && settled) cell.setAttribute("data-column-settled", "");
        else cell.removeAttribute("data-column-settled");
      }
    };
    const sync = () => {
      const choice = picked();
      const proposing = proposes(choice);
      const index = choice === null ? null : choice.getAttribute("data-option-index");
      showPanel(index === null ? defaultIndex : index);
      paintColumn(index, false);
      confirm.textContent = proposing ? "Submit proposal" : "Confirm choice";
      confirm.disabled =
        choice === null || (proposing && proposalValue() === "");
      if (summary !== null) {
        summary.textContent =
          choice === null
            ? "Nothing selected yet."
            : proposing
              ? "Your own approach selected."
              : choice.value + " selected.";
      }
    };
    decision.addEventListener("change", (event) => {
      if (!mine(event.target)) return;
      if (!proposes(event.target) && event.target.checked) {
        previousOptionChoice = event.target;
      }
      sync();
      if (proposes(event.target) && proposalText !== null) proposalText.focus();
    });
    if (proposalText !== null) proposalText.addEventListener("input", sync);
    if (proposalCancel !== null) {
      proposalCancel.addEventListener("click", () => {
        const proposalChoice = choices.find(proposes) || null;
        if (proposalChoice !== null) proposalChoice.checked = false;
        if (previousOptionChoice !== null) previousOptionChoice.checked = true;
        if (proposalText !== null) proposalText.value = "";
        sync();
        if (proposalLink !== null) proposalLink.focus();
      });
    }

    const compress = (answered) => {
      if (footer !== null) footer.hidden = answered;
      answer.hidden = !answered;
      const choice = picked();
      const proposing = proposes(choice);
      const index =
        choice === null ? null : choice.getAttribute("data-option-index");
      // A proposal is not one of the columns, so compressing to it means
      // retiring the comparison entirely and leaving the reader's own words
      // standing. Hiding columns by index would strand the criterion labels
      // beside an unrelated rationale.
      const retireComparison = answered && proposing;
      for (const zone of compareZones) zone.hidden = retireComparison;
      if (explainZone !== null) explainZone.hidden = retireComparison;
      // The propose block carries the recorded proposal, so it survives a
      // proposal answer and only retires when a column won.
      if (propose !== null) propose.hidden = answered && !proposing;
      // Answering with a column drops the ones the reader turned down, so the
      // record reads as one option against the criteria, not a live matrix.
      for (const cell of cells) {
        const kept = cell.getAttribute("data-decision-column") === index;
        cell.hidden = answered && !proposing && !kept;
      }
      for (const header of columnHeaders) {
        if (answered && !proposing && header.getAttribute("data-decision-column") === index) {
          header.setAttribute("data-option-chosen", "");
        } else if (answered) {
          header.removeAttribute("data-option-chosen");
        }
      }
      paintColumn(proposing ? null : index, answered);
    };

    confirm.addEventListener("click", () => {
      const choice = picked();
      if (choice === null || confirm.disabled) return;
      const proposing = proposes(choice);
      if (answerLead !== null) {
        answerLead.textContent = proposing
          ? "Proposal recorded"
          : "Answer recorded";
      }
      if (answerTitle !== null) {
        answerTitle.textContent =
          ": " + (proposing ? proposalValue() : choice.value);
      }
      if (proposalText !== null) proposalText.readOnly = proposing;
      decision.setAttribute("data-decision-answered", "");
      compress(true);
       // Announce and queue the reading-session answer for an embedding host.
      const record = {
        decision: decision.id,
        question: question === null ? "" : question.textContent,
        option: choice.value,
        proposal: proposing ? proposalValue() : "",
      };
      window.bigPlanDecisionAnswers = window.bigPlanDecisionAnswers || [];
      window.bigPlanDecisionAnswers.push(record);
      document.dispatchEvent(
        new CustomEvent("bigplan:decision-answered", { detail: record }),
      );
      change.focus();
    });
    change.addEventListener("click", () => {
      decision.removeAttribute("data-decision-answered");
      for (const header of columnHeaders) {
        header.removeAttribute("data-option-chosen");
      }
      compress(false);
      if (proposalText !== null) proposalText.readOnly = false;
      sync();
      const choice = picked();
      if (choice !== null) choice.focus();
    });
    sync();
  }
})();
${DIAGRAM_SCRIPT}
</script>`;
