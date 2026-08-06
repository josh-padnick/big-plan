// Owns the versioned, framework-free contract for reviewer preferences.
// Browser I/O and the rendered settings surface stay at their respective
// edges; this module keeps parsing and serialization policy in one place.

export const PREFERENCES_STORAGE_KEY = "big-plan:prefs:v1";

export type AppearanceMode = "light" | "dark" | "system";

type StoredAppearanceMode = Exclude<AppearanceMode, "system">;

export type PreferencesRecord = {
  readonly version: 1;
  readonly mode?: StoredAppearanceMode;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses one persisted record and fails closed for absent or unknown data. */
export const parsePreferencesRecord = (
  raw: string | null,
): PreferencesRecord | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return null;
    if (value.mode === undefined) return { version: 1 };
    if (value.mode !== "light" && value.mode !== "dark") return null;
    return { version: 1, mode: value.mode };
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
  JSON.stringify(mode === "system" ? { version: 1 } : { version: 1, mode });
