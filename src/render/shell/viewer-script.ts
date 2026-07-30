// The one script a rendered document ships, carrying the viewer enhancements:
// a scroll-spy that marks the section being read with aria-current on its TOC
// links (falling back to the overview links above the first section), hover
// popovers that float [data-info-popover] disclosures beside their triggers,
// and collapse toggles for deck parts, slides, and sub-slides. Plan content
// never contributes script, and every affordance keeps a no-JS fallback.
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
  if (headings.length === 0) return;
  const apply = () => {
    const readingLine = window.innerHeight * 0.25;
    let current = null;
    for (const heading of headings) {
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
  const docKey =
    document.documentElement.getAttribute("data-plan-id") ||
    document.title ||
    location.pathname;
  const storageKey = (id) => "big-plan:collapse:" + docKey + ":" + id;
  const toggleFor = (block) => {
    const chrome = block.querySelector(
      ":scope > [data-collapse-chrome], :scope > [data-part]",
    );
    return chrome
      ? chrome.querySelector("[data-collapse-toggle]")
      : block.querySelector(":scope > [data-collapse-toggle]");
  };
  const setCollapsed = (block, collapsed) => {
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
    if (id === null || id === "") return;
    try {
      localStorage.setItem(storageKey(id), collapsed ? "1" : "0");
    } catch (_) {}
  };
  for (const block of blocks) {
    const id = block.getAttribute("data-collapse-id");
    if (id !== null && id !== "") {
      try {
        if (localStorage.getItem(storageKey(id)) === "1") {
          setCollapsed(block, true);
        }
      } catch (_) {}
    }
    const button = toggleFor(block);
    if (button === null) continue;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setCollapsed(block, !block.hasAttribute("data-collapsed"));
    });
  }
  const expandAncestors = (target) => {
    let node = target;
    while (node instanceof Element) {
      if (
        node.hasAttribute("data-collapsible") &&
        node.hasAttribute("data-collapsed")
      ) {
        setCollapsed(node, false);
      }
      node = node.parentElement;
    }
  };
  const expandHash = (hash) => {
    if (!hash || hash === "#") return;
    const id = decodeURIComponent(hash.slice(1));
    if (id === "") return;
    const target = document.getElementById(id);
    if (target === null) return;
    expandAncestors(target);
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
    expandHash(location.hash);
  });
})();
</script>`;
