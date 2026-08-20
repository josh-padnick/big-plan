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

const FRAGMENT_REFERENCE_PROPERTIES = new Set([
  "href",
  "xLinkHref",
]);

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

const holdRootAffordancesInert = (subtree: Element): void => {
  subtree.properties.inert = true;
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
 * `key` is required so two baseline subtrees that carry the same original
 * ids cannot silently collide. It is folded into the prefix: the same
 * subtree under the same key always namespaces the same way, and two copies
 * in one document do not collide. Increment 3 will pass the instance it is
 * isolating.
 */
export const isolateBaselineSide = ({
  subtree,
  key,
}: {
  readonly subtree: Element;
  readonly key: string;
}): void => {
  subtree.properties[DIFF_SIDE_ATTRIBUTE] = DIFF_BASELINE_SIDE;
  stripReviewIdentity(subtree);
  namespaceOrdinaryIdentity(subtree, key);
  holdRootAffordancesInert(subtree);
};
