// Proves the persisted recovery contract rejects corrupt data and applies its
// expiry and adoption-selection policy without depending on the review UI.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_RECOVERY_EXPIRY_MS,
  readLiveReviewRecovery,
  recordLiveRecoveryAdoption,
  selectLiveReviewRecovery,
} from "./review-recovery-storage.browser.js";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

const scope = { planId: "plan", sessionId: "session" };
const recoveryKey = (ownerId: string): string =>
  `big-plan:review:live-recovery:${scope.planId}:${scope.sessionId}:tab:${ownerId}`;

/** Builds the serialized public recovery record used by browser storage. */
const recoveryRecord = ({
  ownerId,
  updatedAtMs,
  composer = { comment: null, replies: {} },
}: {
  readonly ownerId: string;
  readonly updatedAtMs: number;
  readonly composer?: unknown;
}): string =>
  JSON.stringify({
    version: 9,
    ownerId,
    updatedAtMs,
    drafts: [],
    resolvedCommentIds: [],
    reconciliation: {
      base: { draftBodies: {}, resolvedCommentIds: [] },
      conflicts: [],
      runtime: null,
    },
    composer,
  });

describe("live review recovery storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should reject malformed recovery state and discard an invalid composer target", () => {
    localStorage.setItem(
      recoveryKey("corrupt-state"),
      JSON.stringify({
        version: 9,
        ownerId: "corrupt-state",
        updatedAtMs: 1,
        drafts: "not-drafts",
      }),
    );
    localStorage.setItem(
      recoveryKey("corrupt-target"),
      recoveryRecord({
        ownerId: "corrupt-target",
        updatedAtMs: 2,
        composer: {
          comment: {
            target: {
              type: "selection",
              blockId: "p1",
              endBlockId: "p1",
              kind: "paragraph",
              label: "Paragraph",
              start: 0,
              end: 1,
              quote: "A",
              isQuoteExcerpt: false,
              imageBlockIds: [42],
            },
            premiseSnapshot: "snapshot",
            body: "unsafe",
          },
          replies: {},
        },
      }),
    );

    expect(readLiveReviewRecovery(recoveryKey("corrupt-state"))).toBeNull();
    expect(
      readLiveReviewRecovery(recoveryKey("corrupt-target"))?.composer.comment,
    ).toBeNull();
  });

  it("should prefer owned recovery and expire stale orphan candidates", () => {
    const nowMs = LIVE_RECOVERY_EXPIRY_MS + 1_000;
    localStorage.setItem(
      recoveryKey("owned"),
      recoveryRecord({ ownerId: "owned", updatedAtMs: 100 }),
    );
    localStorage.setItem(
      recoveryKey("newer-orphan"),
      recoveryRecord({ ownerId: "newer-orphan", updatedAtMs: nowMs }),
    );
    localStorage.setItem(
      recoveryKey("expired-orphan"),
      recoveryRecord({ ownerId: "expired-orphan", updatedAtMs: 0 }),
    );

    const selected = selectLiveReviewRecovery({
      scope,
      owner: { ownerId: "owned", recoveryAvailable: true },
      nowMs,
    });

    expect(selected.source).toBe("owned");
    expect(selected.recovery?.ownerId).toBe("owned");
    expect(localStorage.getItem(recoveryKey("expired-orphan"))).toBeNull();
  });

  it("should skip an adopted revision and report a failed ledger write", () => {
    const nowMs = 10_000;
    localStorage.setItem(
      recoveryKey("orphan"),
      recoveryRecord({ ownerId: "orphan", updatedAtMs: 5_000 }),
    );
    expect(
      recordLiveRecoveryAdoption({
        scope,
        ownerId: "current",
        recoveryOwnerId: "orphan",
        recoveryUpdatedAtMs: 5_000,
        nowMs,
      }),
    ).toBe(true);
    expect(
      selectLiveReviewRecovery({
        scope,
        owner: { ownerId: "current", recoveryAvailable: true },
        nowMs,
      }).recovery,
    ).toBeNull();

    vi.stubGlobal("localStorage", {
      ...new MemoryStorage(),
      setItem: (): never => {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });
    expect(
      recordLiveRecoveryAdoption({
        scope,
        ownerId: "current",
        recoveryOwnerId: "other",
        recoveryUpdatedAtMs: 9_000,
        nowMs,
      }),
    ).toBe(false);
  });
});
