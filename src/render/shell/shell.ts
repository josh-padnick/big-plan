// Owns the review shell: the reading surface a rendered document lives in -
// the layout grid, the sticky TOC with its scroll-spy enhancement, and the
// content region. It produces body-level markup plus the styles and scripts
// that markup needs, as data; packaging into a complete document is page.ts's
// job. Authored markup is styled with Tailwind utilities; the compiled
// stylesheet (including the element-scoped prose styles from global.css) comes
// from the generated GLOBAL_CSS module.

import { escapeHtml } from "../escape-html.js";
import { GLOBAL_CSS } from "../global.generated.js";
import { SCROLL_SPY_JS } from "./scroll-spy.generated.js";

// The shell's own navigation contract: plain text in, so the shell owes
// nothing to whatever produced the document. Callers map their outline
// (markdown sections today, typed-plan sections later) into this shape.
export type NavEntry = {
  readonly id: string;
  readonly label: string;
};

export type ShellResult = {
  readonly html: string;
  readonly styles: string;
  readonly scripts: ReadonlyArray<string>;
  readonly bodyClassName: string;
};

// TEMPORARY (accent review): five candidate light-mode accent schemes and a
// fixed picker so the reviewer can compare them in place. The whole block -
// schemes, markup, and script - is deleted once a scheme is chosen.
const ACCENT_SCHEMES = [
  { name: "Rust (current)", value: "#99502d" },
  { name: "Iris", value: "#5d52c7" },
  { name: "Teal", value: "#0f766e" },
  { name: "Cobalt", value: "#1d4ed8" },
  { name: "Forest", value: "#166534" },
] as const;

const SWITCHER_HTML = `<div id="accent-switcher" style="position:fixed;right:1rem;bottom:1rem;z-index:10;padding:0.6rem 0.75rem;border:1px solid #d6d1c6;border-radius:0.6rem;background:#fffdf8;box-shadow:0 8px 24px rgba(40,36,30,0.12);font-size:0.75rem;color:#57534d;">
<div style="font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-size:0.65rem;margin-bottom:0.45rem;">Accent scheme (temporary)</div>
${ACCENT_SCHEMES.map(
  (scheme, index) =>
    `<button type="button" data-accent="${scheme.value}" style="display:flex;align-items:center;gap:0.5rem;width:100%;padding:0.3rem 0.4rem;margin:0;border:0;border-radius:0.4rem;background:${index === 0 ? "#f0ece3" : "transparent"};cursor:pointer;font:inherit;color:inherit;text-align:left;"><span style="width:0.85rem;height:0.85rem;border-radius:999px;background:${scheme.value};display:inline-block;"></span>${scheme.name}</button>`,
).join("\n")}
</div>`;

const SWITCHER_JS = `
(() => {
  const switcher = document.getElementById('accent-switcher');
  if (!switcher) return;
  const buttons = Array.from(switcher.querySelectorAll('button[data-accent]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const accent = button.getAttribute('data-accent');
      if (accent) document.documentElement.style.setProperty('--accent-c', accent);
      for (const other of buttons) other.style.background = other === button ? '#f0ece3' : 'transparent';
    });
  }
})();
`;

const BODY_CLASSES =
  "bg-paper font-sans text-base leading-[1.65] text-ink antialiased";

// Stacked reading layout below the wide breakpoint; sidebar plus one reading
// column (~70ch) above it. The no-TOC variant is always a single column.
const LAYOUT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] justify-center gap-8 px-5 pt-8 pb-16 wide:gap-14 wide:px-6 wide:pt-12 wide:pb-20";
const LAYOUT_WITH_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[14rem_minmax(0,70ch)]`;
const LAYOUT_WITHOUT_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[minmax(0,70ch)]`;

const TOC_LINK_CLASSES =
  "block border-l-2 border-edge px-3 py-[0.3rem] text-muted hover:text-ink aria-[current=true]:border-accent aria-[current=true]:font-semibold aria-[current=true]:text-accent";

// Builds the sidebar nav; ids are URI-encoded because slugs may contain
// characters that are not literal-safe inside href values.
const renderToc = (nav: ReadonlyArray<NavEntry>): string => {
  const items = nav
    .map(
      (entry) =>
        `<li><a class="${TOC_LINK_CLASSES}" href="#${encodeURIComponent(entry.id)}">${escapeHtml(entry.label)}</a></li>`,
    )
    .join("\n");
  return `<nav class="border-b border-edge pb-6 text-sm leading-normal wide:sticky wide:top-12 wide:self-start wide:border-b-0 wide:pb-0" aria-label="Contents">
<p class="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Contents</p>
<ol>
${items}
</ol>
</nav>`;
};

/**
 * Wraps rendered content in the review shell: the layout grid, a sticky TOC
 * when nav entries exist, and the scroll-spy script. Returns markup plus the
 * styles and scripts it needs; the caller packages them into a page.
 */
export const renderShell = ({
  nav,
  contentHtml,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly contentHtml: string;
}): ShellResult => {
  const hasToc = nav.length > 0;
  const html = `<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}">
${hasToc ? renderToc(nav) : ""}
<main class="min-w-0">
<article>
${contentHtml}
</article>
</main>
</div>
${hasToc ? SWITCHER_HTML : ""}`;
  return {
    html,
    styles: GLOBAL_CSS,
    scripts: hasToc ? [`${SCROLL_SPY_JS}\n${SWITCHER_JS}`] : [],
    bodyClassName: BODY_CLASSES,
  };
};
