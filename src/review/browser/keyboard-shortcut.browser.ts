// Owns the one chord the review's composers agree on, and how it is drawn.
//
// Enter alone belongs to a search box, not to a composer: every box here takes
// more than one line, and a reviewer pressing Enter for a second paragraph
// must not find they have sent instead. So sending is the platform's own
// "commit this text" chord, and it is named once - a second definition is how
// a surface ends up telling the reader to press a key that does nothing there.

const APPLE_PLATFORM = /Mac|iPhone|iPad/u.test(navigator.platform);

/** The chord as keys the reader presses, for a tooltip to draw one per key. */
export const MODIFIER_SHORTCUT_KEYS = APPLE_PLATFORM
  ? (["⌘", "Enter"] as const)
  : (["Ctrl", "Enter"] as const);

/** The same chord joined, for surfaces that set it in a sentence. */
export const MODIFIER_SHORTCUT = APPLE_PLATFORM ? "⌘+Enter" : "Ctrl+Enter";

/** Whether a keystroke is that chord. */
export const isModifierEnter = (event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): boolean =>
  event.key === "Enter" && (APPLE_PLATFORM ? event.metaKey : event.ctrlKey);
