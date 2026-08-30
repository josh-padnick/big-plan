// Owns the mark each named wireframe meaning draws, and the placeholder every
// other word draws. The vocabulary of names lives in the model; this file is
// only the presentation edge that turns one of those names into ink.

import type { WireframeIconName } from "./model.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { ARCHIVE_ICON } from "../../icons/lucide/archive.js";
import { ARCHIVE_RESTORE_ICON } from "../../icons/lucide/archive-restore.js";
import { ARROW_DOWN_ICON } from "../../icons/lucide/arrow-down.js";
import { ARROW_LEFT_ICON } from "../../icons/lucide/arrow-left.js";
import { ARROW_RIGHT_ICON } from "../../icons/lucide/arrow-right.js";
import { ARROW_UP_ICON } from "../../icons/lucide/arrow-up.js";
import { ARROW_UP_DOWN_ICON } from "../../icons/lucide/arrow-up-down.js";
import { BADGE_CHECK_ICON } from "../../icons/lucide/badge-check.js";
import { BAN_ICON } from "../../icons/lucide/ban.js";
import { BELL_ICON } from "../../icons/lucide/bell.js";
import { BOOK_OPEN_ICON } from "../../icons/lucide/book-open.js";
import { BUG_ICON } from "../../icons/lucide/bug.js";
import { CALENDAR_ICON } from "../../icons/lucide/calendar.js";
import { CAMERA_ICON } from "../../icons/lucide/camera.js";
import { CHART_LINE_ICON } from "../../icons/lucide/chart-line.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_DOWN_ICON } from "../../icons/lucide/chevron-down.js";
import { CHEVRON_LEFT_ICON } from "../../icons/lucide/chevron-left.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { CIRCLE_CHECK_ICON } from "../../icons/lucide/circle-check.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { CIRCLE_X_ICON } from "../../icons/lucide/circle-x.js";
import { CLOCK_ICON } from "../../icons/lucide/clock.js";
import { CLOUD_ICON } from "../../icons/lucide/cloud.js";
import { CODE_ICON } from "../../icons/lucide/code.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { DATABASE_ICON } from "../../icons/lucide/database.js";
import { DOWNLOAD_ICON } from "../../icons/lucide/download.js";
import { ELLIPSIS_ICON } from "../../icons/lucide/ellipsis.js";
import { EXTERNAL_LINK_ICON } from "../../icons/lucide/external-link.js";
import { EYE_ICON } from "../../icons/lucide/eye.js";
import { EYE_OFF_ICON } from "../../icons/lucide/eye-off.js";
import { FILE_ICON } from "../../icons/lucide/file.js";
import { FLAG_ICON } from "../../icons/lucide/flag.js";
import { FOLDER_ICON } from "../../icons/lucide/folder.js";
import { FUNNEL_ICON } from "../../icons/lucide/funnel.js";
import { GIT_BRANCH_ICON } from "../../icons/lucide/git-branch.js";
import { GIT_MERGE_ICON } from "../../icons/lucide/git-merge.js";
import { GRIP_VERTICAL_ICON } from "../../icons/lucide/grip-vertical.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { HOUSE_ICON } from "../../icons/lucide/house.js";
import { IMAGE_ICON } from "../../icons/lucide/image.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { KEY_ICON } from "../../icons/lucide/key.js";
import { LAYOUT_DASHBOARD_ICON } from "../../icons/lucide/layout-dashboard.js";
import { LAYOUT_GRID_ICON } from "../../icons/lucide/layout-grid.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { LINK_ICON } from "../../icons/lucide/link.js";
import { LIST_ICON } from "../../icons/lucide/list.js";
import { LOADER_ICON } from "../../icons/lucide/loader.js";
import { LOCK_ICON } from "../../icons/lucide/lock.js";
import { LOCK_OPEN_ICON } from "../../icons/lucide/lock-open.js";
import { MAIL_ICON } from "../../icons/lucide/mail.js";
import { MAP_PIN_ICON } from "../../icons/lucide/map-pin.js";
import { MAXIMIZE_2_ICON } from "../../icons/lucide/maximize-2.js";
import { MENU_ICON } from "../../icons/lucide/menu.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MESSAGES_SQUARE_ICON } from "../../icons/lucide/messages-square.js";
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { MINUS_ICON } from "../../icons/lucide/minus.js";
import { MOVE_ICON } from "../../icons/lucide/move.js";
import { PANEL_LEFT_ICON } from "../../icons/lucide/panel-left.js";
import { PAPERCLIP_ICON } from "../../icons/lucide/paperclip.js";
import { PAUSE_ICON } from "../../icons/lucide/pause.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { PHONE_ICON } from "../../icons/lucide/phone.js";
import { PIN_ICON } from "../../icons/lucide/pin.js";
import { PLAY_ICON } from "../../icons/lucide/play.js";
import { PLUS_ICON } from "../../icons/lucide/plus.js";
import { PRINTER_ICON } from "../../icons/lucide/printer.js";
import { REDO_2_ICON } from "../../icons/lucide/redo-2.js";
import { REFRESH_CW_ICON } from "../../icons/lucide/refresh-cw.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { ROTATE_CCW_CLOCK_ICON } from "../../icons/lucide/rotate-ccw-clock.js";
import { SAVE_ICON } from "../../icons/lucide/save.js";
import { SCAN_ICON } from "../../icons/lucide/scan.js";
import { SEARCH_ICON } from "../../icons/lucide/search.js";
import { SEND_ICON } from "../../icons/lucide/send.js";
import { SERVER_ICON } from "../../icons/lucide/server.js";
import { SETTINGS_ICON } from "../../icons/lucide/settings.js";
import { SHARE_2_ICON } from "../../icons/lucide/share-2.js";
import { SHIELD_ICON } from "../../icons/lucide/shield.js";
import { SLIDERS_HORIZONTAL_ICON } from "../../icons/lucide/sliders-horizontal.js";
import { SQUARE_ICON } from "../../icons/lucide/square.js";
import { STAR_ICON } from "../../icons/lucide/star.js";
import { TABLE_ICON } from "../../icons/lucide/table.js";
import { TAG_ICON } from "../../icons/lucide/tag.js";
import { TERMINAL_ICON } from "../../icons/lucide/terminal.js";
import { THUMBS_UP_ICON } from "../../icons/lucide/thumbs-up.js";
import { TOGGLE_RIGHT_ICON } from "../../icons/lucide/toggle-right.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { UNDO_2_ICON } from "../../icons/lucide/undo-2.js";
import { UPLOAD_ICON } from "../../icons/lucide/upload.js";
import { USER_ICON } from "../../icons/lucide/user.js";
import { USERS_ICON } from "../../icons/lucide/users.js";
import { VIDEO_ICON } from "../../icons/lucide/video.js";
import { VOLUME_2_ICON } from "../../icons/lucide/volume-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { ZOOM_IN_ICON } from "../../icons/lucide/zoom-in.js";

