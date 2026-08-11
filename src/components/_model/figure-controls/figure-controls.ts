// Owns the framework-free figure-control contract shared by rendered figures:
// the maximize and copy attribute vocabulary and labels.
//
// WHY THIS MODULE EXISTS
// Maximize and copy are drawn three different ways - React views for
// components, a HAST transform for plain fenced code, and CSS for shared
// state - and driven by a fourth, the viewer script. Places agreeing on
// attribute spellings by copy-paste is how collapse first broke (see
// markdown/deck-collapse.ts). The spellings live here so the React edge and
// the HAST edge cannot drift; the viewer script and stylesheet cite this
// module rather than importing it, because one is a string template and the
// other is CSS.
//
// MAXIMIZE DOM CONTRACT
//  1. The maximizable element carries MAXIMIZABLE_ATTRIBUTE and is the frame
//     the reader sees promoted. There is no separate wrapper.
//  2. Exactly one descendant carries TRIGGER_ATTRIBUTE and is a real button
//     holding both glyphs, the restore one hidden.
//  3. The script sets MAXIMIZED_ATTRIBUTE on the frame; every geometry change
//     hangs off that attribute alone.
//  4. The trigger ships `hidden`; the script reveals it. A document read
//     without scripts shows no control that cannot act.
//  5. At most one child carries BODY_ATTRIBUTE: the region that scrolls when
//     the frame is promoted. A family without a single such region omits it
//     and the whole panel scrolls.

/** Marks a frame the reader may promote to the viewport. */
export const MAXIMIZABLE_ATTRIBUTE = "data-figure-maximizable";

/** Marks the button that promotes and restores its frame. */
export const TRIGGER_ATTRIBUTE = "data-figure-maximize";

/** Set by the viewer script while the frame occupies the viewport. */
export const MAXIMIZED_ATTRIBUTE = "data-figure-maximized";

/**
 * Optionally marks the one child that scrolls and holds the content.
 *
 * A family with a single content region names it, and the promoted panel
 * hands that child the remaining height and pads it. A family whose content
 * is several siblings after the caption marks nothing, and the panel scrolls
 * as a whole instead. Guessing - at `:last-child`, say - is what this exists
 * to prevent: it picks up whichever hidden element a family happens to render
 * last.
 */
export const BODY_ATTRIBUTE = "data-figure-body";

/** The subject nouns used by copy controls and their accessible labels. */
export type CopySubject = "code" | "diff" | "schema" | "table";

export const copyLabel = (subject: CopySubject): string => `Copy ${subject}`;

/**
 * What the control says. The noun names the thing being promoted, so a
 * reviewer with several figures on screen knows which one the control acts on.
 */
export const maximizeLabel = (subject: string): string => `Maximize ${subject}`;

export const restoreLabel = (subject: string): string =>
  `Restore ${subject} size`;
