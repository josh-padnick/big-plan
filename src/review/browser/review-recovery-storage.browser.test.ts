// Proves the persisted recovery contract rejects corrupt data and applies its
// orphan expiry and adoption-selection policy without depending on the review
// UI.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLiveReviewRecovery,
  LIVE_RECOVERY_EXPIRY_MS,
  persistedReviewFingerprint,
  readLiveReviewRecovery,
  recordLiveRecoveryAdoption,
  selectLiveReviewRecovery,
} from "./review-recovery-storage.browser.js";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  failWritesMatching: ((key: string) => boolean) | null = null;

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
    if (this.failWritesMatching?.(key) === true) {
      throw new DOMException("Storage is blocked", "SecurityError");
    }
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
  pendingAdoption = null,
}: {
  readonly ownerId: string;
  readonly updatedAtMs: number;
  readonly composer?: unknown;
  readonly pendingAdoption?: unknown;
}): string =>
  JSON.stringify({
    version: 10,
    ownerId,
    updatedAtMs,
    pendingAdoption,
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
        version: 10,
        ownerId: "corrupt-state",
        updatedAtMs: 1,
        pendingAdoption: null,
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

  it("should preserve stale owned recovery while expiring stale orphan candidates", () => {
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

    const blockedStorage = new MemoryStorage();
    blockedStorage.failWritesMatching = () => true;
    vi.stubGlobal("localStorage", blockedStorage);
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

  it("should retain pending adoption provenance until its ledger is durable", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    const pendingAdoption = { ownerId: "orphan", updatedAtMs: 5_000 };
    localStorage.setItem(
      recoveryKey("current"),
      recoveryRecord({
        ownerId: "current",
        updatedAtMs: 10_000,
        pendingAdoption,
      }),
    );
    localStorage.setItem(
      recoveryKey("orphan"),
      recoveryRecord({ ownerId: "orphan", updatedAtMs: 5_000 }),
    );
    storage.failWritesMatching = (key) => key.includes(":adoptions:");

    expect(
      recordLiveRecoveryAdoption({
        scope,
        ownerId: "current",
        recoveryOwnerId: pendingAdoption.ownerId,
        recoveryUpdatedAtMs: pendingAdoption.updatedAtMs,
        nowMs: 10_000,
      }),
    ).toBe(false);

    const reloaded = selectLiveReviewRecovery({
      scope,
      owner: { ownerId: "current", recoveryAvailable: true },
      nowMs: 11_000,
    });
    expect(reloaded.source).toBe("owned");
    expect(reloaded.recovery?.pendingAdoption).toEqual(pendingAdoption);
    expect(
      clearLiveReviewRecovery({
        scope,
        ownerId: "current",
        fingerprint: persistedReviewFingerprint({
          drafts: [],
          resolvedCommentIds: new Set(),
        }),
      }),
    ).toBe(false);
    expect(localStorage.getItem(recoveryKey("current"))).not.toBeNull();
  });
});
