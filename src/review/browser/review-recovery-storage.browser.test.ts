// Proves the persisted recovery contract rejects corrupt data and stays scoped
// to the one record this tab owns, without depending on the review UI.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLiveReviewRecovery,
  mergeRecoveredComposerAfterHydration,
  persistedReviewFingerprint,
  readLiveReviewRecovery,
  writeLiveReviewRecovery,
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
const owner = (ownerId: string) => ({ ownerId, recoveryAvailable: true });
const recoveryKey = (ownerId: string): string =>
  `big-plan:review:live-recovery:${scope.planId}:${scope.sessionId}:tab:${ownerId}`;

/** Builds the serialized public recovery record used by browser storage. */
const recoveryRecord = ({
  composer = { comment: null, replies: {} },
}: {
  readonly composer?: unknown;
} = {}): string =>
  JSON.stringify({
    version: 11,
    drafts: [],
    resolvedCommentIds: [],
    reconciliation: {
      base: { draftBodies: {}, resolvedCommentIds: [] },
      conflicts: [],
      runtime: null,
    },
    composer,
  });

const emptyReconciliation = {
  base: { draftBodies: new Map(), resolvedCommentIds: new Set<string>() },
  conflicts: [],
  runtime: null,
};

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
      JSON.stringify({ version: 11, drafts: "not-drafts" }),
    );
    localStorage.setItem(
      recoveryKey("corrupt-target"),
      recoveryRecord({
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

    expect(
      readLiveReviewRecovery({ scope, owner: owner("corrupt-state") }),
    ).toBeNull();
    expect(
      readLiveReviewRecovery({ scope, owner: owner("corrupt-target") })
        ?.composer.comment,
    ).toBeNull();
  });

  it("should read only the record this tab owns", () => {
    // Two tabs of one session keep separate records. They reconcile through
    // the runtime, never through each other's storage; issue #99 owns the
    // case where neither reaches the runtime.
    localStorage.setItem(recoveryKey("other-tab"), recoveryRecord());

    expect(readLiveReviewRecovery({ scope, owner: owner("this-tab") })).toBe(
      null,
    );
    expect(localStorage.getItem(recoveryKey("other-tab"))).not.toBeNull();
  });

  it("should report a failed write instead of pretending recovery is available", () => {
    const blocked = new MemoryStorage();
    blocked.failWritesMatching = () => true;
    vi.stubGlobal("localStorage", blocked);

    expect(
      writeLiveReviewRecovery({
        scope,
        ownerId: "this-tab",
        recovery: {
          drafts: [],
          resolvedCommentIds: new Set(),
          composer: { comment: null, replies: new Map() },
          reconciliation: emptyReconciliation,
        },
      }),
    ).toBe(false);
  });

  it("should recover nothing when storage is unavailable to this tab", () => {
    localStorage.setItem(recoveryKey("this-tab"), recoveryRecord());

    expect(
      readLiveReviewRecovery({
        scope,
        owner: { ownerId: "this-tab", recoveryAvailable: false },
      }),
    ).toBeNull();
  });

  it("should clear a synchronized record and keep one still holding typed text", () => {
    const fingerprint = persistedReviewFingerprint({
      drafts: [],
      resolvedCommentIds: new Set(),
    });
    localStorage.setItem(
      recoveryKey("typed"),
      recoveryRecord({
        composer: { comment: null, replies: { thread: "half written" } },
      }),
    );
    localStorage.setItem(recoveryKey("synced"), recoveryRecord());

    expect(
      clearLiveReviewRecovery({ scope, ownerId: "typed", fingerprint }),
    ).toBe(false);
    expect(localStorage.getItem(recoveryKey("typed"))).not.toBeNull();
    expect(
      clearLiveReviewRecovery({ scope, ownerId: "synced", fingerprint }),
    ).toBe(true);
    expect(localStorage.getItem(recoveryKey("synced"))).toBeNull();
  });

  it("should keep browser-only input created while hydration is pending", () => {
    const before = {
      comment: null,
      replies: new Map([["existing", "before"]]),
    };
    const current = {
      comment: {
        target: { type: "document" } as const,
        premiseSnapshot: "snapshot",
        body: "typed while loading",
      },
      replies: new Map([
        ["existing", "edited while loading"],
        ["new", "new reply"],
      ]),
    };
    const recovered = {
      comment: null,
      replies: new Map([
        ["existing", "recovered"],
        ["restored", "restored reply"],
      ]),
    };

    expect(
      mergeRecoveredComposerAfterHydration({ before, current, recovered }),
    ).toEqual({
      comment: current.comment,
      replies: new Map([
        ["existing", "edited while loading"],
        ["new", "new reply"],
        ["restored", "restored reply"],
      ]),
    });
  });
});
