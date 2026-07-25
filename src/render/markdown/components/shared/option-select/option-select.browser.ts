// Owns the local option-selection preview shared by BigDecision and
// SmallDecisionSet. The server renders every option as static content - that
// IS the no-JavaScript document - and this enhancement turns each undecided
// decision's options into a radio group so a reader can mark the option they
// would choose. The selection lives only in the page; the future live layer
// will transport it to the authoring agent.

import {
  ownedDecisionElement,
  ownedDecisionElements,
} from "../decision-dom/decision-dom.browser.js";

const decisionRoots = document.querySelectorAll<HTMLElement>(
  "[data-big-decision], [data-small-decision]",
);

const INTERACTIVE_ELEMENT_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "label",
  "select",
  "summary",
  "textarea",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]",
  "[role]",
  "[tabindex]",
].join(", ");

for (const root of decisionRoots) {
  // A decided decision's outcome is authored; reader selection would only
  // contradict the recorded choice.
  if (root.dataset.decisionState === "decided") {
    continue;
  }
  const group = ownedDecisionElement<HTMLElement>({
    root,
    selector: "[data-decision-options]",
  });
  if (group === null) {
    continue;
  }
  const options = ownedDecisionElements<HTMLElement>({
    root,
    selector: "[data-option]",
  });
  if (options.length < 2) {
    continue;
  }
  const entries = options.flatMap((option) => {
    const control = option.querySelector<HTMLElement>("[data-option-control]");
    return control === null ? [] : [{ option, control }];
  });
  if (entries.length !== options.length) {
    continue;
  }

  const question = ownedDecisionElement<HTMLElement>({
    root,
    selector: "[data-decision-question]",
  })?.textContent?.trim();
  group.setAttribute("role", "radiogroup");
  if (question !== undefined && question !== "") {
    group.setAttribute("aria-label", question);
  }

  const select = (index: number): void => {
    for (const [position, { option, control }] of entries.entries()) {
      const selected = position === index;
      control.setAttribute("aria-checked", selected ? "true" : "false");
      control.tabIndex = selected || (index === -1 && position === 0) ? 0 : -1;
      if (selected) {
        option.dataset.optionSelected = "";
      } else {
        delete option.dataset.optionSelected;
      }
    }
  };

  for (const [index, { option, control }] of entries.entries()) {
    control.removeAttribute("aria-hidden");
    control.setAttribute("role", "radio");
    option.classList.add("cursor-pointer");
    const title = option.querySelector<HTMLElement>("[data-option-title]");
    if (title?.id !== undefined && title.id !== "") {
      control.setAttribute("aria-labelledby", title.id);
    }
    const descriptionIds = [
      ...option.querySelectorAll<HTMLElement>("[data-option-description]"),
    ]
      .map((description) => description.id)
      .filter((id) => id !== "");
    if (descriptionIds.length > 0) {
      control.setAttribute("aria-describedby", descriptionIds.join(" "));
    }
    option.addEventListener("click", (event) => {
      if (event.target instanceof Element) {
        const interactiveTarget = event.target.closest(
          INTERACTIVE_ELEMENT_SELECTOR,
        );
        if (
          interactiveTarget !== null &&
          option.contains(interactiveTarget) &&
          interactiveTarget !== control &&
          !control.contains(interactiveTarget)
        ) {
          return;
        }
      }
      select(index);
      control.focus();
    });
    control.addEventListener("keydown", (event) => {
      if (event.target !== control) {
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        select(index);
        return;
      }
      const destination =
        event.key === "ArrowDown" || event.key === "ArrowRight"
          ? (index + 1) % options.length
          : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? (index - 1 + options.length) % options.length
            : undefined;
      if (destination === undefined) {
        return;
      }
      event.preventDefault();
      select(destination);
      entries[destination]?.control.focus();
    });
  }

  // Accepting the agent's recommendation should cost zero clicks, so the
  // recommended option starts selected; changing it stays one click.
  select(
    options.findIndex(
      (option) => option.dataset.optionRecommended !== undefined,
    ),
  );
  root.dataset.optionSelect = "";
}
