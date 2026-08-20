// Owns the deferred browser behavior for the settings dialog: sidebar section
// switching, live appearance and colour-theme changes, guarded persistence,
// focus isolation, and keyboard escape routes.

import {
  APPROVAL_MESSAGE_LIMIT,
  APPROVAL_MESSAGE_RECORD_VERSION,
  APPROVAL_MESSAGE_STORAGE_KEY,
  DEFAULT_APPROVAL_MESSAGE,
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
  const messageInput = document.querySelector("[data-approval-message-input]");
  const messageReset = document.querySelector("[data-approval-message-reset]");
  if (
    !(control instanceof HTMLElement) ||
    !(dialog instanceof HTMLElement) ||
    !(backdrop instanceof HTMLElement) ||
    !(openButton instanceof HTMLButtonElement) ||
    !(closeButton instanceof HTMLButtonElement) ||
    !(sectionList instanceof HTMLElement) ||
    !(messageInput instanceof HTMLTextAreaElement) ||
    !(messageReset instanceof HTMLButtonElement) ||
    modes.length === 0 ||
    palettes.length === 0 ||
    sections.length === 0 ||
    panels.length !== sections.length
  )
    return;

  const key = ${JSON.stringify(PREFERENCES_STORAGE_KEY)};
  const version = ${PREFERENCES_RECORD_VERSION};
  const messageKey = ${JSON.stringify(APPROVAL_MESSAGE_STORAGE_KEY)};
  const messageVersion = ${APPROVAL_MESSAGE_RECORD_VERSION};
  const messageLimit = ${APPROVAL_MESSAGE_LIMIT};
  const defaultMessage = ${JSON.stringify(DEFAULT_APPROVAL_MESSAGE)};
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

  // What an approval would actually carry, or null where storage refused to
  // answer at all. A stored note the contract cannot honour - unreadable,
  // over-long, or blank - reads as the default rather than as itself, but a
  // browser that will not open storage is saying nothing about the note rather
  // than saying there is none. src/render/preferences.ts owns that rule and
  // src/review/shared/approval-message.ts is the island's copy of it; this is
  // the same rule again, because the delivered script imports neither.
  const storedMessage = () => {
    let raw;
    try {
      raw = localStorage.getItem(messageKey);
    } catch (_) {
      return null;
    }
    try {
      if (raw === null) return defaultMessage;
      const record = JSON.parse(raw);
      if (
        record === null ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        record.version !== messageVersion ||
        typeof record.message !== "string" ||
        record.message.length > messageLimit
      )
        return defaultMessage;
      const message = record.message.trim();
      return message === "" ? defaultMessage : message;
    } catch (_) {
      return defaultMessage;
    }
  };

  // The field has to show what an approval would carry at every moment it is
  // visible, so both boundaries where the reviewer can leave it disagreeing
  // with the record - opening the sheet and leaving the field - read the record
  // back. Where storage refused to answer, written text on screen is the only
  // copy of the note the product still has, so it is kept rather than replaced;
  // a blank field has no such copy to keep, and an emptied note is the default
  // whatever storage will or will not say about it.
  const normalizeMessageField = () => {
    const message = storedMessage();
    if (message !== null) messageInput.value = message;
    else if (messageInput.value.trim() === "")
      messageInput.value = defaultMessage;
  };

  // The default is what absence already means, so storing it would only make a
  // record that says nothing: the key is removed instead, exactly as the
  // appearance record omits System.
  const saveMessage = () => {
    try {
      const message = messageInput.value.slice(0, messageLimit);
      if (message.trim() === "" || message === defaultMessage) {
        localStorage.removeItem(messageKey);
        return;
      }
      localStorage.setItem(
        messageKey,
        JSON.stringify({ version: messageVersion, message }),
      );
    } catch (_) {}
  };

  const applyMode = (mode) => {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
  };

  // The sidebar is the whole navigation: one item is selected, one page is
  // shown, and the rest give up their paint rather than stacking below.
  // Selection is a roving tab stop, so the trap counts the list once however
  // long it grows.
  const showSection = (next) => {
    for (const tab of sections) {
      const selected = tab.getAttribute("data-preferences-section") === next;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      // The page yields its paint, never its room: every page shares one grid
      // cell, so the sheet keeps the height of its tallest page whichever one
      // is showing. src/render/global.css owns what the attribute does.
      panel.toggleAttribute(
        "data-preferences-page-hidden",
        panel.getAttribute("data-preferences-panel") !== next,
      );
    }
  };

  // The sidebar is a column beside the page on a wide screen and a row above it
  // on a narrow one, so the orientation it reports has to follow the layout
  // rather than be asserted once in the markup. The width is the layout
  // breakpoint src/render/global.css lays the sheet out on.
  const layoutColumn = window.matchMedia("(min-width: 56rem)");
  const applyOrientation = () => {
    sectionList.setAttribute(
      "aria-orientation",
      layoutColumn.matches ? "vertical" : "horizontal",
    );
  };
  applyOrientation();
  layoutColumn.addEventListener("change", applyOrientation);

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

  // A settings page that is not showing keeps its room, so it is not [hidden]
  // and has to be excluded by name. The browser already skips it in the real
  // tab order; the trap has to agree, or its wrap-around counts stops that
  // Tab will never reach.
  const isTabbable = (element) =>
    element instanceof HTMLElement &&
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    element.closest("[hidden], [inert], [data-preferences-page-hidden]") ===
      null;

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

  // Whether the focus returning to the open button should show a ring is
  // decided by how the sheet was *closed*, not by how it was opened. A pointer
  // opens the sheet and Escape or the close button's Enter closes it; the
  // keyboard reader who did that has to see where focus landed.
  const setOpen = (nextOpen, returnFocus = false, closedByKeyboard = false) => {
    open = nextOpen;
    backdrop.hidden = !open;
    openButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      isolate();
      normalizeMessageField();
      // The sidebar is where reading the sheet starts, so the open dialog hands
      // the keyboard to the selected item rather than to a control inside a
      // panel the reviewer may not be looking at.
      selectedSection().focus();
    } else {
      restoreIsolation();
      if (returnFocus) {
        const showRing = openedByKeyboard || closedByKeyboard;
        openButton.focus({ focusVisible: showRing });
        if (showRing)
          openButton.removeAttribute("data-preferences-focus-quiet");
        else openButton.setAttribute("data-preferences-focus-quiet", "");
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
    // A keyboard activation of a button reports no pointer coordinates.
    setOpen(false, true, event.detail === 0);
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
  messageInput.addEventListener("input", saveMessage);
  // Blank is the one value the record cannot hold, so it is the one value the
  // field cannot be left holding either. Anything the reviewer actually wrote
  // is left exactly as they typed it.
  messageInput.addEventListener("blur", () => {
    if (messageInput.value.trim() === "") normalizeMessageField();
  });
  messageReset.addEventListener("click", (event) => {
    event.preventDefault();
    try {
      localStorage.removeItem(messageKey);
    } catch (_) {}
    messageInput.value = defaultMessage;
    messageInput.focus();
  });

  // The review island's "Edit message" opens this sheet on the settings page it
  // means, so the reviewer lands on the field rather than hunting the sidebar
  // for it. The island owns the dispatch; the shell owns where it lands.
  document.addEventListener("bigplan:open-settings", (event) => {
    const requested =
      event instanceof CustomEvent && typeof event.detail?.category === "string"
        ? event.detail.category
        : null;
    const panel = panels.find(
      (candidate) =>
        candidate.getAttribute("data-preferences-panel") === requested,
    );
    if (panel !== undefined) showSection(requested);
    openedByKeyboard = false;
    if (!open) setOpen(true);
    if (panel === undefined) return;
    const landing = Array.from(
      panel.querySelectorAll(
        'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter(isTabbable)[0];
    if (landing !== undefined) landing.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.bigPlanEscapeHandled = true;
      setOpen(false, true, true);
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
