// Owns the per-side rules that let a component render twice in one document
// without the two renderings colliding: the baseline subtree is marked, its
// review identity is kept out, its ordinary DOM identity is namespaced, and
// its root affordances stay present but inert - except for the subtrees a
// component's diff view marked live, which hold evidence only the baseline
// has. The identity walk in block-identity.ts is the other half of the
// same contract: it skips a subtree this module marked, so no counter the
// proposed side reads can move.
//
// Later increments render a component twice through this module's one entry.
// The rules fail silently when they are absent - duplicate `id`s, shifted
// block addresses, two live maximize triggers - which is why they live here
// rather than as a defensive pass at the far end of the pipeline.

import type { Element, ElementContent, RootContent } from "hast";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
  TRIGGER_ATTRIBUTE,
} from "../../components/_model/figure-controls/figure-controls.js";
import { DIFF_LIVE_ATTRIBUTE } from "../../components/_model/component-diff/contract.js";
import { COMPONENT_INSTANCE_ATTRIBUTE } from "./component-pipeline/component-instance.js";

/** Marks which snapshot a rendered side belongs to. */
export const DIFF_SIDE_ATTRIBUTE = "data-diff-side";

/** The side that is not the plan: isolated, not scrubbed. */
export const DIFF_BASELINE_SIDE = "baseline";
export const BASELINE_BLOCK_ID_ATTRIBUTE = "data-baseline-block-id";
export const BASELINE_SNAPSHOT_ATTRIBUTE = "data-baseline-snapshot";

const COPY_SOURCE_ATTRIBUTE = "data-copy-source";
const COPY_CODE_ATTRIBUTE = "data-copy-code";

// Review identity this walk is not allowed to leave on a baseline side. The
// proposed side's identity walk never enters the subtree, so a clone that
// arrived already stamped would otherwise publish a second copy of every
// address a comment could still resolve.
const REVIEW_IDENTITY_ATTRIBUTES = [
  "data-block-id",
  "data-block-kind",
  "data-block-label",
  "data-block-section",
  "data-block-line",
  "data-block-line-side",
  "data-review-slide-selectable",
  "data-review-slide-selected",
  COMPONENT_INSTANCE_ATTRIBUTE,
  BASELINE_BLOCK_ID_ATTRIBUTE,
  BASELINE_SNAPSHOT_ATTRIBUTE,
  "data-baseline-block-kind",
  "data-baseline-block-label",
  "data-baseline-block-section",
] as const;

const ROOT_AFFORDANCE_ATTRIBUTES = [
  MAXIMIZABLE_ATTRIBUTE,
  TRIGGER_ATTRIBUTE,
  BODY_ATTRIBUTE,
  COPY_SOURCE_ATTRIBUTE,
  COPY_CODE_ATTRIBUTE,
] as const;

