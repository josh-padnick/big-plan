// Owns the shared full-screen behavior for review components. In the viewer
// the component moves into a modal dialog and back without cloning, so
// listeners and in-component state survive, with page-scroll restore and an
// accessible dialog name taken from an existing caption when one exists. On
// the embed surface (under the data-embed marker) a modal dialog could never
// escape the host iframe, so the same control drives the browser Fullscreen
// API instead, which the host grants via allowfullscreen.

let nextDialogLabelId = 1;

const isEmbedComponent = (component: HTMLElement): boolean =>
  component.closest("[data-embed]") !== null;

/**
 * Whether the full-screen control can work for this component: always in the
 * viewer's dialog path, and only with an available Fullscreen API (the host
 * iframe must allow it) on the embed surface. Callers keep the control
 * hidden when this is false, so a denied embed degrades to no control.
 */
export const fullScreenSupported = ({
  component,
}: {
  readonly component: HTMLElement;
}): boolean => !isEmbedComponent(component) || document.fullscreenEnabled;

// Enters or exits browser full screen for an embedded component. The exit
// path only requests it; state mirroring waits for fullscreenchange so Esc,
// the control, and programmatic exits all converge on the same handler.
const toggleEmbedFullScreen = ({
  component,
  onToggle,
}: {
  readonly component: HTMLElement;
  readonly onToggle: (input: { readonly expanded: boolean }) => void;
}): void => {
  if (document.fullscreenElement === component) {
    void document.exitFullscreen();
    return;
  }
  component
    .requestFullscreen()
    .then(() => {
      onToggle({ expanded: true });
      const onChange = (): void => {
        if (document.fullscreenElement === component) {
          return;
        }
        document.removeEventListener("fullscreenchange", onChange);
        onToggle({ expanded: false });
      };
      document.addEventListener("fullscreenchange", onChange);
    })
    .catch(() => {
      // The platform or host denied the request; the component stays inline.
    });
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
  if (isEmbedComponent(component)) {
    toggleEmbedFullScreen({ component, onToggle });
    return;
  }
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
    window.scrollTo({ top: scrollY });
  });
  dialog.showModal();
  // Content-fit sizing can make the dialog match the inline component so
  // closely that full screen appears to do nothing; a slack band keeps the
  // modal visibly roomier until the viewport caps take over.
  const rect = dialog.getBoundingClientRect();
  dialog.style.width = `min(${Math.round(rect.width + 64)}px, 96vw, 100rem)`;
  dialog.style.height = `min(${Math.round(rect.height + 48)}px, 92vh)`;
};
