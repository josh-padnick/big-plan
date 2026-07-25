// Owns decision-local DOM queries so nested BigDecision and SmallDecisionSet
// components cannot accidentally share controls, options, or enhancement state.

const DECISION_ROOT_SELECTOR = "[data-big-decision], [data-small-decision]";

export const ownedDecisionElements = <ElementType extends Element>({
  root,
  selector,
}: {
  readonly root: HTMLElement;
  readonly selector: string;
}): ReadonlyArray<ElementType> =>
  [...root.querySelectorAll<ElementType>(selector)].filter(
    (element) => element.closest(DECISION_ROOT_SELECTOR) === root,
  );

export const ownedDecisionElement = <ElementType extends Element>({
  root,
  selector,
}: {
  readonly root: HTMLElement;
  readonly selector: string;
}): ElementType | null =>
  ownedDecisionElements<ElementType>({ root, selector })[0] ?? null;
