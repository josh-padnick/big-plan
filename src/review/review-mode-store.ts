// Owns the session-scoped auto-accept mode record. Review is represented by
// absence, and an armed record is usable only while the current session
// descriptor still names the session that wrote it.

import { unlink } from "node:fs/promises";
import {
  readSessionDescriptorValue,
  readStoreJson,
  writeStoreJson,
  type ReviewStore,
} from "./store.js";

const SESSION_ID = /^[a-f0-9]{16}$/u;

export type ArmedReviewMode = {
  readonly version: 1;
  readonly mode: "auto-accept";
  readonly sessionId: string;
  readonly armedAtMs: number;
};

export type ReviewModeState =
  | { readonly mode: "review" }
  | { readonly mode: "auto-accept"; readonly armedAtMs: number };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates the singleton non-default mode record without guessing at damage. */
export const validateArmedReviewMode = (
  value: unknown,
): ArmedReviewMode | undefined => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.mode !== "auto-accept" ||
    typeof value.sessionId !== "string" ||
    !SESSION_ID.test(value.sessionId) ||
    typeof value.armedAtMs !== "number" ||
    !Number.isSafeInteger(value.armedAtMs) ||
    value.armedAtMs < 0
  ) {
    return undefined;
  }
  return {
    version: 1,
    mode: "auto-accept",
    sessionId: value.sessionId,
    armedAtMs: value.armedAtMs,
  };
};

/** Reads auto-accept only when the record belongs to the named runtime. */
export const readReviewModeForSession = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<ReviewModeState> => {
  const armed = validateArmedReviewMode(
    await readStoreJson(store.reviewModePath),
  );
  return armed?.sessionId === sessionId
    ? { mode: "auto-accept", armedAtMs: armed.armedAtMs }
    : { mode: "review" };
};

/**
 * Reads the armed record for a committing process.
 *
 * The mode file alone is insufficient: an old process can outlive the runtime
 * that armed it. Matching the authoritative session descriptor is what makes a
 * restart move safely back to review even before boot cleanup removes the old
 * file.
 */
export const readActiveArmedReviewMode = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ArmedReviewMode | undefined> => {
  const [armedValue, sessionValue] = await Promise.all([
    readStoreJson(store.reviewModePath),
    readSessionDescriptorValue(store),
  ]);
  const armed = validateArmedReviewMode(armedValue);
  if (
    armed === undefined ||
    !isRecord(sessionValue) ||
    sessionValue.sessionId !== armed.sessionId
  ) {
    return undefined;
  }
  return armed;
};

/** Arms auto-accept for exactly one runtime session. */
export const writeArmedReviewMode = async ({
  store,
  sessionId,
  armedAtMs,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly armedAtMs: number;
}): Promise<ArmedReviewMode> => {
  const mode = validateArmedReviewMode({
    version: 1,
    mode: "auto-accept",
    sessionId,
    armedAtMs,
  });
  if (mode === undefined) {
    throw new Error("The review mode record is not usable");
  }
  await writeStoreJson({ path: store.reviewModePath, value: mode });
  return mode;
};

/** Returns the review to its default mode by removing the singleton slot. */
export const clearReviewMode = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<void> => {
  try {
    await unlink(store.reviewModePath);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
};

/** Removes a corrupt or previous-session mode record during runtime boot. */
export const clearStaleReviewMode = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<void> => {
  const stored = await readStoreJson(store.reviewModePath);
  if (stored === undefined) return;
  const armed = validateArmedReviewMode(stored);
  if (armed?.sessionId === sessionId) return;
  await clearReviewMode({ store });
};
