// Owns the mark each named wireframe meaning draws, and the placeholder every
// other word draws. The vocabulary of names lives in the model; this file is
// only the presentation edge that turns one of those names into ink.

import type { WireframeIconName } from "./model.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { ARROW_DOWN_ICON } from "../../icons/lucide/arrow-down.js";
import { ARROW_UP_ICON } from "../../icons/lucide/arrow-up.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_LEFT_ICON } from "../../icons/lucide/chevron-left.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { CIRCLE_X_ICON } from "../../icons/lucide/circle-x.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { DATABASE_ICON } from "../../icons/lucide/database.js";
import { ELLIPSIS_ICON } from "../../icons/lucide/ellipsis.js";
import { FILE_ICON } from "../../icons/lucide/file.js";
import { FOLDER_ICON } from "../../icons/lucide/folder.js";
import { GRIP_VERTICAL_ICON } from "../../icons/lucide/grip-vertical.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { LOCK_ICON } from "../../icons/lucide/lock.js";
import { MAXIMIZE_2_ICON } from "../../icons/lucide/maximize-2.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { MINUS_ICON } from "../../icons/lucide/minus.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { PLUS_ICON } from "../../icons/lucide/plus.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { SEARCH_ICON } from "../../icons/lucide/search.js";
import { SETTINGS_ICON } from "../../icons/lucide/settings.js";
import { STAR_ICON } from "../../icons/lucide/star.js";
import { TABLE_ICON } from "../../icons/lucide/table.js";
import { TERMINAL_ICON } from "../../icons/lucide/terminal.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { UNDO_2_ICON } from "../../icons/lucide/undo-2.js";
import { X_ICON } from "../../icons/lucide/x.js";

// Keyed exhaustively by the name vocabulary, so adding a meaning without
// giving it a mark fails compilation here rather than drawing a placeholder in
// a delivered plan.
const WIREFRAME_GLYPHS = {
  add: PLUS_ICON,
  back: CHEVRON_LEFT_ICON,
  chevron: CHEVRON_RIGHT_ICON,
  close: X_ICON,
  collapse: MINIMIZE_2_ICON,
  comment: MESSAGE_SQUARE_ICON,
  copy: COPY_ICON,
  database: DATABASE_ICON,
  delete: TRASH_2_ICON,
  done: CHECK_ICON,
  down: ARROW_DOWN_ICON,
  drag: GRIP_VERTICAL_ICON,
  edit: PENCIL_ICON,
  error: CIRCLE_X_ICON,
  expand: MAXIMIZE_2_ICON,
  file: FILE_ICON,
  folder: FOLDER_ICON,
  help: CIRCLE_QUESTION_MARK_ICON,
  info: INFO_ICON,
  lock: LOCK_ICON,
  more: ELLIPSIS_ICON,
  refresh: ROTATE_CCW_ICON,
  remove: MINUS_ICON,
  search: SEARCH_ICON,
  settings: SETTINGS_ICON,
  star: STAR_ICON,
  table: TABLE_ICON,
  terminal: TERMINAL_ICON,
  tip: LIGHTBULB_ICON,
  undo: UNDO_2_ICON,
  up: ARROW_UP_ICON,
  waiting: HOURGLASS_ICON,
  warning: TRIANGLE_ALERT_ICON,
} satisfies Readonly<Record<WireframeIconName, LucideIcon>>;

/**
 * The mark drawn for a meaning the set does not hold.
 *
 * The crossed box is the same "nobody has drawn this yet" language
 * `ImagePlaceholder` uses one size up, and the view always draws the requested
 * name beside it, so the drawing says exactly what it is missing.
 */
export const WIREFRAME_PLACEHOLDER_GLYPH: LucideIcon = {
  name: "wireframe-placeholder",
  node: [
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "m3 3 18 18" }],
  ],
};

/** Finds the mark one authored name draws, or nothing when it is not named. */
export const wireframeGlyphFor = (name: string): LucideIcon | undefined =>
  Object.hasOwn(WIREFRAME_GLYPHS, name)
    ? WIREFRAME_GLYPHS[name as WireframeIconName]
    : undefined;
