// Owns the deferred browser behavior for the settings dialog: sidebar section
// switching, live appearance and colour-theme changes, guarded persistence,
// focus isolation, and keyboard escape routes.

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
  const palettes = Array.from(
    document.querySelectorAll("[data-preference-palette]"),
  );
  const sectionList = document.querySelector("[data-preferences-sections]");
  const sections = Array.from(
    document.querySelectorAll("[data-preferences-section]"),
  );
  const panels = Array.from(
    document.querySelectorAll("[data-preferences-panel]"),
  );
  if (
    !(control instanceof HTMLElement) ||
    !(dialog instanceof HTMLElement) ||
    !(backdrop instanceof HTMLElement) ||
    !(openButton instanceof HTMLButtonElement) ||
    !(closeButton instanceof HTMLButtonElement) ||
    !(sectionList instanceof HTMLElement) ||
    modes.length === 0 ||
    palettes.length === 0 ||
    sections.length === 0 ||
    panels.length !== sections.length
  )
    return;

  const key = ${JSON.stringify(PREFERENCES_STORAGE_KEY)};
  const version = ${PREFERENCES_RECORD_VERSION};
  let isolatedElements = [];
  let open = false;
  let openedByKeyboard = false;

  // The record is written whole from what the document is showing, so the two
  // fields can never disagree with each other or with the page.
  const save = () => {
    try {
      const record = { version };
      const mode = currentMode();
      const palette = currentPalette();
      if (mode !== "system") record.mode = mode;
      if (palette !== "default") record.palette = palette;
      localStorage.setItem(key, JSON.stringify(record));
    } catch (_) {}
  };

  const applyMode = (mode) => {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
  };

  // The sidebar is the whole navigation: one item is selected, one panel is
  // shown, and the rest are hidden rather than stacked below. Selection is a
  // roving tab stop, so the trap counts the list once however long it grows.
  const showSection = (next) => {
    for (const tab of sections) {
      const selected = tab.getAttribute("data-preferences-section") === next;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.getAttribute("data-preferences-panel") !== next;
    }
  };

  const selectedSection = () => {
    const selected = sections.find(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    return selected ?? sections[0];
  };

  const applyPalette = (palette) => {
    if (palette === "default")
      document.documentElement.removeAttribute("data-palette");
    else document.documentElement.setAttribute("data-palette", palette);
  };

  const syncGroup = (controls, attribute, value) => {
    for (const candidate of controls) {
      if (candidate instanceof HTMLInputElement) {
        candidate.checked = candidate.getAttribute(attribute) === value;
      }
    }
  };

  const isTabbable = (element) =>
    element instanceof HTMLElement &&
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    element.closest("[hidden], [inert]") === null;

  // A radio group is one tab stop, not one per option: the browser moves
  // between its members with the arrow keys and skips the rest. Counting every
  // radio would put the last tab stop in the middle of the list and let the
  // trap's final Tab escape the dialog.
  const isSkippedRadio = (element, all) =>
    element instanceof HTMLInputElement &&
    element.type === "radio" &&
    element.name !== "" &&
    element !==
      (all.find(
        (candidate) =>
          candidate instanceof HTMLInputElement &&
          candidate.type === "radio" &&
          candidate.name === element.name &&
          candidate.checked,
      ) ??
        all.find(
          (candidate) =>
            candidate instanceof HTMLInputElement &&
            candidate.type === "radio" &&
            candidate.name === element.name,
        ));

  const tabbableElements = () => {
    const candidates = Array.from(
      dialog.querySelectorAll(
        'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter(isTabbable);
    return candidates.filter(
      (candidate) => !isSkippedRadio(candidate, candidates),
    );
  };

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
      // The sidebar is where reading the sheet starts, so the open dialog hands
      // the keyboard to the selected item rather than to a control inside a
      // panel the reviewer may not be looking at.
      selectedSection().focus();
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

  const currentPalette = () => {
    const palette = document.documentElement.getAttribute("data-palette");
    return palettes.some(
      (candidate) =>
        candidate.getAttribute("data-preference-palette") === palette,
    )
      ? palette
      : "default";
  };

  showSection(selectedSection().getAttribute("data-preferences-section"));
  syncGroup(modes, "data-preference-mode", currentMode());
  syncGroup(palettes, "data-preference-palette", currentPalette());
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
      syncGroup(modes, "data-preference-mode", mode);
      save();
    });
  }
  for (const tab of sections) {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      showSection(tab.getAttribute("data-preferences-section"));
    });
  }
  // Arrow keys walk the sidebar on either axis, because the same list is a
  // column on a wide screen and a row on a narrow one.
  sectionList.addEventListener("keydown", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-preferences-section]")
        : null;
    const index = target === null ? -1 : sections.indexOf(target);
    if (index === -1) return;
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
      event.key
    ];
    if (step === undefined && event.key !== "Home" && event.key !== "End")
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? sections.length - 1
          : (index + step + sections.length) % sections.length;
    showSection(sections[next].getAttribute("data-preferences-section"));
    sections[next].focus();
  });
  for (const paletteControl of palettes) {
    paletteControl.addEventListener("change", () => {
      const palette = paletteControl.getAttribute("data-preference-palette");
      if (palette === null) return;
      applyPalette(palette);
      syncGroup(palettes, "data-preference-palette", palette);
      save();
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
