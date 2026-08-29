// The route that answers what changed between two snapshots. Every component
// root is answered by the component's own compiled diff view; a picture,
// which carries no words, is answered by the engine replaying its compiled
// markup as inert evidence.

import {
  compileDiffDocuments,
  renderDiffView,
  renderIsolatedBlockView,
} from "../render/render-diff-view.js";
import type { DiffDocumentCompiler } from "../render/render-diff-view.js";
import { jsonResponse, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import { readSnapshot } from "./store.js";
import { SNAPSHOT_DIGEST } from "./shared/change-verdict.js";
import { encodeSnapshotDiff, type SnapshotDiff } from "./shared/review-wire.js";

class SnapshotDiffSourceUnavailable extends Error {}

/** Compiles one immutable document pair and renders every location from it. */
export const compileSnapshotDiffPayload = ({
  from,
  to,
  beforeSource,
  afterSource,
  compileDocument,
  onCompiled,
}: {
  readonly from: string;
  readonly to: string;
  readonly beforeSource: string;
  readonly afterSource: string;
  readonly compileDocument?: DiffDocumentCompiler;
  readonly onCompiled?: (documents: {
    readonly baseline: ReturnType<typeof compileDiffDocuments>["baseline"];
    readonly proposed: ReturnType<typeof compileDiffDocuments>["proposed"];
  }) => void;
}): SnapshotDiff => {
  // One compilation per snapshot answers every question this route asks: the
  // block descriptors the alignment reads, the models a component diff pairs,
  // and the compiled markup a picture replays. Nothing here re-parses a
  // rendered page, so the cost no longer grows with the number of locations.
  const compiled = compileDiffDocuments({
    baselineMarkdown: beforeSource,
    proposedMarkdown: afterSource,
    ...(compileDocument === undefined ? {} : { compileDocument }),
  });
  onCompiled?.(compiled);
  const snapshotDiff = buildSnapshotDiff({
    from,
    to,
    before: compiled.baseline.blocks,
    after: compiled.proposed.blocks,
  });
  return encodeSnapshotDiff({
    ...snapshotDiff,
    locations: snapshotDiff.locations.map((location) => {
      if (location.isComponentRoot) {
        const rendered = renderDiffView({
          baselineDocument: compiled.baseline,
          proposedDocument: compiled.proposed,
          baselineSnapshot: from,
          baselineBlockId: location.oldBlockId,
          proposedBlockId: location.newBlockId,
          status: location.status,
          runs: location.runs,
        });
        // Only the rendered view crosses the wire. The compiled diff model
        // describes exactly what that view already shows, and for a diagram
        // it carries the same prepared artwork a second time, so sending it
        // would restore the duplication this migration exists to remove. It
        // stays available to the renderer for whoever first needs to read a
        // change without reading its markup.
        return rendered === null
          ? location
          : { ...location, view: rendered.view };
      }
      if (location.kind !== "image") return location;
      const oldView = renderIsolatedBlockView({
        document: compiled.baseline,
        blockId: location.oldBlockId,
        key: `was-${from}`,
      });
      const newView = renderIsolatedBlockView({
        document: compiled.proposed,
        blockId: location.newBlockId,
        key: `now-${to}`,
      });
      return {
        ...location,
        ...(oldView === undefined ? {} : { oldView }),
        ...(newView === undefined ? {} : { newView }),
      };
    }),
  });
};

export const readSnapshotDiff = async (
  context: ReviewRouteContext,
  { query }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { snapshotDiffs, store } = context;
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!SNAPSHOT_DIGEST.test(from) || !SNAPSHOT_DIGEST.test(to)) {
    return refusal({
      status: 400,
      reason: "Snapshot diff requires hexadecimal from and to snapshots",
    });
  }
  let snapshotDiff: SnapshotDiff;
  try {
    snapshotDiff = await snapshotDiffs.forPair({
      from,
      to,
      build: async () => {
        let beforeSource: string;
        let afterSource: string;
        try {
          [beforeSource, afterSource] = await Promise.all([
            readSnapshot({ store, snapshot: from }),
            readSnapshot({ store, snapshot: to }),
          ]);
        } catch {
          throw new SnapshotDiffSourceUnavailable();
        }
        return compileSnapshotDiffPayload({
          from,
          to,
          beforeSource,
          afterSource,
          onCompiled: ({ baseline, proposed }) =>
            snapshotDiffs.retainPairBlocks({
              from,
              to,
              fromBlocks: baseline.blocks,
              toBlocks: proposed.blocks,
            }),
        });
      },
    });
  } catch (error: unknown) {
    if (!(error instanceof SnapshotDiffSourceUnavailable)) throw error;
    return refusal({
      status: 404,
      reason: "This diff's baseline or result snapshot is unavailable",
    });
  }
  return jsonResponse({
    status: 200,
    value: snapshotDiff,
  });
};