const ARIA_ID_REFERENCE_PROPERTIES = new Set([
  "ariaActiveDescendant",
  "ariaControls",
  "ariaDescribedBy",
  "ariaDetails",
  "ariaErrorMessage",
  "ariaFlowTo",
  "ariaLabelledBy",
  "ariaOwns",
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);

const ID_REFERENCE_PROPERTIES = new Set([
  "id",
  "htmlFor",
  "for",
  "form",
  "list",
  "headers",
  "itemRef",
  "popoverTarget",
  ...ARIA_ID_REFERENCE_PROPERTIES,
]);

const FRAGMENT_REFERENCE_PROPERTIES = new Set(["href", "xLinkHref"]);

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

/** True when this element is the root of an isolated baseline subtree. */
export const isBaselineDiffSide = (node: Element): boolean =>
  node.properties[DIFF_SIDE_ATTRIBUTE] === DIFF_BASELINE_SIDE;

const forEachElement = ({
  node,
  visit,
}: {
  readonly node: Element;
  readonly visit: (candidate: Element) => void;
}): void => {
  visit(node);
  for (const child of node.children) {
    if (isElement(child)) {
      forEachElement({ node: child, visit });
    }
  }
};

const identityPrefixFor = ({
  identifiers,
  key,
}: {
  readonly identifiers: ReadonlyArray<string>;
  readonly key: string;
}): string => {
  const encodedKey = Buffer.from(key, "utf8").toString("base64url");
  const fingerprint = `${encodedKey}\0${[...identifiers].sort().join("\0")}`;
  let hash = 2166136261;
  for (const character of fingerprint) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `diff-baseline-${encodedKey}-${(hash >>> 0).toString(36)}-`;
};

const rewriteIdentifierReferences = ({
  value,
  identifiers,
}: {
  readonly value: string;
  readonly identifiers: ReadonlyMap<string, string>;
}): string => {
  const exactReplacement = identifiers.get(value);
  if (exactReplacement !== undefined) {
    return exactReplacement;
  }
  const tokens = value.split(/\s+/u);
  if (tokens.length > 1 && tokens.some((token) => identifiers.has(token))) {
    return tokens.map((token) => identifiers.get(token) ?? token).join(" ");
  }
  return value;
};

const rewriteFragmentReference = ({
  value,
  identifiers,
}: {
  readonly value: string;
  readonly identifiers: ReadonlyMap<string, string>;
}): string => {
  if (!value.startsWith("#")) {
    return value;
  }
  const replacement = identifiers.get(value.slice(1));
  return replacement === undefined ? value : `#${replacement}`;
};

const rewriteUrlReferences = ({
  value,
  identifiers,
}: {
  readonly value: string;
  readonly identifiers: ReadonlyMap<string, string>;
}): string =>
  value.replace(
    /url\(\s*(?:(["'])#([^"']+)\1|#([^)]+?))\s*\)/giu,
    (
      match,
      _quote: string | undefined,
      quotedIdentifier: string | undefined,
      unquotedIdentifier: string | undefined,
    ) => {
      const identifier = quotedIdentifier ?? unquotedIdentifier?.trim();
      if (identifier === undefined) {
        return match;
      }
      const replacement = identifiers.get(identifier);
      if (replacement === undefined) {
        return match;
      }
      return `url(#${replacement})`;
    },
  );

const rewritePropertyReferences = ({
  property,
  value,
  identifiers,
}: {
  readonly property: string;
  readonly value: string;
  readonly identifiers: ReadonlyMap<string, string>;
}): string => {
  if (ID_REFERENCE_PROPERTIES.has(property)) {
    return rewriteIdentifierReferences({ value, identifiers });
  }
  if (FRAGMENT_REFERENCE_PROPERTIES.has(property)) {
    return rewriteFragmentReference({ value, identifiers });
  }
  return rewriteUrlReferences({ value, identifiers });
};

const namespaceOrdinaryIdentity = (
  subtree: Element,
  isolationKey: string,
): void => {
  const originalIds: Array<string> = [];
  forEachElement({
    node: subtree,
    visit: (node) => {
      if (typeof node.properties.id === "string") {
        originalIds.push(node.properties.id);
      }
    },
  });
  if (originalIds.length === 0) {
    return;
  }
  const prefix = identityPrefixFor({
    identifiers: originalIds,
    key: isolationKey,
  });
  const identifiers = new Map(
    originalIds.map((id) => [id, `${prefix}${id}`] as const),
  );
  forEachElement({
    node: subtree,
    visit: (node) => {
      for (const [property, value] of Object.entries(node.properties)) {
        if (typeof value === "string") {
          node.properties[property] = rewritePropertyReferences({
            property,
            value,
            identifiers,
          });
        } else if (Array.isArray(value)) {
          node.properties[property] = value.map((entry) =>
            typeof entry === "string"
              ? rewritePropertyReferences({
                  property,
                  value: entry,
                  identifiers,
                })
              : entry,
          );
        }
      }
      if (node.tagName !== "style") {
        return;
      }
      for (const child of node.children) {
        if (child.type === "text") {
          child.value = rewriteUrlReferences({
            value: child.value,
            identifiers,
          });
        }
      }
    },
  });
};

const stripReviewIdentity = (subtree: Element): void => {
  forEachElement({
    node: subtree,
    visit: (node) => {
      for (const attribute of REVIEW_IDENTITY_ATTRIBUTES) {
        delete node.properties[attribute];
      }
    },
  });
};

const stampBaselineIdentity = ({
  subtree,
  baselineBlockId,
  baselineSnapshot,
  baselineSubtargetIds,
}: {
  readonly subtree: Element;
  readonly baselineBlockId: string | undefined;
  readonly baselineSnapshot: string | undefined;
  readonly baselineSubtargetIds: ReadonlyMap<Element, string> | undefined;
}): void => {
  const stamp = (node: Element, blockId: string): void => {
    node.properties[BASELINE_BLOCK_ID_ATTRIBUTE] = blockId;
    if (baselineSnapshot !== undefined) {
      node.properties[BASELINE_SNAPSHOT_ATTRIBUTE] = baselineSnapshot;
    }
  };
  if (baselineBlockId !== undefined) {
    stamp(subtree, baselineBlockId);
  }
  baselineSubtargetIds?.forEach((blockId, node) => stamp(node, blockId));
};

// Every element on a path from the isolated root down to a subtree the
// component's diff view marked live. `inert` is inherited and a descendant
// cannot opt back out of an inert ancestor, so a marked subtree can only
// stay live when no ancestor of it is marked inert.
const livePathsWithin = (subtree: Element): ReadonlySet<Element> => {
  const paths = new Set<Element>();
  const visit = (node: Element): boolean => {
    let live = node.properties[DIFF_LIVE_ATTRIBUTE] !== undefined;
    for (const child of node.children) {
      if (isElement(child) && visit(child)) {
        live = true;
      }
    }
    if (live) {
      paths.add(node);
    }
    return live;
  };
  visit(subtree);
  return paths;
};

// Holds each maximal subtree that leads to no mark inert, so a baseline with
// no mark at all is one inert root exactly as before.
const markInertOutsideLiveSubtrees = ({
  node,
  paths,
}: {
  readonly node: Element;
  readonly paths: ReadonlySet<Element>;
}): void => {
  if (node.properties[DIFF_LIVE_ATTRIBUTE] !== undefined) {
    return;
  }
  if (!paths.has(node)) {
    node.properties.inert = true;
    return;
  }
  for (const child of node.children) {
    if (isElement(child)) {
      markInertOutsideLiveSubtrees({ node: child, paths });
    }
  }
};

// Root affordances leave with their attributes wherever they sit, so no
// script wires a second copy. Only an affordance outside every marked
// subtree is additionally frozen: freezing one inside would re-create, one
// element lower, the dead control the mark exists to prevent.
const stripRootAffordances = ({
  node,
  paths,
  insideLive,
}: {
  readonly node: Element;
  readonly paths: ReadonlySet<Element>;
  readonly insideLive: boolean;
}): void => {
  const live = insideLive || node.properties[DIFF_LIVE_ATTRIBUTE] !== undefined;
  const hadLiveAffordance = ROOT_AFFORDANCE_ATTRIBUTES.some(
    (attribute) => node.properties[attribute] !== undefined,
  );
  for (const attribute of ROOT_AFFORDANCE_ATTRIBUTES) {
    delete node.properties[attribute];
  }
  if (hadLiveAffordance && !live && !paths.has(node)) {
    node.properties.inert = true;
    if (node.tagName === "button" || node.tagName === "input") {
      node.properties.disabled = true;
    }
  }
  for (const child of node.children) {
    if (isElement(child)) {
      stripRootAffordances({ node: child, paths, insideLive: live });
    }
  }
};

const holdRootAffordancesInert = (subtree: Element): void => {
  const paths = livePathsWithin(subtree);
  markInertOutsideLiveSubtrees({ node: subtree, paths });
  stripRootAffordances({ node: subtree, paths, insideLive: false });
};

export type BaselineBlockAddress = {
  readonly blockId: string;
  readonly kind: string;
  readonly label: string;
  readonly section?: string;
};

const stampBaselineIdentity = ({
  subtree,
  snapshot,
  addressFor,
}: {
  readonly subtree: Element;
  readonly snapshot: string;
  readonly addressFor: (node: Element) => BaselineBlockAddress | undefined;
}): void => {
  forEachElement({
    node: subtree,
    visit: (node) => {
      const address = addressFor(node);
      if (address === undefined) return;
      node.properties["data-baseline-block-id"] = address.blockId;
      node.properties["data-baseline-snapshot"] = snapshot;
      node.properties["data-baseline-block-kind"] = address.kind;
      node.properties["data-baseline-block-label"] = address.label;
      if (address.section === undefined) {
        delete node.properties["data-baseline-block-section"];
      } else {
        node.properties["data-baseline-block-section"] = address.section;
      }
    },
  });
};

/**
 * Applies every per-side rule to one baseline rendering: mark it, keep review
 * identity out of it, namespace its ordinary DOM identity, and hold its root
 * affordances inert so the proposed side remains the one live owner.
 *
 * A subtree the view marked with `DIFF_LIVE_ATTRIBUTE` stays live, and only
 * the subtrees that lead nowhere near a mark are held inert. That exception
 * exists because a baseline can hold evidence the proposed side does not - a
 * screen the change removed - and a badge naming a screen no click can open
 * reads as a defect rather than as history.
 *
 * `key` is required so two baseline subtrees that carry the same original
 * ids cannot silently collide. It is folded into the prefix: the same
 * subtree under the same key always namespaces the same way, and two copies
 * in one document do not collide. Increment 3 will pass the instance it is
 * isolating.
 */
export const isolateBaselineSide = ({
  subtree,
  key,
  snapshot,
  addressFor,
}: {
  readonly subtree: Element;
  readonly key: string;
  readonly snapshot?: string;
  readonly addressFor?: (node: Element) => BaselineBlockAddress | undefined;
}): void => {
  subtree.properties[DIFF_SIDE_ATTRIBUTE] = DIFF_BASELINE_SIDE;
  stripReviewIdentity(subtree);
  if (snapshot !== undefined && addressFor !== undefined) {
    stampBaselineIdentity({ subtree, snapshot, addressFor });
  }
  namespaceOrdinaryIdentity(subtree, key);
  holdRootAffordancesInert(subtree);
};