// Keyed exhaustively by the name vocabulary, so adding a meaning without
// giving it a mark fails compilation here rather than drawing a placeholder in
// a delivered plan.
const WIREFRAME_GLYPHS = {
  add: PLUS_ICON,
  alert: BELL_ICON,
  archive: ARCHIVE_ICON,
  attach: PAPERCLIP_ICON,
  back: CHEVRON_LEFT_ICON,
  blocked: BAN_ICON,
  book: BOOK_OPEN_ICON,
  branch: GIT_BRANCH_ICON,
  bug: BUG_ICON,
  calendar: CALENDAR_ICON,
  camera: CAMERA_ICON,
  chart: CHART_LINE_ICON,
  chevron: CHEVRON_RIGHT_ICON,
  clock: CLOCK_ICON,
  close: X_ICON,
  cloud: CLOUD_ICON,
  code: CODE_ICON,
  collapse: MINIMIZE_2_ICON,
  comment: MESSAGE_SQUARE_ICON,
  copy: COPY_ICON,
  dashboard: LAYOUT_DASHBOARD_ICON,
  database: DATABASE_ICON,
  delete: TRASH_2_ICON,
  done: CHECK_ICON,
  down: ARROW_DOWN_ICON,
  download: DOWNLOAD_ICON,
  drag: GRIP_VERTICAL_ICON,
  dropdown: CHEVRON_DOWN_ICON,
  edit: PENCIL_ICON,
  error: CIRCLE_X_ICON,
  expand: MAXIMIZE_2_ICON,
  external: EXTERNAL_LINK_ICON,
  file: FILE_ICON,
  filter: FUNNEL_ICON,
  flag: FLAG_ICON,
  folder: FOLDER_ICON,
  forward: ARROW_RIGHT_ICON,
  grid: LAYOUT_GRID_ICON,
  help: CIRCLE_QUESTION_MARK_ICON,
  hide: EYE_OFF_ICON,
  history: ROTATE_CCW_CLOCK_ICON,
  home: HOUSE_ICON,
  image: IMAGE_ICON,
  inbox: MESSAGES_SQUARE_ICON,
  info: INFO_ICON,
  key: KEY_ICON,
  like: THUMBS_UP_ICON,
  link: LINK_ICON,
  list: LIST_ICON,
  loading: LOADER_ICON,
  location: MAP_PIN_ICON,
  lock: LOCK_ICON,
  mail: MAIL_ICON,
  menu: MENU_ICON,
  merge: GIT_MERGE_ICON,
  more: ELLIPSIS_ICON,
  move: MOVE_ICON,
  pause: PAUSE_ICON,
  phone: PHONE_ICON,
  pin: PIN_ICON,
  play: PLAY_ICON,
  previous: ARROW_LEFT_ICON,
  print: PRINTER_ICON,
  redo: REDO_2_ICON,
  refresh: ROTATE_CCW_ICON,
  remove: MINUS_ICON,
  restore: ARCHIVE_RESTORE_ICON,
  save: SAVE_ICON,
  scan: SCAN_ICON,
  search: SEARCH_ICON,
  send: SEND_ICON,
  server: SERVER_ICON,
  settings: SETTINGS_ICON,
  share: SHARE_2_ICON,
  shield: SHIELD_ICON,
  show: EYE_ICON,
  sidebar: PANEL_LEFT_ICON,
  sort: ARROW_UP_DOWN_ICON,
  star: STAR_ICON,
  stop: SQUARE_ICON,
  success: CIRCLE_CHECK_ICON,
  sync: REFRESH_CW_ICON,
  table: TABLE_ICON,
  tag: TAG_ICON,
  terminal: TERMINAL_ICON,
  tip: LIGHTBULB_ICON,
  toggle: TOGGLE_RIGHT_ICON,
  tune: SLIDERS_HORIZONTAL_ICON,
  undo: UNDO_2_ICON,
  unlock: LOCK_OPEN_ICON,
  up: ARROW_UP_ICON,
  upload: UPLOAD_ICON,
  user: USER_ICON,
  users: USERS_ICON,
  verified: BADGE_CHECK_ICON,
  video: VIDEO_ICON,
  volume: VOLUME_2_ICON,
  waiting: HOURGLASS_ICON,
  warning: TRIANGLE_ALERT_ICON,
  zoom: ZOOM_IN_ICON,
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
