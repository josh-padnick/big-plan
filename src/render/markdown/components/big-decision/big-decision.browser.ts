// Owns BigDecision's browser enhancements: full-screen viewing, floating
// help (hover tooltips on server-rendered terms), and the priority preview:
// per-criterion importance squares recompute a live Score row, a Best match
// decorator, and an inline how-we-computed-scores breakdown, never touching
// the reader's own selection.

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
// so help never pushes layout or clips in the matrix scroller.
const enhanceFloatingInfo = ({
  info,
}: {
  readonly info: HTMLDetailsElement;
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

  info.addEventListener("pointerenter", open);
  info.addEventListener("pointerleave", () => {
    if (!info.matches(":focus-within")) {
      close();
    }
  });
  // Only keyboard focus opens; a mouse click also focuses, and letting that
  // open would make the click handler immediately toggle it shut.
  summary.addEventListener("focus", () => {
    if (summary.matches(":focus-visible")) {
      open();
    }
  });
  info.addEventListener("focusout", (event) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !info.contains(event.relatedTarget)
    ) {
      close();
    }
  });
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
    enhanceFloatingInfo({ info });
  }
}

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

const criterionName = (row: HTMLTableRowElement): string => {
  const header = row.querySelector("th");
  // A criterion with an explanation wraps its title in the help disclosure;
  // reading the whole cell would drag the tooltip body into the name.
  const helpTitle = header?.querySelector(
    ".big-decision-criterion-help > summary",
  );
  const source = helpTitle ?? header?.childNodes[0];
  return source?.textContent?.trim() || "this criterion";
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
    const priorityHead = document.createElement("th");
    priorityHead.textContent = "Priority";
    head.append(priorityHead);
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
      name.textContent = criterionName(row);
      line.append(name);
      const priorityCell = document.createElement("td");
      priorityCell.textContent = `×${priorities[index] ?? 0}`;
      line.append(priorityCell);
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
    totalLine.append(totalName, document.createElement("td"));
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

  // The Score section folds behind its label: expanding it shows the live
  // per-criterion arithmetic and the priorities reset.
  const section = document.createElement("details");
  section.className =
    "big-decision-section-toggle border-t border-edge px-4 py-4";
  section.dataset.decisionBestMatch = "";
  const sectionSummary = document.createElement("summary");
  sectionSummary.className = "cursor-pointer";
  const sectionLabel = document.createElement("span");
  sectionLabel.className =
    "card-section-label text-[0.6875rem] leading-4 font-bold tracking-[0.08em] uppercase text-ink/70";
  sectionLabel.textContent = "Score";
  sectionSummary.append(sectionLabel);
  const breakdownBody = document.createElement("div");
  breakdownBody.className = "mt-2 text-xs text-muted";
  breakdownBody.dataset.decisionBreakdown = "";
  const breakdownLegend = document.createElement("p");
  breakdownLegend.className = "mt-1.5 mb-0";
  breakdownLegend.textContent =
    "Each cell is tone value × priority. Tones: good +2, mixed +1, neutral 0, bad -2.";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "big-decision-popover-link";
  resetButton.dataset.decisionWeightsReset = "";
  resetButton.textContent = "Reset priorities";
  resetButton.hidden = true;
  resetButton.addEventListener("click", () => {
    sectionSummary.focus();
    for (const reset of resetters) {
      reset();
    }
  });

  const updateReset = (): void => {
    resetButton.hidden = priorities.every(
      (priority) => priority === DEFAULT_PRIORITY,
    );
  };

  const scoreRow = document.createElement("tr");
  scoreRow.className = "big-decision-matrix-row big-decision-score-row";
  scoreRow.dataset.decisionScoreRow = "";
  const scoreName = document.createElement("th");
  scoreName.setAttribute("scope", "row");
  scoreName.className = "px-3 py-2.5 text-left text-sm";
  scoreName.textContent = "Score";
  scoreRow.append(scoreName);
  const scoreCells = options.map(() => {
    const cell = document.createElement("td");
    cell.className = "px-3 py-2.5 text-sm";
    scoreRow.append(cell);
    return cell;
  });
  matrix.querySelector("tbody")?.append(scoreRow);

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
      const isLeader = column === leaderColumn;
      // When the leader is also the recommendation, the Recommended pill and
      // the highlighted Score cell already say it; a second pill just stacks.
      const showTag =
        isLeader && option.dataset.optionRecommended === undefined;
      if (isLeader) {
        option.dataset.bestMatch = "";
      } else {
        delete option.dataset.bestMatch;
      }
      let tag =
        option.parentElement?.querySelector<HTMLElement>(
          ".big-decision-bestmatch",
        ) ?? null;
      if (showTag) {
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
        tag?.remove();
      }
    }
    for (const [column, cell] of scoreCells.entries()) {
      cell.textContent = signed(totals[column] ?? 0);
      cell.classList.toggle(
        "big-decision-score-leader",
        column === leaderColumn,
      );
    }
    breakdownBody.replaceChildren(buildBreakdown(), breakdownLegend);
  };

  const actions = document.createElement("p");
  actions.className = "mt-2.5 mb-0 text-xs";
  actions.append(resetButton);
  section.append(sectionSummary, breakdownBody, actions);

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
        const selected = position + 1 === priority;
        square.setAttribute("aria-checked", selected ? "true" : "false");
        square.tabIndex = selected ? 0 : -1;
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
      square.addEventListener("keydown", (event) => {
        const destination =
          event.key === "ArrowDown" || event.key === "ArrowRight"
            ? step % PRIORITY_MAX
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? (step - 2 + PRIORITY_MAX) % PRIORITY_MAX
              : undefined;
        if (destination === undefined) {
          return;
        }
        event.preventDefault();
        apply(destination + 1);
        squares[destination]?.focus();
      });
      squares.push(square);
      squareRow.append(square);
    }
    group.append(squareRow);
    rowHeader.append(group);
    apply(DEFAULT_PRIORITY);
  }

  component.querySelector("[data-decision-options]")?.after(section);

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

    // Suggest another option lives with the options themselves: the link
    // sits under the matrix (above the Score section) and toggles an inline
    // form in place rather than floating a dialog.
    const suggest = document.createElement("button");
    suggest.type = "button";
    suggest.className = "big-decision-popover-link mt-2.5 font-normal";
    suggest.dataset.decisionSuggest = "";
    suggest.textContent = "Suggest another option";
    const suggestNote = document.createElement("p");
    suggestNote.className = "mt-1.5 mb-0 text-xs text-muted";
    suggestNote.dataset.decisionSuggestNote = "";
    suggestNote.hidden = true;
    suggestNote.textContent = ACTION_NOTE;

    // The form builds lazily on first use so the static DOM stays lean.
    let suggestForm: HTMLFormElement | null = null;
    const buildSuggestForm = (): HTMLFormElement => {
      const form = document.createElement("form");
      form.className =
        "mt-2.5 max-w-96 rounded-md border border-edge bg-surface p-3";
      form.dataset.decisionSuggestForm = "";
      const titleLabel = document.createElement("label");
      titleLabel.className = "block text-xs font-semibold text-muted";
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
      buttons.className = "mt-3 flex items-center gap-x-3";
      const send = document.createElement("button");
      send.type = "submit";
      send.className = "big-decision-action-primary";
      send.textContent = "Submit";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "big-decision-popover-link font-normal";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        suggest.hidden = false;
        suggest.focus();
        form.hidden = true;
      });
      buttons.append(send, cancel);
      form.append(titleLabel, whyLabel, buttons);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        suggest.hidden = false;
        suggest.focus();
        form.hidden = true;
        suggestNote.hidden = false;
        titleInput.value = "";
        whyInput.value = "";
      });
      return form;
    };
    suggest.addEventListener("click", () => {
      suggestForm = suggestForm ?? buildSuggestForm();
      if (suggestForm.parentElement === null) {
        suggestNote.before(suggestForm);
      }
      suggestForm.hidden = false;
      suggest.hidden = true;
      suggestForm.querySelector("input")?.focus();
    });
    const optionsSection = component.querySelector<HTMLElement>(
      "[data-decision-options]",
    );
    optionsSection?.append(suggest, suggestNote);

    const defer = document.createElement("button");
    defer.type = "button";
    defer.className = "big-decision-popover-link font-normal";
    defer.dataset.decisionDefer = "";
    defer.textContent = "Defer";
    defer.addEventListener("click", showNote);

    row.append(submit, defer);
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
