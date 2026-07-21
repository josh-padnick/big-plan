// Owns HttpEndpoint's experimental tabbed section navigation. The server
// renders every section stacked - that stacked card IS the no-JavaScript
// document - and this enhancement folds a card's sections behind a tab bar
// so a reader can move between the contract's facets without scrolling
// through all of them.

const TAB_DEFINITIONS: ReadonlyArray<readonly [string, string]> = [
  ["path-params", "Path"],
  ["query-params", "Query"],
  ["header-params", "Headers"],
  ["request-body", "Body"],
  ["responses", "Responses"],
  ["review", "Review"],
];

const TAB_ORDER = new Map(
  TAB_DEFINITIONS.map(([kind], index) => [kind, index]),
);
const TAB_LABELS = new Map(TAB_DEFINITIONS);

let nextPanelId = 1;

// A section's identity: the renderer stamps data-http-section on its own
// sections, while the shared review checklist announces itself through its
// inner data hook.
const sectionKind = (section: HTMLElement): string | undefined =>
  section.dataset.httpSection ??
  (section.querySelector("[data-review-checklist]") !== null
    ? "review"
    : undefined);

// The muted count beside a tab label: definition entries for parameter-ish
// panels, response rows for the responses panel.
const sectionCount = ({
  section,
  kind,
}: {
  readonly section: HTMLElement;
  readonly kind: string;
}): number => {
  if (kind === "responses") {
    return section.querySelectorAll("[data-http-response]").length;
  }
  if (kind === "review") {
    return 0;
  }
  return section.querySelectorAll("dt").length;
};

for (const card of document.querySelectorAll<HTMLElement>(
  "[data-http-endpoint]",
)) {
  const sections = [...card.querySelectorAll<HTMLElement>(":scope > section")]
    .map((section) => {
      const kind = sectionKind(section);
      return kind === undefined ? undefined : { section, kind };
    })
    .filter((entry) => entry !== undefined)
    .sort(
      (left, right) =>
        (TAB_ORDER.get(left.kind) ?? 99) - (TAB_ORDER.get(right.kind) ?? 99),
    );
  // One section reads better stacked than behind a single lonely tab.
  if (sections.length < 2) {
    continue;
  }

  const bar = document.createElement("div");
  bar.className =
    "http-endpoint-tabs flex flex-wrap items-center gap-1 border-t border-edge px-2";
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Endpoint contract sections");

  const tabs: Array<HTMLButtonElement> = [];
  const activate = (index: number): void => {
    for (const [position, entry] of sections.entries()) {
      const tab = tabs[position];
      const active = position === index;
      entry.section.hidden = !active;
      if (tab !== undefined) {
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
      }
    }
  };

  for (const [index, entry] of sections.entries()) {
    const panelId = `http-endpoint-panel-${nextPanelId}`;
    nextPanelId += 1;
    entry.section.id = panelId;
    entry.section.setAttribute("role", "tabpanel");
    // The selected tab already names the panel, so the in-panel label (and
    // the review checklist's icon row) would say it twice; the stacked
    // no-JavaScript document keeps them as its only headings.
    const reviewRow = entry.section.querySelector<HTMLElement>(
      "[data-review-checklist]",
    );
    const label = entry.section.querySelector<HTMLElement>(
      ".card-section-label",
    );
    (reviewRow ?? label)?.setAttribute("hidden", "");

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className =
      "http-endpoint-tab cursor-pointer border-0 bg-transparent px-2.5 py-2 font-sans text-xs font-semibold";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    tab.append(TAB_LABELS.get(entry.kind) ?? entry.kind);
    const count = sectionCount(entry);
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "http-endpoint-tab-count ml-1.5 text-muted";
      badge.textContent = String(count);
      tab.append(badge);
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

  const firstEntry = sections[0];
  if (firstEntry !== undefined) {
    card.insertBefore(bar, firstEntry.section);
  }
  card.dataset.httpTabbed = "";
  activate(0);
}
