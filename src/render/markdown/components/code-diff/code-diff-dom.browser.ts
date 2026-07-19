// Owns component-local CodeDiff DOM queries so sibling and nested diffs cannot
// accidentally share controls, annotations, or menu state.

export const ownedCodeDiffElements = <ElementType extends Element>({
  component,
  selector,
}: {
  readonly component: HTMLElement;
  readonly selector: string;
}): ReadonlyArray<ElementType> =>
  [...component.querySelectorAll<ElementType>(selector)].filter(
    (element) => element.closest("[data-code-diff]") === component,
  );

export const ownedCodeDiffElement = <ElementType extends Element>({
  component,
  selector,
}: {
  readonly component: HTMLElement;
  readonly selector: string;
}): ElementType | null =>
  ownedCodeDiffElements<ElementType>({ component, selector })[0] ?? null;
