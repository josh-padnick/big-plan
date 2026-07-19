// Owns block-local CodeDiff DOM queries so sibling and nested diffs cannot
// accidentally share controls, annotations, or menu state.

export const ownedCodeDiffElements = <ElementType extends Element>({
  block,
  selector,
}: {
  readonly block: HTMLElement;
  readonly selector: string;
}): ReadonlyArray<ElementType> =>
  [...block.querySelectorAll<ElementType>(selector)].filter(
    (element) => element.closest("[data-code-diff]") === block,
  );

export const ownedCodeDiffElement = <ElementType extends Element>({
  block,
  selector,
}: {
  readonly block: HTMLElement;
  readonly selector: string;
}): ElementType | null =>
  ownedCodeDiffElements<ElementType>({ block, selector })[0] ?? null;
