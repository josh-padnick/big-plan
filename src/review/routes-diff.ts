// The route that answers what changed between two snapshots, including the
// trusted inert markup a Was/Now lens needs to show each side as it was really
// presented rather than as re-described prose.

import { basename, extname } from "node:path";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import type { Element, Root, RootContent, ElementContent } from "hast";
import { renderDocument } from "../render/render-document.js";
import {
  compileDiffDocuments,
  renderDiffView,
} from "../render/render-diff-view.js";
import { jsonResponse, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { buildSnapshotDiff, usesRenderedSnapshot } from "./snapshot-diff.js";
import { readSnapshot } from "./store.js";
import { encodeSnapshotDiff } from "./shared/review-wire.js";
import { SNAPSHOT_DIGEST } from "./shared/change-disposition.js";

const isHastElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

// Honest rollout scaffolding. Every definition has compileDiff once the
// contract exists, so presence cannot say which kinds have completed the
// browser migration. The set leaves with the last migration wave.
const MIGRATED_DIFF_KINDS: ReadonlySet<string> = new Set(["decision"]);

const findRenderedBlock = ({
  node,
  blockId,
}: {
  readonly node: Root | Element;
  readonly blockId: string;
}): Element | null => {
  for (const child of node.children) {
    if (!isHastElement(child)) continue;
    if (child.properties.dataBlockId === blockId) return child;
    const nested = findRenderedBlock({ node: child, blockId });
    if (nested !== null) return nested;
  }
  return null;
};

/** Extracts trusted inert component markup so historical snapshots keep their real presentation. */
const renderedBlockHtml = ({
  html,
  blockId,
  namespace,
}: {
  readonly html: string;
  readonly blockId: string | undefined;
  readonly namespace: string;
}): string | undefined => {
  if (blockId === undefined) return undefined;
  const root = fromHtml(html);
  const block = findRenderedBlock({ node: root, blockId });
  if (block === null) return undefined;
  const idPrefix = `review-diff-${namespace.replaceAll(/[^a-z0-9_-]/giu, "-")}-${blockId.replaceAll(/[^a-z0-9_-]/giu, "-")}-`;
  const identifiers = new Map<string, string>();
  const collectIdentifiers = (node: Element): void => {
    if (typeof node.properties.id === "string") {
      identifiers.set(node.properties.id, `${idPrefix}${node.properties.id}`);
    }
    for (const child of node.children) {
      if (isHastElement(child)) collectIdentifiers(child);
    }
  };
  collectIdentifiers(block);
  const rewriteReferences = (value: string): string => {
    const exactReplacement = identifiers.get(value);
    if (exactReplacement !== undefined) return exactReplacement;
    const tokens = value.split(/\s+/u);
    if (tokens.length > 1 && tokens.every((token) => identifiers.has(token))) {
      return tokens.map((token) => identifiers.get(token) ?? token).join(" ");
    }
    return value.replace(
      /url\(#([^)]+)\)|#([A-Za-z][A-Za-z0-9_:-]*)/gu,
      (
        match,
        urlIdentifier: string | undefined,
        hashIdentifier: string | undefined,
      ) => {
        const identifier = urlIdentifier ?? hashIdentifier;
        if (identifier === undefined) return match;
        const replacement = identifiers.get(identifier);
        if (replacement === undefined) return match;
        return urlIdentifier === undefined
          ? `#${replacement}`
          : `url(#${replacement})`;
      },
    );
  };
  const scrubReviewIdentity = (node: Element): void => {
    delete node.properties.dataBlockId;
    delete node.properties.dataReviewSlideSelectable;
    delete node.properties.dataReviewSlideSelected;
    for (const [property, value] of Object.entries(node.properties)) {
      if (typeof value === "string") {
        node.properties[property] = rewriteReferences(value);
      } else if (Array.isArray(value)) {
        node.properties[property] = value.map((entry) =>
          typeof entry === "string" ? rewriteReferences(entry) : entry,
        );
      }
    }
    for (const child of node.children) {
      if (isHastElement(child)) scrubReviewIdentity(child);
      else if (node.tagName === "style" && child.type === "text") {
        child.value = rewriteReferences(child.value);
      }
    }
  };
  scrubReviewIdentity(block);
  return toHtml(block, { allowDangerousHtml: false });
};

export const readSnapshotDiff = async (
  context: ReviewRouteContext,
  { query }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, resolvedPlanPath } = context;
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!SNAPSHOT_DIGEST.test(from) || !SNAPSHOT_DIGEST.test(to)) {
    return refusal({
      status: 400,
      reason: "Snapshot diff requires hexadecimal from and to snapshots",
    });
  }
  let beforeSource: string;
  let afterSource: string;
  try {
    [beforeSource, afterSource] = await Promise.all([
      readSnapshot({ store, snapshot: from }),
      readSnapshot({ store, snapshot: to }),
    ]);
  } catch {
    return refusal({
      status: 404,
      reason: "This diff's baseline or result snapshot is unavailable",
    });
  }
  const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
  const before = renderDocument({
    markdown: beforeSource,
    fallbackTitle,
    identity: {},
  });
  const after = renderDocument({
    markdown: afterSource,
    fallbackTitle,
    identity: {},
  });
  const snapshotDiff = buildSnapshotDiff({
    from,
    to,
    before: before.blocks,
    after: after.blocks,
  });
  // Component diff locations share their two completed compilations. A plan
  // with no migrated roots pays no extra compile, while one with many roots
  // still compiles each snapshot only once.
  const compiledDocuments = snapshotDiff.locations.some(
    (location) =>
      location.isComponentRoot && MIGRATED_DIFF_KINDS.has(location.kind),
  )
    ? compileDiffDocuments({
        baselineMarkdown: beforeSource,
        proposedMarkdown: afterSource,
      })
    : null;
  return jsonResponse({
    status: 200,
    value: encodeSnapshotDiff({
      ...snapshotDiff,
      locations: snapshotDiff.locations.map((location) =>
        location.isComponentRoot && MIGRATED_DIFF_KINDS.has(location.kind)
          ? (() => {
              if (compiledDocuments === null) return location;
              const rendered = renderDiffView({
                baselineDocument: compiledDocuments.baseline,
                proposedDocument: compiledDocuments.proposed,
                baselineBlockId: location.oldBlockId,
                proposedBlockId: location.newBlockId,
                status: location.status,
                runs: location.runs,
              });
              return rendered === null
                ? location
                : {
                    ...location,
                    // Superseded changes still use the one legitimate copy:
                    // identity-free content in the historical archive. Keep
                    // its legacy payload until the final copy migration owns
                    // historical component rendering without identity.
                    oldHtml: renderedBlockHtml({
                      html: before.html,
                      blockId: location.oldBlockId,
                      namespace: `was-${from}`,
                    }),
                    newHtml: renderedBlockHtml({
                      html: after.html,
                      blockId: location.newBlockId,
                      namespace: `now-${to}`,
                    }),
                    diffModel: rendered.model,
                    view: rendered.view,
                  };
            })()
          : usesRenderedSnapshot(location)
            ? (() => {
                const oldHtml = renderedBlockHtml({
                  html: before.html,
                  blockId: location.oldBlockId,
                  namespace: `was-${from}`,
                });
                const newHtml = renderedBlockHtml({
                  html: after.html,
                  blockId: location.newBlockId,
                  namespace: `now-${to}`,
                });
                return {
                  ...location,
                  ...(oldHtml === undefined ? {} : { oldHtml }),
                  ...(newHtml === undefined ? {} : { newHtml }),
                };
              })()
            : location,
      ),
    }),
  });
};
