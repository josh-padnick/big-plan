// Owns the deferred browser behavior for the settings dialog: live appearance
// changes, guarded persistence, focus isolation, and keyboard escape routes.

import {
  PREFERENCES_RECORD_VERSION,
  PREFERENCES_STORAGE_KEY,
} from "../preferences.js";

export const PREFERENCES_SCRIPT = `<script>
(() => {
  const control = document.querySelector("[data-preferences-control]");
  const dialog = document.querySelector("[data-preferences-dialog]");
  const backdrop = document.querySelector("[data-preferences-backdrop]");
  const openButton = document.querySelector("[data-preferences-open]");
  const closeButton = document.querySelector("[data-preferences-close]");
  const modes = Array.from(document.querySelectorAll("[data-preference-mode]"));
  if (
    !(control instanceof HTMLElement) ||
    !(dialog instanceof HTMLElement) ||
    !(backdrop instanceof HTMLElement) ||
    !(openButton instanceof HTMLButtonElement) ||
    !(closeButton instanceof HTMLButtonElement) ||
    modes.length === 0
  )
    return;

  const key = ${JSON.stringify(PREFERENCES_STORAGE_KEY)};
  const version = ${PREFERENCES_RECORD_VERSION};
  let isolatedElements = [];
  let open = false;
  let openedByKeyboard = false;

  const saveMode = (mode) => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(mode === "system" ? { version } : { version, mode }),
      );
    } catch (_) {}
  };

  const applyMode = (mode) => {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
  };

  const syncControls = (mode) => {
    for (const candidate of modes) {
      if (candidate instanceof HTMLInputElement) {
        candidate.checked =
          candidate.getAttribute("data-preference-mode") === mode;
      }
    }
  };

  const isTabbable = (element) =>
    element instanceof HTMLElement &&
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    element.closest("[hidden], [inert]") === null;

  const tabbableElements = () =>
    Array.from(
      dialog.querySelectorAll(
        'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter(isTabbable);

  const isolate = () => {
    isolatedElements = [];
    let branch = backdrop;
    while (branch.parentElement !== null) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          isolatedElements.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (parent === document.body) break;
      branch = parent;
    }
  };

  const restoreIsolation = () => {
    for (const entry of isolatedElements) entry.element.inert = entry.inert;
    isolatedElements = [];
  };

  const setOpen = (nextOpen, returnFocus = false) => {
    open = nextOpen;
    backdrop.hidden = !open;
    openButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      isolate();
      const selected = modes.find(
        (candidate) =>
          candidate instanceof HTMLInputElement && candidate.checked,
      );
      (selected || closeButton).focus();
    } else {
      restoreIsolation();
      if (returnFocus) {
        openButton.focus({ focusVisible: openedByKeyboard });
        if (!openedByKeyboard)
          openButton.setAttribute("data-preferences-focus-quiet", "");
      }
    }
  };

  const currentMode = () => {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "light" || theme === "dark" ? theme : "system";
  };

  syncControls(currentMode());
  control.hidden = false;
  openButton.addEventListener("click", (event) => {
    event.preventDefault();
    openedByKeyboard = event.detail === 0;
    setOpen(true);
  });
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(false, true);
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) setOpen(false, true);
  });
  for (const modeControl of modes) {
    modeControl.addEventListener("change", () => {
      const mode = modeControl.getAttribute("data-preference-mode");
      if (mode !== "light" && mode !== "dark" && mode !== "system") return;
      applyMode(mode);
      syncControls(mode);
      saveMode(mode);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.bigPlanEscapeHandled = true;
      setOpen(false, true);
      return;
    }
    if (event.key !== "Tab") return;
    const tabbable = tabbableElements();
    if (tabbable.length === 0) return;
    const current = document.activeElement;
    const currentIndex = tabbable.indexOf(current);
    if (
      currentIndex === -1 ||
      (event.shiftKey && currentIndex === 0) ||
      (!event.shiftKey && currentIndex === tabbable.length - 1)
    ) {
      event.preventDefault();
      tabbable[event.shiftKey ? tabbable.length - 1 : 0].focus();
    }
  });
  for (const type of ["keydown", "pointerdown", "blur"]) {
    document.addEventListener(
      type,
      (event) => {
        if (event.type === "keydown" && event.key === "Escape") return;
        openButton.removeAttribute("data-preferences-focus-quiet");
      },
      true,
    );
  }
})();
</script>`;
