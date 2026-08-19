// Owns the versioned, framework-free contract for reviewer preferences.
// Browser I/O and the rendered settings surface stay at their respective
// edges; this module keeps parsing and serialization policy in one place, and
// both delivered scripts derive their key, version, and allow-lists here.

import { PALETTES, STORED_PALETTES } from "./preference-options.js";

export { PALETTES, STORED_PALETTES };

export const PREFERENCES_STORAGE_KEY = "big-plan:prefs:v1";

export const PREFERENCES_RECORD_VERSION = 1;

export const STORED_APPEARANCE_MODES = ["light", "dark"] as const;

type StoredAppearanceMode = (typeof STORED_APPEARANCE_MODES)[number];

type StoredPalette = (typeof STORED_PALETTES)[number];

export type AppearanceMode = StoredAppearanceMode | "system";

export type Palette = (typeof PALETTES)[number];

export type PreferencesRecord = {
  readonly version: typeof PREFERENCES_RECORD_VERSION;
  readonly mode?: StoredAppearanceMode;
  readonly palette?: StoredPalette;
};

const isStoredMode = (value: unknown): value is StoredAppearanceMode =>
  STORED_APPEARANCE_MODES.some((mode) => mode === value);

const isStoredPalette = (value: unknown): value is StoredPalette =>
  STORED_PALETTES.some((palette) => palette === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses one persisted record and fails closed for absent or unknown data. A
 * field the build does not recognize invalidates the whole record rather than
 * being dropped, so a reviewer never sees half a restored preference.
 */
export const parsePreferencesRecord = (
  raw: string | null,
): PreferencesRecord | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PREFERENCES_RECORD_VERSION) {
      return null;
    }
    if (value.mode !== undefined && !isStoredMode(value.mode)) return null;
    if (value.palette !== undefined && !isStoredPalette(value.palette)) {
      return null;
    }
    return {
      version: PREFERENCES_RECORD_VERSION,
      ...(value.mode === undefined ? {} : { mode: value.mode }),
      ...(value.palette === undefined ? {} : { palette: value.palette }),
    };
  } catch {
    return null;
  }
};

/** Converts absence of a stored mode into the system-following UI value. */
export const appearanceModeFromRecord = (
  record: PreferencesRecord | null,
): AppearanceMode => record?.mode ?? "system";

/** Converts absence of a stored palette into the product's own palette. */
export const paletteFromRecord = (record: PreferencesRecord | null): Palette =>
  record?.palette ?? "default";

/** Serializes the one-record contract, omitting both defaults. */
export const serializePreferencesRecord = ({
  mode,
  palette,
}: {
  readonly mode: AppearanceMode;
  readonly palette: Palette;
}): string =>
  JSON.stringify({
    version: PREFERENCES_RECORD_VERSION,
    ...(mode === "system" ? {} : { mode }),
    ...(palette === "default" ? {} : { palette }),
  });

// The covering note the reviewer sends with a plan approval. It is deliberately
// global rather than plan-scoped: one message for every plan, so the reviewer
// writes it once. It lives beside the appearance record rather than inside it
// because the two are written by different controls at different moments, and a
// whole-record write of one must never clobber the other.
export const APPROVAL_MESSAGE_STORAGE_KEY = "big-plan:approval-message:v1";

export const APPROVAL_MESSAGE_RECORD_VERSION = 1;

// A covering note, not a document: past this the message stops being something
// a reviewer skims beside the approval and starts being a plan of its own.
export const APPROVAL_MESSAGE_LIMIT = 2000;

export const DEFAULT_APPROVAL_MESSAGE =
  "This plan is approved and we are ready to begin. Start on it now and check in when the first stage is done.";

export type ApprovalMessageRecord = {
  readonly version: typeof APPROVAL_MESSAGE_RECORD_VERSION;
  readonly message: string;
};

/**
 * Parses the persisted approval message and fails closed, exactly as
 * {@link parsePreferencesRecord} does: anything this build does not recognize,
 * including a message past the bound, sends the reviewer back to the default
 * rather than to half a restored note.
 */
export const parseApprovalMessageRecord = (
  raw: string | null,
): ApprovalMessageRecord | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== APPROVAL_MESSAGE_RECORD_VERSION ||
      typeof value.message !== "string" ||
      value.message.length > APPROVAL_MESSAGE_LIMIT
    ) {
      return null;
    }
    return {
      version: APPROVAL_MESSAGE_RECORD_VERSION,
      message: value.message,
    };
  } catch {
    return null;
  }
};

/**
 * Resolves what will actually be sent. A blank note is not a note, so an empty
 * message means the default rather than an approval that says nothing.
 */
export const approvalMessageFromRecord = (
  record: ApprovalMessageRecord | null,
): string => {
  const message = record?.message.trim() ?? "";
  return message === "" ? DEFAULT_APPROVAL_MESSAGE : message;
};

/** Serializes the one-record contract for a message worth storing. */
export const serializeApprovalMessageRecord = (message: string): string =>
  JSON.stringify({
    version: APPROVAL_MESSAGE_RECORD_VERSION,
    message: message.slice(0, APPROVAL_MESSAGE_LIMIT),
  });
