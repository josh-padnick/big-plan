// Owns the per-side rules that let a component render twice in one document
// without the two renderings colliding: the baseline subtree is marked, its
// review identity is kept out, its ordinary DOM identity is namespaced, and
// its root affordances stay present but inert. The identity walk in
// block-identity.ts is the other half of the same contract: it skips a
// subtree this module marked, so no counter the proposed side reads can move.
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
import { COMPONENT_INSTANCE_ATTRIBUTE } from "./component-pipeline/component-instance.js";

/** Marks which snapshot a rendered side belongs to. */
export const DIFF_SIDE_ATTRIBUTE = "data-diff-side";

/** The side that is not the plan: isolated, not scrubbed. */
export const DIFF_BASELINE_SIDE = "baseline";

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
] as const;

const ROOT_AFFORDANCE_ATTRIBUTES = [
  MAXIMIZABLE_ATTRIBUTE,
  TRIGGER_ATTRIBUTE,
  BODY_ATTRIBUTE,
  COPY_SOURCE_ATTRIBUTE,
  COPY_CODE_ATTRIBUTE,
] as const;

// Properties whose value names an element id, or contains `url(#...)` /
// `href="#..."` fragments. Everything else is content: a value that happens
// to equal an id must stay as authored, including the `data-diff-side`
// mark this module just wrote.
const ARIA_ID_REFERENCE_PROPERTIES = new Set([
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);

const REFERENCE_PROPERTIES = new Set([
  "id",
  "href",
  "xlinkHref",
  "xlink:href",
  "htmlFor",
  "for",
  "form",
  "list",
  "headers",
  "itemRef",
  "popoverTarget",
  "clipPath",
  "clip-path",
  "mask",
  "fill",
  "filter",
  "style",
  ...ARIA_ID_REFERENCE_PROPERTIES,
]);

const isReferenceProperty = (property: string): boolean =>
  REFERENCE_PROPERTIES.has(property);

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
  const fingerprint = `${key}\0${[...identifiers].sort().join("\0")}`;
  let hash = 2166136261;
  for (const character of fingerprint) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `diff-baseline-${(hash >>> 0).toString(36)}-`;
};

const sanitizeIsolationKey = (key: string): string => {
  const safe = key.replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "side";
};

const rewriteReferences = ({
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
  return value.replace(
    /url\(#([^)]+)\)|#([A-Za-z][A-Za-z0-9_:-]*)/gu,
    (
      match,
      urlIdentifier: string | undefined,
      hashIdentifier: string | undefined,
    ) => {
      const identifier = urlIdentifier ?? hashIdentifier;
      if (identifier === undefined) {
        return match;
      }
      const replacement = identifiers.get(identifier);
      if (replacement === undefined) {
        return match;
      }
      return urlIdentifier === undefined
        ? `#${replacement}`
        : `url(#${replacement})`;
    },
  );
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
        if (!isReferenceProperty(property)) {
          continue;
        }
        if (typeof value === "string") {
          node.properties[property] = rewriteReferences({
            value,
            identifiers,
          });
        } else if (Array.isArray(value)) {
          node.properties[property] = value.map((entry) =>
            typeof entry === "string"
              ? rewriteReferences({ value: entry, identifiers })
              : entry,
          );
        }
      }
      if (node.tagName !== "style") {
        return;
      }
      for (const child of node.children) {
        if (child.type === "text") {
          child.value = rewriteReferences({
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

const holdRootAffordancesInert = (subtree: Element): void => {
  forEachElement({
    node: subtree,
    visit: (node) => {
      const hadLiveAffordance = ROOT_AFFORDANCE_ATTRIBUTES.some(
        (attribute) => node.properties[attribute] !== undefined,
      );
      for (const attribute of ROOT_AFFORDANCE_ATTRIBUTES) {
        delete node.properties[attribute];
      }
      if (!hadLiveAffordance) {
        return;
      }
      node.properties.inert = true;
      if (node.tagName === "button" || node.tagName === "input") {
        node.properties.disabled = true;
      }
    },
  });
};

/**
 * Applies every per-side rule to one baseline rendering: mark it, keep review
 * identity out of it, namespace its ordinary DOM identity, and hold its root
 * affordances inert so the proposed side remains the one live owner.
 *
 * `key` distinguishes two baseline subtrees that happen to carry the same
 * original ids. It is folded into the prefix, so the same subtree isolated
 * under the same key always namespaces the same way, and two copies in one
 * document do not collide. Increment 3 will pass the instance it is isolating.
 */
export const isolateBaselineSide = ({
  subtree,
  key = "side",
}: {
  readonly subtree: Element;
  readonly key?: string;
}): void => {
  subtree.properties[DIFF_SIDE_ATTRIBUTE] = DIFF_BASELINE_SIDE;
  stripReviewIdentity(subtree);
  namespaceOrdinaryIdentity(subtree, sanitizeIsolationKey(key));
  holdRootAffordancesInert(subtree);
};
