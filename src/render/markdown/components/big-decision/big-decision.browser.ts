// Owns BigDecision's browser enhancements: full-screen viewing, floating
// help (hover tooltips on server-rendered terms, click popovers on script
// chrome), and the priority preview - labeled Low/Medium/High controls per
// criterion that recompute a Best match, explain why, and offer to align the
// reader's selection without ever changing it silently.

import {
  openComponentFullScreen,
  updateFullScreenControl,
} from "../shared/full-screen/full-screen.browser.js";

const EXPAND_LABEL = "View decision full screen";

// Mirrors the expanded state into the figure's dataset and expand control.
const applyDecisionExpandedState = ({
  component,
  expanded,
}: {
  readonly component: HTMLElement;
  readonly expanded: boolean;
}): void => {
  if (expanded) {
    component.dataset.decisionExpanded = "";
  } else {
    delete component.dataset.decisionExpanded;
  }
  const button = component.querySelector<HTMLButtonElement>(
    "[data-decision-expand]",
  );
  if (button !== null) {
    updateFullScreenControl({ button, expanded, expandLabel: EXPAND_LABEL });
  }
};

for (const component of document.querySelectorAll<HTMLElement>(
  "[data-big-decision]",
)) {
  const button = component.querySelector<HTMLButtonElement>(
    "[data-decision-expand]",
  );
  if (button === null) {
    continue;
  }
  button.hidden = false;
  button.addEventListener("click", () => {
    const openDialog = component.closest("dialog");
    if (openDialog !== null) {
      openDialog.close();
      return;
    }
    openComponentFullScreen({
      component,
      labelElement: component.querySelector<HTMLElement>(
        "[data-decision-question]",
      ),
      fallbackLabel: "Decision",
      onToggle: ({ expanded }) =>
        applyDecisionExpandedState({ component, expanded }),
    });
  });
}

// Floats one details element's body at a fixed position beside its summary,
// so help never pushes layout or clips in the matrix scroller. Tooltips also
// open on hover; popovers only on click and keyboard focus.
const enhanceFloatingInfo = ({
  info,
  hover,
}: {
  readonly info: HTMLDetailsElement;
  readonly hover: boolean;
}): void => {
  const summary = info.querySelector<HTMLElement>("summary");
  const body = info.querySelector<HTMLElement>(".big-decision-info-body");
  if (summary === null || body === null) {
    return;
  }
  info.classList.add("big-decision-info-floating");
  body.setAttribute("role", "tooltip");

  const open = (): void => {
    info.open = true;
    const anchor = summary.getBoundingClientRect();
    body.style.left = "0px";
    body.style.top = "0px";
    const size = body.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        anchor.left + anchor.width / 2 - size.width / 2,
        window.innerWidth - size.width - 8,
      ),
    );
    const below = anchor.bottom + 6;
    const top =
      below + size.height > window.innerHeight - 8
        ? Math.max(8, anchor.top - size.height - 6)
        : below;
    body.style.left = `${left}px`;
    body.style.top = `${top}px`;
  };
  const close = (): void => {
    info.open = false;
  };

  if (hover) {
    info.addEventListener("pointerenter", open);
    info.addEventListener("pointerleave", close);
  } else {
    // A click-mode popover also dismisses from anywhere outside it.
    document.addEventListener("pointerdown", (event) => {
      if (
        info.open &&
        event.target instanceof Node &&
        !info.contains(event.target)
      ) {
        close();
      }
    });
  }
  // Only keyboard focus opens; a mouse click also focuses, and letting that
  // open would make the click handler immediately toggle it shut.
  summary.addEventListener("focus", () => {
    if (summary.matches(":focus-visible")) {
      open();
    }
  });
  summary.addEventListener("blur", close);
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    if (info.open) {
      close();
    } else {
      open();
    }
  });
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });
  // Repositioning on scroll keeps the body anchored to its trigger, and
  // avoids racing the browser's own scroll-into-view before a hover.
  window.addEventListener(
    "scroll",
    () => {
      if (info.open) {
        open();
      }
    },
    { passive: true },
  );
};

for (const info of document.querySelectorAll<HTMLElement>(
  "details.big-decision-info",
)) {
  if (info instanceof HTMLDetailsElement) {
    enhanceFloatingInfo({ info, hover: true });
  }
}

// Builds one script-owned popover: a link-styled summary plus a floating
// body, reusing the shared details grammar so styling and dismissal match.
const createPopover = ({
  label,
}: {
  readonly label: string;
}): { readonly details: HTMLDetailsElement; readonly body: HTMLElement } => {
  const details = document.createElement("details");
  details.className = "big-decision-info";
  const summary = document.createElement("summary");
  summary.className = "big-decision-popover-link";
  summary.textContent = label;
  const body = document.createElement("div");
  body.className =
    "big-decision-info-body max-w-60 text-xs font-normal text-muted";
  details.append(summary, body);
  enhanceFloatingInfo({ info: details, hover: false });
  return { details, body };
};

// The priority preview: tones become coarse values, the reader sets a
// labeled priority per criterion, and the footer names the Best match with
// its reasoning - never touching the reader's own selection.
const TONE_VALUES: Readonly<Record<string, number>> = {
  good: 2,
  mixed: 1,
  neutral: 0,
  bad: -2,
};

