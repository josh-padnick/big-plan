// Owns the shared full-screen behavior for review components: the component
// moves into a modal dialog and back without cloning, so listeners and
// in-component state survive, with page-scroll restore and an accessible
// dialog name taken from an existing caption when one exists. On the embed
// surface (under the data-embed marker) the same dialog opens, but alone it
// would stay confined to the host iframe - so the embed additionally
// announces its full-screen state to the host page, which (when it is a
// cooperating host such as the docs' ThemeFrame) expands the iframe to cover
// its viewport for the duration. Without a listening host the dialog simply
// stays confined to the frame, which is the acceptable standalone fallback.

let nextDialogLabelId = 1;

// The cross-frame handshake type, mirrored by the docs' ThemeFrame host
// script; keep the two in sync.
const EMBED_FULLSCREEN_MESSAGE = "big-plan:embed-fullscreen";

const isEmbedComponent = (component: HTMLElement): boolean =>
  component.closest("[data-embed]") !== null;

// Announces embed full-screen state to the host page. The payload carries no
// sensitive data and the embed stays host-agnostic, so "*" is an acceptable
// target origin; a host that cares validates event.source instead.
const postEmbedFullScreen = ({
  active,
}: {
  readonly active: boolean;
}): void => {
  if (window.parent === window) {
    return;
  }
  window.parent.postMessage({ type: EMBED_FULLSCREEN_MESSAGE, active }, "*");
};

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
  const embedded = isEmbedComponent(component);
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
    // The close event fires for every exit path - the control, Esc's cancel,
    // and the backdrop click - so the host deactivation can never be missed.
    if (embedded) {
      postEmbedFullScreen({ active: false });
    }
    onToggle({ expanded: false });
    window.scrollTo({ top: scrollY });
  });
  dialog.showModal();
  if (embedded) {
    // The host expands the iframe to cover its viewport; viewport-relative
    // sizing makes the dialog fill the frame both before the expansion lands
    // and after, when the units re-resolve against the grown frame - so the
    // result reads exactly like the viewer's modal.
    dialog.style.width = "min(96vw, 100rem)";
    dialog.style.height = "92vh";
    postEmbedFullScreen({ active: true });
    return;
  }
  // Content-fit sizing can make the dialog match the inline component so
  // closely that full screen appears to do nothing; a slack band keeps the
  // modal visibly roomier until the viewport caps take over.
  const rect = dialog.getBoundingClientRect();
  dialog.style.width = `min(${Math.round(rect.width + 64)}px, 96vw, 100rem)`;
  dialog.style.height = `min(${Math.round(rect.height + 48)}px, 92vh)`;
};
