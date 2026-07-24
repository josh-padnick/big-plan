// Owns BigDecision's full-screen enhancement and the criterion-weighting
// preview: importance squares under each criterion recompute which option
// best fits the reader's weights, while the shared component dialog gives a
// wide matrix the whole viewport with selection and weights intact.

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

// The weighted comparison stays a preview: tones become coarse values, the
// reader tunes importance per criterion, and the leading column earns a
// Best fit tag that is visually distinct from the agent's Recommended pill.
const TONE_VALUES: Readonly<Record<string, number>> = {
  good: 2,
  mixed: 1,
  neutral: 0,
  bad: -2,
};

const WEIGHT_MAX = 3;
const DEFAULT_WEIGHT = 2;

const criterionName = (row: HTMLTableRowElement): string => {
  const header = row.querySelector("th");
  return header?.childNodes[0]?.textContent?.trim() || "this criterion";
};

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

  const weights = rows.map(() => DEFAULT_WEIGHT);
  const resetters: Array<() => void> = [];
  let resetButton: HTMLButtonElement | null = null;

  // The reset affordance appears only once the reader has diverged from the
  // plan's default weighting, and restores it in one click.
  const updateReset = (): void => {
    if (resetButton !== null) {
      resetButton.hidden = weights.every((weight) => weight === DEFAULT_WEIGHT);
    }
  };

  const recompute = (): void => {
    const totals = options.map((_, column) =>
      rows.reduce((sum, row, index) => {
        const cell = row.querySelectorAll("td")[column];
        const tone = cell?.dataset.scoreTone;
        const value = tone === undefined ? 0 : (TONE_VALUES[tone] ?? 0);
        return sum + (weights[index] ?? 0) * value;
      }, 0),
    );
    const best = Math.max(...totals);
    const leaders = totals.filter((total) => total === best).length;
    for (const [column, option] of options.entries()) {
      const leads = totals[column] === best && leaders < options.length;
      let tag = option.querySelector<HTMLElement>(".big-decision-bestfit");
      if (leads) {
        option.dataset.bestFit = "";
        if (tag === null) {
          tag = document.createElement("span");
          tag.className = "big-decision-bestfit";
          tag.textContent = "Best fit";
          option
            .querySelector("[data-option-title]")
            ?.parentElement?.append(tag);
        }
      } else {
        delete option.dataset.bestFit;
        tag?.remove();
      }
    }
  };

  for (const [index, row] of rows.entries()) {
    const header = row.querySelector("th");
    if (header === null) {
      continue;
    }
    const group = document.createElement("div");
    group.className = "big-decision-weights mt-1.5 flex items-center gap-1";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", `Importance of ${criterionName(row)}`);
    group.dataset.decisionWeights = "";
    const squares: Array<HTMLButtonElement> = [];
    const apply = (weight: number): void => {
      weights[index] = weight;
      for (const [position, square] of squares.entries()) {
        square.setAttribute(
          "aria-checked",
          position + 1 === weight ? "true" : "false",
        );
        if (position < weight) {
          square.dataset.weightFilled = "";
        } else {
          delete square.dataset.weightFilled;
        }
      }
      recompute();
      updateReset();
    };
    resetters.push(() => {
      apply(DEFAULT_WEIGHT);
    });
    for (let step = 1; step <= WEIGHT_MAX; step += 1) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = "big-decision-weight";
      square.setAttribute("role", "radio");
      square.setAttribute(
        "aria-label",
        `Importance ${step} of ${WEIGHT_MAX} for ${criterionName(row)}`,
      );
      square.title = `Importance ${step} of ${WEIGHT_MAX}`;
      square.addEventListener("click", () => {
        apply(step);
      });
      squares.push(square);
      group.append(square);
    }
    header.append(group);
    apply(DEFAULT_WEIGHT);
  }

  const legend = document.createElement("div");
  legend.className =
    "big-decision-weights-legend mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted";
  legend.dataset.decisionWeightsLegend = "";
  const legendText = document.createElement("span");
  legendText.textContent =
    "Fill squares to weight what matters most; the Best fit tag follows your weights.";
  resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "big-decision-weights-reset";
  resetButton.dataset.decisionWeightsReset = "";
  resetButton.textContent = "Reset weights";
  resetButton.hidden = true;
  resetButton.addEventListener("click", () => {
    for (const reset of resetters) {
      reset();
    }
  });
  legend.append(legendText, resetButton);
  matrix.parentElement?.after(legend);

  recompute();
  updateReset();
}

// Info disclosures float as tooltips once JavaScript is available: hover or
// focus shows the explanation beside its trigger without pushing layout, and
// the native in-place expansion remains the no-JavaScript fallback.
for (const info of document.querySelectorAll<HTMLElement>(
  "details.big-decision-info",
)) {
  const summary = info.querySelector<HTMLElement>("summary");
  const body = info.querySelector<HTMLElement>(".big-decision-info-body");
  if (
    summary === null ||
    body === null ||
    !(info instanceof HTMLDetailsElement)
  ) {
    continue;
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
  info.addEventListener("pointerleave", close);
  summary.addEventListener("focus", open);
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
  // Repositioning on scroll keeps the tooltip anchored to its trigger, and
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
}