const PRIORITY_LABELS: ReadonlyArray<string> = ["Low", "Medium", "High"];
const PRIORITY_MAX = PRIORITY_LABELS.length;
const DEFAULT_PRIORITY = 2;

const HOW_RANKING_POINTS: ReadonlyArray<string> = [
  "Each option is scored against every criterion.",
  "Priority controls how strongly a criterion affects the comparison.",
  "Changing priorities updates Best match; it never changes your selection.",
];

const criterionName = (row: HTMLTableRowElement): string => {
  const header = row.querySelector("th");
  return header?.childNodes[0]?.textContent?.trim() || "this criterion";
};

const optionName = (option: HTMLElement): string =>
  option.querySelector("[data-option-title]")?.textContent?.trim() ??
  "this option";

for (const component of document.querySelectorAll<HTMLElement>(
  "[data-big-decision]",
)) {
  if (component.dataset.decisionState === "decided") {
    continue;
  }
  const matrix = component.querySelector<HTMLTableElement>(
    "table.big-decision-matrix",
  );
  if (matrix === null) {
    continue;
  }
  const rows = [...matrix.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  const options = [
    ...matrix.querySelectorAll<HTMLElement>("thead [data-option]"),
  ];
  if (rows.length === 0 || options.length < 2) {
    continue;
  }

  const priorities = rows.map(() => DEFAULT_PRIORITY);
  const resetters: Array<() => void> = [];
  let leaderColumn: number | null = null;

  const contribution = ({
    row,
    index,
    column,
  }: {
    readonly row: HTMLTableRowElement;
    readonly index: number;
    readonly column: number;
  }): number => {
    const cell = row.querySelectorAll("td")[column];
    const tone = cell?.dataset.scoreTone;
    const value = tone === undefined ? 0 : (TONE_VALUES[tone] ?? 0);
    return (priorities[index] ?? 0) * value;
  };

  // The generated reasoning names the winner's strongest weighted criteria
  // instead of exposing scores, which would imply false precision.
  const explainLeader = (column: number): string => {
    const strengths = rows
      .map((row, index) => ({
        title: criterionName(row),
        value: contribution({ row, index, column }),
      }))
      .filter(({ value }) => value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 2)
      .map(({ title }) => title);
    const name = optionName(options[column] ?? document.body);
    if (strengths.length === 0) {
      return `${name} leads narrowly; no criterion currently works strongly in its favor.`;
    }
    const list =
      strengths.length === 1
        ? strengths[0]
        : `${strengths[0]} and ${strengths[1]}`;
    return `${name} performs strongly on ${list} under the current priorities.`;
  };

  // Footer chrome, assembled once and updated on every recompute.
  const footer = document.createElement("div");
  footer.className =
    "big-decision-weights-footer mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted";
  footer.dataset.decisionWeightsFooter = "";
  const bestMatchLine = document.createElement("span");
  bestMatchLine.dataset.decisionBestMatchLine = "";
  const whyPopover = createPopover({ label: "Why?" });
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "big-decision-popover-link";
  resetButton.dataset.decisionWeightsReset = "";
  resetButton.textContent = "Reset priorities";
  resetButton.hidden = true;
  resetButton.addEventListener("click", () => {
    for (const reset of resetters) {
      reset();
    }
  });
  const divergence = document.createElement("span");
  divergence.dataset.decisionDivergence = "";
  divergence.hidden = true;
  const divergenceText = document.createElement("span");
  const divergenceButton = document.createElement("button");
  divergenceButton.type = "button";
  divergenceButton.className = "big-decision-popover-link";
  divergenceButton.addEventListener("click", () => {
    if (leaderColumn !== null) {
      options[leaderColumn]?.click();
    }
  });
  divergence.append(divergenceText, document.createTextNode(" "));
  divergence.append(divergenceButton);
  footer.append(bestMatchLine, whyPopover.details, resetButton, divergence);

  const updateReset = (): void => {
    resetButton.hidden = priorities.every(
      (priority) => priority === DEFAULT_PRIORITY,
    );
  };

  // The reader's own selection stays untouched; when it diverges from the
  // computed leader, the footer offers the switch as an explicit action.
  const updateDivergence = (): void => {
    const selected = options.findIndex(
      (option) => option.dataset.optionSelected !== undefined,
    );
    if (leaderColumn === null || selected === -1 || selected === leaderColumn) {
      divergence.hidden = true;
      return;
    }
    const name = optionName(options[leaderColumn] ?? document.body);
    divergenceText.textContent = `Your priorities now favor ${name}.`;
    divergenceButton.textContent = `Select ${name}`;
    divergence.hidden = false;
  };

  const recompute = (): void => {
    const totals = options.map((_, column) =>
      rows.reduce(
        (sum, row, index) => sum + contribution({ row, index, column }),
        0,
      ),
    );
    const best = Math.max(...totals);
    const leaders = totals.filter((total) => total === best).length;
    leaderColumn = leaders < options.length ? totals.indexOf(best) : null;
    for (const [column, option] of options.entries()) {
      const leads = column === leaderColumn;
      let tag = option.querySelector<HTMLElement>(".big-decision-bestmatch");
      if (leads) {
        option.dataset.bestMatch = "";
        if (tag === null) {
          tag = document.createElement("span");
          tag.className = "big-decision-bestmatch";
          tag.textContent = "Best match";
          option
            .querySelector("[data-option-title]")
            ?.parentElement?.append(tag);
        }
      } else {
        delete option.dataset.bestMatch;
        tag?.remove();
      }
    }
    if (leaderColumn === null) {
      bestMatchLine.textContent =
        "Best match: none yet - the current priorities do not separate the options.";
      whyPopover.details.hidden = true;
    } else {
      const name = optionName(options[leaderColumn] ?? document.body);
      bestMatchLine.replaceChildren();
      const label = document.createElement("span");
      label.className = "font-semibold text-ink";
      label.textContent = `Best match: ${name}`;
      bestMatchLine.append(
        label,
        document.createTextNode(" Based on your current priorities."),
      );
      whyPopover.details.hidden = false;
      whyPopover.body.replaceChildren();
      const heading = document.createElement("p");
      heading.className = "m-0 font-semibold text-ink";
      heading.textContent = `Why ${name} is the best match`;
      const reason = document.createElement("p");
      reason.className = "mt-1 mb-0";
      reason.textContent = explainLeader(leaderColumn);
      whyPopover.body.append(heading, reason);
    }
    updateDivergence();
  };

  // The control header teaches the interaction before the reader meets the
  // priority controls themselves.
  const header = document.createElement("div");
  header.className = "big-decision-weights-header mt-2.5";
  header.dataset.decisionWeightsHeader = "";
  const headerTitle = document.createElement("p");
  headerTitle.className = "m-0 text-xs font-semibold text-ink";
  headerTitle.textContent = "Prioritize the criteria";
  const headerHint = document.createElement("p");
  headerHint.className =
    "mt-0.5 mb-0 flex flex-wrap items-center gap-x-2 text-xs text-muted";
  const headerHintText = document.createElement("span");
  headerHintText.textContent =
    "Higher-priority criteria have more influence on Best match.";
  const howPopover = createPopover({ label: "How ranking works" });
  const howHeading = document.createElement("p");
  howHeading.className = "m-0 font-semibold text-ink";
  howHeading.textContent = "How ranking works";
  const howList = document.createElement("ul");
  howList.className = "mt-1 mb-0 list-disc pl-4";
  for (const point of HOW_RANKING_POINTS) {
    const item = document.createElement("li");
    item.textContent = point;
    howList.append(item);
  }
  howPopover.body.append(howHeading, howList);
  headerHint.append(headerHintText, howPopover.details);
  header.append(headerTitle, headerHint);

  for (const [index, row] of rows.entries()) {
    const rowHeader = row.querySelector("th");
    if (rowHeader === null) {
      continue;
    }
    const group = document.createElement("div");
    group.className =
      "big-decision-weights mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", `Priority of ${criterionName(row)}`);
    group.dataset.decisionWeights = "";
    const label = document.createElement("span");
    label.className = "big-decision-weight-label text-xs text-muted";
    label.dataset.decisionWeightLabel = "";
    const squares: Array<HTMLButtonElement> = [];
    const apply = (priority: number): void => {
      priorities[index] = priority;
      // Text carries the meaning; the squares stay a compact echo of it.
      label.textContent = `Priority: ${PRIORITY_LABELS[priority - 1] ?? "Medium"}`;
      for (const [position, square] of squares.entries()) {
        square.setAttribute(
          "aria-checked",
          position + 1 === priority ? "true" : "false",
        );
        if (position < priority) {
          square.dataset.weightFilled = "";
        } else {
          delete square.dataset.weightFilled;
        }
      }
      recompute();
      updateReset();
    };
    resetters.push(() => {
      apply(DEFAULT_PRIORITY);
    });
    const squareRow = document.createElement("span");
    squareRow.className = "inline-flex items-center gap-1";
    for (let step = 1; step <= PRIORITY_MAX; step += 1) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = "big-decision-weight";
      square.setAttribute("role", "radio");
      square.setAttribute(
        "aria-label",
        `Set priority to ${PRIORITY_LABELS[step - 1]} for ${criterionName(row)}`,
      );
      square.title = `Priority: ${PRIORITY_LABELS[step - 1]}`;
      square.addEventListener("click", () => {
        apply(step);
      });
      squares.push(square);
      squareRow.append(square);
    }
    group.append(label, squareRow);
    rowHeader.append(group);
    apply(DEFAULT_PRIORITY);
  }

  const wrapper = matrix.parentElement;
  wrapper?.before(header);
  wrapper?.after(footer);

  // Selection happens in the shared option-select script; observing it keeps
  // the divergence prompt honest without coupling the two scripts.
  const observer = new MutationObserver(() => {
    updateDivergence();
  });
  for (const option of options) {
    observer.observe(option, {
      attributes: true,
      attributeFilter: ["data-option-selected"],
    });
  }

  recompute();
  updateReset();
}
