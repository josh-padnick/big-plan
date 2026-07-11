// The viewer's scroll-spy, authored as real TypeScript so the compiler and
// lint can validate the browser behavior. scripts/gen-browser-scripts.mjs
// type-checks this file against tsconfig.browser.json, strips the types, and
// embeds the result as scroll-spy.generated.ts for the shell to inline. The
// .browser.ts suffix marks code that runs in the viewer, not in Node.
// Progressive enhancement only: it synchronizes both TOCs, updates the mobile
// current-section summary, and closes the mobile disclosure after navigation;
// the document still reads fine without it. This file is a script, not a
// module - no imports or exports - so the emitted output can be inlined
// directly into a <script> tag.

(() => {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'nav[aria-label="Contents"] a[data-section-link]',
    ),
  );
  const headings = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter((heading): heading is HTMLElement => heading !== null);
  if (headings.length === 0) {
    return;
  }

  const mobileToc = document.querySelector<HTMLElement>("[data-mobile-toc]");
  const currentSection = document.querySelector<HTMLElement>(
    "[data-current-section]",
  );
  const overviewLink = document.querySelector<HTMLAnchorElement>(
    "[data-overview-link]",
  );

  // Keeps both navigation variants and the mobile summary in sync.
  const setActive = (id: string | undefined): void => {
    for (const link of links) {
      if (decodeURIComponent(link.hash.slice(1)) === id) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    }
    if (overviewLink !== null) {
      if (id === undefined) {
        overviewLink.setAttribute("aria-current", "true");
      } else {
        overviewLink.removeAttribute("aria-current");
      }
    }
    if (currentSection !== null) {
      const activeLink = links.find(
        (link) => decodeURIComponent(link.hash.slice(1)) === id,
      );
      currentSection.textContent = activeLink?.textContent.trim() ?? "Overview";
    }
  };

  let queued = false;
  const update = (): void => {
    queued = false;
    const mobileTocBottom = mobileToc?.getBoundingClientRect().bottom ?? 0;
    // The extra breathing room matches the mobile target scroll margin, so a
    // section becomes current as soon as its anchored heading settles in view.
    const threshold = mobileTocBottom > 0 ? mobileTocBottom + 32 : 96;
    let current: HTMLElement | undefined;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= threshold) {
        current = heading;
      } else {
        break;
      }
    }
    setActive(current?.id);
  };

  const mobileDetails = mobileToc?.querySelector("details");
  mobileDetails?.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLAnchorElement) {
      mobileDetails.removeAttribute("open");
    }
  });

  document.addEventListener(
    "scroll",
    () => {
      if (queued) {
        return;
      }
      queued = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  update();
})();
