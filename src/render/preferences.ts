// Owns the versioned, framework-free contract for reviewer preferences.
// Browser I/O and the rendered settings surface stay at their respective
// edges; this module keeps parsing and serialization policy in one place, and
// both delivered scripts derive their key, version, and allow-lists here.

export const PREFERENCES_STORAGE_KEY = "big-plan:prefs:v1";

export const PREFERENCES_RECORD_VERSION = 1;

export const STORED_APPEARANCE_MODES = ["light", "dark"] as const;

// The colour themes a reviewer can choose, in the order the settings dialog
// offers them. "default" is the product's own warm paper palette and is the
// value absence means, so it is never written to storage; the rest name a
// :root[data-palette] block in src/render/global.css.
export const PALETTES = [
  "default",
  "rose-pine",
  "nord",
  "catppuccin",
  "brutalist",
] as const;

// The subset a record may carry. Keeping the default out of storage is the
// same rule the System appearance mode already follows: absence is the value.
// A theme that has been withdrawn simply leaves this list, which makes an old
// record naming it indistinguishable from a corrupt one and sends the reviewer
// back to the product palette rather than to a theme that no longer exists.
export const STORED_PALETTES = [
  "rose-pine",
  "nord",
  "catppuccin",
  "brutalist",
] as const;

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
