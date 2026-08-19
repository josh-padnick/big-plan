// The browser island's copy of the persisted approval-message contract. The
// island may import nothing from the renderer, so the key, the version, the
// bound, and the default wording are mirrored here by construction, the same
// way review-wire.ts mirrors agent-exchange.ts. src/render/preferences.ts is
// the original; src/render/preferences.test.ts asserts the two stay
// byte-identical, so the mirror cannot drift without a test failing.

export const APPROVAL_MESSAGE_STORAGE_KEY = "big-plan:approval-message:v1";

export const APPROVAL_MESSAGE_RECORD_VERSION = 1;

export const APPROVAL_MESSAGE_LIMIT = 2000;

export const DEFAULT_APPROVAL_MESSAGE =
  "This plan is approved and we are ready to begin. Start on it now and check in when the first stage is done.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resolves the covering note an approval would actually carry from whatever is
 * in storage. Absent, unreadable, over-long, and blank all mean the default, so
 * a reviewer can never send an approval with nothing said in it.
 */
export const effectiveApprovalMessage = (raw: string | null): string => {
  if (raw === null) return DEFAULT_APPROVAL_MESSAGE;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== APPROVAL_MESSAGE_RECORD_VERSION ||
      typeof value.message !== "string" ||
      value.message.length > APPROVAL_MESSAGE_LIMIT
    ) {
      return DEFAULT_APPROVAL_MESSAGE;
    }
    const message = value.message.trim();
    return message === "" ? DEFAULT_APPROVAL_MESSAGE : message;
  } catch {
    return DEFAULT_APPROVAL_MESSAGE;
  }
};
