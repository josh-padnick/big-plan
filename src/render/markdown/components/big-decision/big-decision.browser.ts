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
  wide = false,
}: {
  readonly label: string;
  readonly wide?: boolean;
}): { readonly details: HTMLDetailsElement; readonly body: HTMLElement } => {
  const details = document.createElement("details");
  details.className = "big-decision-info";
  const summary = document.createElement("summary");
  summary.className = "big-decision-popover-link";
  summary.textContent = label;
  const body = document.createElement("div");
  body.className = `big-decision-info-body ${
    wide ? "max-w-96" : "max-w-60"
  } text-xs font-normal text-muted`;
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

  const signed = (value: number): string =>
    value > 0 ? `+${value}` : `${value}`;

  // The explanation shows the arithmetic itself - tone value times priority
  // per cell, totals per option - so the reader can verify the ranking.
  const buildBreakdown = (): HTMLTableElement => {
    const table = document.createElement("table");
    table.className = "big-decision-breakdown mt-1.5 w-full";
    const head = document.createElement("tr");
    head.append(document.createElement("th"));
    for (const option of options) {
      const cell = document.createElement("th");
      cell.textContent = optionName(option);
      head.append(cell);
    }
    const thead = document.createElement("thead");
    thead.append(head);
    table.append(thead);
    const body = document.createElement("tbody");
    const totals = options.map(() => 0);
    for (const [index, row] of rows.entries()) {
      const line = document.createElement("tr");
      const name = document.createElement("th");
      name.setAttribute("scope", "row");
      name.textContent = `${criterionName(row)} ×${priorities[index] ?? 0}`;
      line.append(name);
      for (const [column] of options.entries()) {
        const value = contribution({ row, index, column });
        totals[column] = (totals[column] ?? 0) + value;
        const cell = document.createElement("td");
        cell.textContent = signed(value);
        line.append(cell);
      }
      body.append(line);
    }
    const totalLine = document.createElement("tr");
    const totalName = document.createElement("th");
    totalName.setAttribute("scope", "row");
    totalName.textContent = "Total";
    totalLine.append(totalName);
    for (const [column] of options.entries()) {
      const cell = document.createElement("td");
      cell.textContent = signed(totals[column] ?? 0);
      if (column === leaderColumn) {
        cell.className = "big-decision-breakdown-leader";
      }
      totalLine.append(cell);
    }
    body.append(totalLine);
    table.append(body);
    return table;
  };

  // The Best match section gives every rank-related role a first-class home:
  // the verdict, the explicit selection action, the explanation, the reset,
  // and the how-ranking-works reference.
  const section = document.createElement("section");
  section.className = "border-t border-edge px-4 py-4";
  section.dataset.decisionBestMatch = "";
  const sectionLabel = document.createElement("div");
  sectionLabel.className =
    "card-section-label text-[0.6875rem] leading-4 font-bold tracking-[0.08em] uppercase text-ink/70";
  sectionLabel.textContent = "Ranking";
  const bestMatchLine = document.createElement("p");
  bestMatchLine.className = "mt-2.5 mb-0 text-sm text-muted";
  bestMatchLine.dataset.decisionBestMatchLine = "";
  const whyPopover = createPopover({ label: "Why this match?", wide: true });
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
  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "big-decision-popover-link font-normal";
  selectButton.dataset.decisionDivergence = "";
  selectButton.textContent = "Select";
  selectButton.hidden = true;
  selectButton.addEventListener("click", () => {
    if (leaderColumn !== null) {
      options[leaderColumn]?.click();
    }
  });

  const updateReset = (): void => {
    resetButton.hidden = priorities.every(
      (priority) => priority === DEFAULT_PRIORITY,
    );
  };

  // The reader's own selection stays untouched; when it diverges from the
  // computed leader, one inline Select offers the switch explicitly.
  const updateDivergence = (): void => {
    const selected = options.findIndex(
      (option) => option.dataset.optionSelected !== undefined,
    );
    selectButton.hidden =
      leaderColumn === null || selected === -1 || selected === leaderColumn;
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
      let tag =
        option.parentElement?.querySelector<HTMLElement>(
          ".big-decision-bestmatch",
        ) ?? null;
      if (leads) {
        option.dataset.bestMatch = "";
        if (tag === null) {
          tag = document.createElement("span");
          tag.className = "big-decision-bestmatch";
          tag.textContent = "Best match";
          (
            option.parentElement?.querySelector("[data-option-decorators]") ??
            option
          ).append(tag);
        }
      } else {
        delete option.dataset.bestMatch;
        tag?.remove();
      }
    }
    if (leaderColumn === null) {
      bestMatchLine.textContent =
        "Best match: none - the current priorities do not separate the options.";
      whyPopover.details.hidden = true;
    } else {
      const name = optionName(options[leaderColumn] ?? document.body);
      const label = document.createElement("span");
      label.className = "font-semibold text-ink";
      label.textContent = `Best match: ${name}`;
      bestMatchLine.replaceChildren(
        label,
        document.createTextNode(" "),
        selectButton,
      );
      whyPopover.details.hidden = false;
      whyPopover.body.replaceChildren();
      const heading = document.createElement("p");
      heading.className = "m-0 font-semibold text-ink";
      heading.textContent = `Why ${name} is the best match`;
      const legend = document.createElement("p");
      legend.className = "mt-1.5 mb-0";
      legend.textContent =
        "Each cell is tone value × priority. Tones: good +2, mixed +1, neutral 0, bad -2.";
      whyPopover.body.append(heading, buildBreakdown(), legend);
    }
    updateDivergence();
  };

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

  const actions = document.createElement("p");
  actions.className =
    "mt-2 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs";
  actions.append(whyPopover.details, howPopover.details, resetButton);
  section.append(sectionLabel, bestMatchLine, actions);

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
    const squares: Array<HTMLButtonElement> = [];
    const apply = (priority: number): void => {
      priorities[index] = priority;
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
    group.append(squareRow);
    rowHeader.append(group);
    apply(DEFAULT_PRIORITY);
  }

  component.querySelector("[data-decision-options]")?.after(section);

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

