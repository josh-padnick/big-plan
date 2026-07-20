// Links one annotation card with the lines it anchors: hovering either side
// puts the shared annotation-hover class on both, so the reader always sees
// which note and which code belong together.

export const linkAnnotationHover = ({
  card,
  targets,
}: {
  readonly card: HTMLElement;
  readonly targets: ReadonlyArray<HTMLElement>;
}): void => {
  const linked = [card, ...targets];
  const set = (on: boolean): void => {
    for (const element of linked) {
      element.classList.toggle("annotation-hover", on);
    }
  };
  for (const element of linked) {
    element.addEventListener("pointerenter", () => set(true));
    element.addEventListener("pointerleave", () => set(false));
  }
};
