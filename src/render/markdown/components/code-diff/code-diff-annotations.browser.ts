// Owns CodeDiff annotation clamping and split-pane spacer synchronization.
// Without JavaScript, split spacers remain zero-height and unified content
// remains the complete readable fallback.

import { ownedCodeDiffElements } from "./code-diff-dom.browser.js";

const ANNOTATION_CLAMP_LINES = 3;
let nextAnnotationBodyId = 1;

// Finds a body's disclosure button when one is currently attached.
const annotationToggleFor = (body: HTMLElement): HTMLButtonElement | null => {
  const sibling = body.nextElementSibling;
  return sibling instanceof HTMLButtonElement &&
    sibling.classList.contains("code-diff-annotation-toggle")
    ? sibling
    : null;
};

// Adds or removes a body's disclosure to match its measured overflow at
// roughly three lines. A reader's expanded choice survives size changes.
const evaluateAnnotationBody = (body: HTMLElement): void => {
  if (body.getClientRects().length === 0) {
    return;
  }
  const lineHeight = Number.parseFloat(getComputedStyle(body).lineHeight);
  if (!Number.isFinite(lineHeight)) {
    return;
  }
  const needsToggle =
    body.scrollHeight > lineHeight * ANNOTATION_CLAMP_LINES + 1;
  const existing = annotationToggleFor(body);
  if (!needsToggle) {
    if (existing !== null) {
      existing.remove();
      body.classList.remove("code-diff-annotation-body-clamped");
    }
    return;
  }
  if (existing !== null) {
    return;
  }

  let bodyId = body.id;
  if (bodyId === "") {
    do {
      bodyId = `code-diff-annotation-body-${nextAnnotationBodyId}`;
      nextAnnotationBodyId += 1;
    } while (document.getElementById(bodyId) !== null);
    body.id = bodyId;
  }
  const expanded = body.dataset.annotationExpanded !== undefined;
  body.classList.toggle("code-diff-annotation-body-clamped", !expanded);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-diff-annotation-toggle";
  button.textContent = expanded ? "View less" : "View more…";
  button.setAttribute("aria-controls", bodyId);
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.addEventListener("click", () => {
    const wasExpanded = button.getAttribute("aria-expanded") === "true";
    if (wasExpanded) {
      delete body.dataset.annotationExpanded;
    } else {
      body.dataset.annotationExpanded = "";
    }
    button.setAttribute("aria-expanded", wasExpanded ? "false" : "true");
    button.textContent = wasExpanded ? "View more…" : "View less";
    body.classList.toggle("code-diff-annotation-body-clamped", wasExpanded);
  });
  body.after(button);
};

// Mirrors a split card's rendered surround height into its opposite-pane
// spacer while the component moves into and out of its full-screen dialog.
const syncAnnotationSpacer = (card: HTMLElement): void => {
  if (card.getClientRects().length === 0) {
    return;
  }
  const id = card.dataset.annotationCard;
  const component = card.closest<HTMLElement>("[data-code-diff]");
  if (id === undefined || component === null) {
    return;
  }
  const spacer = ownedCodeDiffElements<HTMLElement>({
    component,
    selector: "[data-annotation-spacer]",
  }).find((candidate) => candidate.dataset.annotationSpacer === id);
  if (spacer !== undefined) {
    spacer.style.height = `${card.getBoundingClientRect().height}px`;
  }
};

// One observer re-evaluates bodies and mirrors split card heights as their
// boxes change; older engines retain the load-time measurements.
const annotationResizeObserver =
  typeof ResizeObserver === "undefined"
    ? undefined
    : new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (
            entry.target instanceof HTMLElement &&
            entry.target.classList.contains("annotation-card-body")
          ) {
            evaluateAnnotationBody(entry.target);
          }
          if (
            entry.target instanceof HTMLElement &&
            entry.target.dataset.annotationCard !== undefined
          ) {
            syncAnnotationSpacer(entry.target);
          }
        }
      });

/** Measures annotations in whichever static diff view is now visible. */
export const enhanceVisibleAnnotations = ({
  component,
}: {
  readonly component: HTMLElement;
}): void => {
  for (const card of ownedCodeDiffElements<HTMLElement>({
    component,
    selector: "[data-annotation-card]",
  })) {
    if (card.dataset.annotationCardObserved === undefined) {
      card.dataset.annotationCardObserved = "";
      annotationResizeObserver?.observe(card);
    }
    syncAnnotationSpacer(card);
  }
  for (const body of ownedCodeDiffElements<HTMLElement>({
    component,
    selector: ".annotation-card-body",
  })) {
    if (body.dataset.annotationObserved === undefined) {
      body.dataset.annotationObserved = "";
      annotationResizeObserver?.observe(body);
    }
    evaluateAnnotationBody(body);
  }
};
