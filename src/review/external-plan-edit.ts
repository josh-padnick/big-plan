// Owns the review runtime's answer to a plan file that changed on disk without
// going through the agent exchange - an outside editor (ChatGPT, Codex, a hand
// edit) writing the authoritative MDX directly.
//
// The exchange path already advances the reader onto a new revision: a
// committed response carries the snapshot it produced, and the poll observes
// it. An outside write commits no revision, so nothing moved the reader and the
// edit stayed invisible until a manual reload. This closes that gap by teaching
// the poll to notice the live file's digest moved and, when the new source is
// coherent, advancing the reader onto it exactly as a committed revision would.
// The browser then refreshes in place through the one path both cases share.
//
// Two rules keep it from navigating a reader onto a half-written file. The
// source is validated - parsed and component-checked, never rendered - before
// it moves anyone, so a transient mid-edit write is left alone until it is
// finished. And a source that failed that check is remembered by digest, so a
// file that has not changed since is not recompiled on every poll; any further
// write changes the digest and earns a fresh check.

import { readFile } from "node:fs/promises";

import {
  MarkdownDiagnosticsError,
  validatePlanSource,
} from "../render/render-document.js";
import { deriveSnapshotDigest } from "./agent-exchange.js";

/** The slice of reader progress an external edit can move. */
export type ExternalEditReaderProgress = {
  readonly currentSnapshot: () => string;
  readonly accept: (snapshot: string) => void;
};

export type ExternalPlanEditTracker = {
  /**
   * Advances the reader onto the live plan file when an outside write left it
   * on coherent content the reader has not been shown. A no-op when the file is
   * unchanged, still mid-edit, or already the reader's current snapshot -
   * including the moment a committed exchange revision the same poll observed
   * advanced onto it.
   */
  readonly settle: (
    readerProgress: ExternalEditReaderProgress,
  ) => Promise<void>;
};

export const createExternalPlanEditTracker = ({
  resolvedPlanPath,
  reportDiagnostic,
}: {
  readonly resolvedPlanPath: string;
  readonly reportDiagnostic?: (diagnostic: {
    readonly message: string;
    readonly error: unknown;
  }) => void;
}): ExternalPlanEditTracker => {
  let lastRejectedDigest: string | undefined;
  return {
    settle: async (readerProgress) => {
      let source: string;
      try {
        source = await readFile(resolvedPlanPath, "utf8");
      } catch {
        // The plan file being briefly unreadable - an editor's atomic rename
        // caught mid-swap - is not a fact to move the reader on. The next poll,
        // 1.5s away, re-reads it.
        return;
      }
      const digest = deriveSnapshotDigest(source);
      // The reader is already on this content: either the file never changed,
      // or a committed exchange revision the poll observed a moment ago already
      // advanced onto it. Clear any remembered rejection so a later edit that
      // reintroduces the same broken bytes is still re-checked.
      if (digest === readerProgress.currentSnapshot()) {
        lastRejectedDigest = undefined;
        return;
      }
      // A file whose last read failed validation and has not changed since is
      // the same half-written edit; recompiling it every poll would spend parse
      // cost on a source already known to be incoherent.
      if (digest === lastRejectedDigest) return;
      try {
        validatePlanSource({ markdown: source });
      } catch (error) {
        lastRejectedDigest = digest;
        // A parse or component failure is the expected shape of a mid-edit
        // write and earns no diagnostic; anything else is worth a line.
        if (!(error instanceof MarkdownDiagnosticsError)) {
          reportDiagnostic?.({
            message: "A plan edit outside the exchange could not be validated",
            error,
          });
        }
        return;
      }
      lastRejectedDigest = undefined;
      readerProgress.accept(digest);
    },
  };
};
