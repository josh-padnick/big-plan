// The viewer's scroll-spy, authored as real TypeScript so the compiler and
// lint see the only behavioral JavaScript we ship. scripts/gen-scroll-spy.mjs
// type-checks this file against tsconfig.browser.json, strips the types, and
// embeds the result as scroll-spy.generated.ts for the shell to inline.
// Progressive enhancement only: the document reads fine without it. This file
// is a script, not a module - no imports or exports - so the emitted output
// can be inlined directly into a <script> tag.

(() => {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'nav[aria-label="Contents"] a[href^="#"]',
    ),
  );
  const headings = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter((heading): heading is HTMLElement => heading !== null);
  if (headings.length === 0) {
    return;
  }

  const setActive = (id: string): void => {
    for (const link of links) {
      if (decodeURIComponent(link.hash.slice(1)) === id) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  };

  let queued = false;
  const update = (): void => {
    queued = false;
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 96) {
        current = heading;
      } else {
        break;
      }
    }
    if (current !== undefined) {
      setActive(current.id);
    }
  };

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
