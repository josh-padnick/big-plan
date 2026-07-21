// Owns the shared full-screen dialog behavior for review components: the
// component moves into a modal dialog and back without cloning, so listeners
// and in-component state survive, with page-scroll restore and an accessible
// dialog name taken from an existing caption when one exists.

let nextDialogLabelId = 1;

// Flips one expand control between its maximize and minimize affordances; the
// server renders both icons so the script only toggles visibility.
export const updateFullScreenControl = ({
  button,
  expanded,
  expandLabel,
}: {
  readonly button: HTMLButtonElement;
  readonly expanded: boolean;
  readonly expandLabel: string;
}): void => {
  const label = expanded ? "Exit full screen" : expandLabel;
  button.setAttribute("aria-label", label);
  button.title = label;
  button
    .querySelector<SVGElement>('[data-lucide="maximize-2"]')
    ?.toggleAttribute("hidden", expanded);
  button
    .querySelector<SVGElement>('[data-lucide="minimize-2"]')
    ?.toggleAttribute("hidden", !expanded);
};

// Moves the component into a modal dialog appended to its article rather than
// cloning it, then restores its DOM and page-scroll positions on close. The
// component's own onToggle mirrors the expanded state into its dataset and
// controls, keeping this module free of per-component selector contracts.
export const openComponentFullScreen = ({
  component,
  labelElement,
  fallbackLabel,
  onToggle,
}: {
  readonly component: HTMLElement;
  readonly labelElement: HTMLElement | null;
  readonly fallbackLabel: string;
  readonly onToggle: (input: { readonly expanded: boolean }) => void;
}): void => {
  const article = component.closest("article");
  if (article === null) {
    return;
  }
  const scrollY = window.scrollY;
  const dialog = document.createElement("dialog");
  dialog.className = "component-dialog";
  if (labelElement === null) {
    dialog.setAttribute("aria-label", fallbackLabel);
  } else {
    let labelId = labelElement.id;
    if (labelId === "" || document.getElementById(labelId) !== labelElement) {
      do {
        labelId = `component-dialog-label-${nextDialogLabelId}`;
        nextDialogLabelId += 1;
      } while (document.getElementById(labelId) !== null);
      labelElement.id = labelId;
    }
    dialog.setAttribute("aria-labelledby", labelId);
  }
  const placeholder = document.createElement("span");
  placeholder.hidden = true;
  component.before(placeholder);
  dialog.append(component);
  article.append(dialog);
  onToggle({ expanded: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    placeholder.before(component);
    placeholder.remove();
    dialog.remove();
    onToggle({ expanded: false });
    // Instant, not smooth: the page opts into smooth scrolling for section
    // navigation, but restoring where the reader already was must not read
    // as a visible re-scroll on exit.
    window.scrollTo({ top: scrollY, behavior: "instant" });
  });
  dialog.showModal();
  // Content-fit sizing can make the dialog match the inline component so
  // closely that full screen appears to do nothing; a slack band keeps the
  // modal visibly roomier until the viewport caps take over.
  const rect = dialog.getBoundingClientRect();
  dialog.style.width = `min(${Math.round(rect.width + 64)}px, 96vw, 100rem)`;
  dialog.style.height = `min(${Math.round(rect.height + 48)}px, 92vh)`;
};
