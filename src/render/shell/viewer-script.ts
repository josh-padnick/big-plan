// The one script a rendered document ships, carrying the viewer enhancements:
// a scroll-spy that marks the section being read with aria-current on its TOC
// links (falling back to the overview links above the first section), hover
// popovers that float [data-info-popover] disclosures beside their triggers,
// and collapse toggles for deck parts, slides, and sub-slides. Plan content
// never contributes script, and every affordance keeps a no-JS fallback.
//
// The collapse leg reads the DOM contract owned by markdown/deck-collapse.ts:
// one header per collapsible, holding chrome only, with the body as its
// sibling. Every collapse query here is a direct-child lookup relying on that
// shape, so read those invariants before changing this or the deck transform.
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
      if (!info.matches(":focus-within")) close();
    });
    summary.addEventListener("focus", () => {
      if (summary.matches(":focus-visible")) open();
    });
    info.addEventListener("focusout", (event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !info.contains(event.relatedTarget)
      )
        close();
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (info.open) close();
      else open();
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
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
  const blocks = Array.from(document.querySelectorAll("[data-collapsible]"));
  if (blocks.length === 0) return;
  const planId = document.documentElement.getAttribute("data-plan-id");
  const docKey = planId || document.title + ":" + location.pathname;
  const storageKey = (id) => "big-plan:collapse:" + docKey + ":" + id;
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
      try {
        localStorage.setItem(storageKey(id), collapsed ? "1" : "0");
      } catch (_) {}
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
      try {
        if (localStorage.getItem(storageKey(id)) === "1") {
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
</script>`;
