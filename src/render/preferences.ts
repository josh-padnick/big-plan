// Owns the versioned, framework-free contract for reviewer preferences.
// Browser I/O and the rendered settings surface stay at their respective
// edges; this module keeps parsing and serialization policy in one place, and
// both delivered scripts derive their key, version, and mode allow-list here.

export const PREFERENCES_STORAGE_KEY = "big-plan:prefs:v1";

export const PREFERENCES_RECORD_VERSION = 1;

export const STORED_APPEARANCE_MODES = ["light", "dark"] as const;

type StoredAppearanceMode = (typeof STORED_APPEARANCE_MODES)[number];

export type AppearanceMode = StoredAppearanceMode | "system";

export type PreferencesRecord = {
  readonly version: typeof PREFERENCES_RECORD_VERSION;
  readonly mode?: StoredAppearanceMode;
};

const isStoredMode = (value: unknown): value is StoredAppearanceMode =>
  STORED_APPEARANCE_MODES.some((mode) => mode === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses one persisted record and fails closed for absent or unknown data. */
export const parsePreferencesRecord = (
  raw: string | null,
): PreferencesRecord | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PREFERENCES_RECORD_VERSION) {
      return null;
    }
    if (value.mode === undefined) {
      return { version: PREFERENCES_RECORD_VERSION };
    }
    if (!isStoredMode(value.mode)) return null;
    return { version: PREFERENCES_RECORD_VERSION, mode: value.mode };
  } catch {
    return null;
  }
};

/** Converts absence of a stored mode into the system-following UI value. */
export const appearanceModeFromRecord = (
  record: PreferencesRecord | null,
): AppearanceMode => record?.mode ?? "system";

/** Serializes the one-record contract, omitting System as the default. */
export const serializePreferencesRecord = (mode: AppearanceMode): string =>
  JSON.stringify(
    mode === "system"
      ? { version: PREFERENCES_RECORD_VERSION }
      : { version: PREFERENCES_RECORD_VERSION, mode },
  );
