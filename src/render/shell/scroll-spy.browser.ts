// The viewer's scroll-spy, authored as real TypeScript so the compiler and
// lint can validate the browser behavior. scripts/gen-browser-scripts.mjs
// type-checks this file against tsconfig.browser.json, strips the types, and
// embeds the result as scroll-spy.generated.ts for the shell to inline. The
// .browser.ts suffix marks code that runs in the viewer, not in Node.
// Progressive enhancement only: it synchronizes both TOCs and closes the
// mobile disclosure after navigation; the document still reads fine without
// it. This file is a script, not a module - no imports or exports - so the
// emitted output can be inlined directly into a <script> tag.

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
  const overviewLink = document.querySelector<HTMLAnchorElement>(
    "[data-overview-link]",
  );

  // Keeps both navigation variants in sync.
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
  };

  let queued = false;
  const update = (): void => {
    queued = false;
    // A short final section may never lift its heading past the threshold
    // because the page runs out of scroll first, so reaching the bottom of a
    // scrollable document always marks the last section current.
    const scrollBottom = window.innerHeight + window.scrollY;
    const pageHeight = document.documentElement.scrollHeight;
    if (pageHeight > window.innerHeight && scrollBottom >= pageHeight - 2) {
      setActive(headings[headings.length - 1]?.id);
      return;
    }
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
    if (target instanceof Element && target.closest("a") !== null) {
      mobileDetails.removeAttribute("open");
      window.setTimeout(() => mobileDetails.querySelector("summary")?.focus());
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