// Decision lifecycle actions. Every control here is a placeholder for the
// live review layer: it renders the intended interaction and answers with
// the same coming-soon note.
// TODO(live-review): transport Submit, Suggest another option, Defer, and
// Re-open to the authoring agent once the local server and chat bridge land.
const ACTION_NOTE =
  "This action connects to the live review session in a later deliverable.";

for (const component of document.querySelectorAll<HTMLElement>(
  "[data-big-decision]",
)) {
  const state = component.dataset.decisionState;
  const section = document.createElement("section");
  section.className = "border-t border-edge px-4 py-3";
  section.dataset.decisionActions = "";
  const row = document.createElement("div");
  row.className = "flex flex-wrap items-center gap-x-3 gap-y-1";
  const note = document.createElement("p");
  note.className = "mt-1.5 mb-0 text-xs text-muted";
  note.dataset.decisionActionNote = "";
  note.hidden = true;
  note.textContent = ACTION_NOTE;
  const showNote = (): void => {
    note.hidden = false;
  };

  if (state === "open") {
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "big-decision-action-primary";
    submit.dataset.decisionSubmit = "";
    submit.textContent = "Submit";
    submit.addEventListener("click", showNote);

    const suggest = document.createElement("button");
    suggest.type = "button";
    suggest.className = "big-decision-popover-link font-normal";
    suggest.dataset.decisionSuggest = "";
    suggest.textContent = "Suggest another option";

    // The dialog builds lazily on first use so the static DOM stays lean.
    let dialog: HTMLDialogElement | null = null;
    const buildDialog = (): HTMLDialogElement => {
      const built = document.createElement("dialog");
      built.className = "big-decision-suggest-dialog";
      const form = document.createElement("form");
      form.method = "dialog";
      const heading = document.createElement("p");
      heading.className = "m-0 text-sm font-semibold text-ink";
      heading.textContent = "Suggest another option";
      const titleLabel = document.createElement("label");
      titleLabel.className = "mt-2.5 block text-xs font-semibold text-muted";
      titleLabel.textContent = "Option";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.required = true;
      titleInput.className = "big-decision-suggest-input mt-1 w-full";
      titleLabel.append(titleInput);
      const whyLabel = document.createElement("label");
      whyLabel.className = "mt-2.5 block text-xs font-semibold text-muted";
      whyLabel.textContent = "Why it belongs here (optional)";
      const whyInput = document.createElement("textarea");
      whyInput.rows = 3;
      whyInput.className = "big-decision-suggest-input mt-1 w-full";
      whyLabel.append(whyInput);
      const buttons = document.createElement("div");
      buttons.className = "mt-3 flex items-center justify-end gap-x-3";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "big-decision-popover-link font-normal";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        built.close("");
      });
      const send = document.createElement("button");
      send.type = "submit";
      send.className = "big-decision-action-primary";
      send.textContent = "Submit";
      buttons.append(cancel, send);
      form.append(heading, titleLabel, whyLabel, buttons);
      form.addEventListener("submit", () => {
        built.close("submitted");
      });
      built.append(form);
      built.addEventListener("close", () => {
        if (built.returnValue === "submitted") {
          showNote();
        }
        titleInput.value = "";
        whyInput.value = "";
        built.remove();
        dialog = null;
      });
      return built;
    };
    suggest.addEventListener("click", () => {
      dialog = dialog ?? buildDialog();
      section.append(dialog);
      dialog.showModal();
    });

    const defer = document.createElement("button");
    defer.type = "button";
    defer.className = "big-decision-popover-link font-normal";
    defer.dataset.decisionDefer = "";
    defer.textContent = "Defer";
    defer.addEventListener("click", showNote);

    row.append(submit, suggest, defer);
    section.append(row, note);
  } else {
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "big-decision-popover-link";
    reopen.dataset.decisionReopen = "";
    reopen.textContent = "Re-open";
    reopen.addEventListener("click", showNote);
    row.append(reopen);
    section.append(row, note);
  }
  component.append(section);
}
