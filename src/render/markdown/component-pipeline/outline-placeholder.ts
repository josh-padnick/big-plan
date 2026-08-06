// Owns the outline-placeholder leg of HTML delivery: outline-aware
// components leave attribute-marked placeholders during component delivery,
// the deck transform reads those attributes to compute the document outline,
// and this module then replaces every placeholder with its outline-aware
// presentation. Attributes rather than element identity carry the contract,
// so a placeholder survives being re-rendered inside a parent's body.

import type { Element, ElementContent, Root, RootContent } from "hast";
import type { ReactNode } from "react";
import type { DiagnosticCollector } from "../../../components/_authoring/diagnostics.js";
import type { DocumentOutline } from "../../../components/_model/document-outline/document-outline.js";
import type { OutlineMarker } from "../../../components/_registration/define-component.js";
import { reactToHast } from "./react-hast-adapter.js";
import type { ReactHastAdapter } from "./react-hast-adapter.js";

// The placeholder contract: the index attribute names the instance's
// deferred presentation and marks any placeholder as a slide boundary, and a
// part placeholder additionally carries its act title while its anchor rides
// the ordinary id.
export const OUTLINE_PLACEHOLDER_ATTRIBUTE = "data-outline-placeholder";
export const OUTLINE_PART_TITLE_ATTRIBUTE = "data-outline-part-title";
export const OUTLINE_SLIDE_TYPE_ATTRIBUTE = "data-outline-slide-type";
export const OUTLINE_SLIDE_NAME_ATTRIBUTE = "data-outline-slide-name";
export const OUTLINE_SLIDE_TOC_ATTRIBUTE = "data-outline-slide-toc";

/** Deferred outline presentations in placeholder-index order. */
export type DeferredOutlinePresentations = Array<
  (outline: DocumentOutline) => ReactNode
>;

/** Creates one placeholder element carrying a marker's outline data. */
export const createOutlinePlaceholder = ({
  index,
  marker,
  position,
}: {
  readonly index: number;
  readonly marker: OutlineMarker;
  readonly position?: Root["position"];
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    [OUTLINE_PLACEHOLDER_ATTRIBUTE]: String(index),
    ...(marker.kind === "part"
      ? {
          [OUTLINE_PART_TITLE_ATTRIBUTE]: marker.title,
          ...(marker.id === undefined ? {} : { id: marker.id }),
        }
      : {}),
    ...(marker.kind === "slide"
      ? {
          [OUTLINE_SLIDE_TYPE_ATTRIBUTE]: marker.type,
          ...(marker.name === undefined
            ? {}
            : { [OUTLINE_SLIDE_NAME_ATTRIBUTE]: marker.name }),
          ...(marker.toc === undefined
            ? {}
            : { [OUTLINE_SLIDE_TOC_ATTRIBUTE]: marker.toc }),
        }
      : {}),
  },
  children: [],
  ...(position === undefined ? {} : { position }),
});

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

// A placeholder that cannot be presented is a renderer defect, never an
// authoring mistake, so it surfaces as an internal error.
const presentPlaceholder = ({
  placeholder,
  presentations,
  outline,
  diagnostics,
  adapt,
}: {
  readonly placeholder: Element;
  readonly presentations: DeferredOutlinePresentations;
  readonly outline: DocumentOutline;
  readonly diagnostics: DiagnosticCollector;
  readonly adapt: ReactHastAdapter;
}): Element | undefined => {
  const index = Number(placeholder.properties[OUTLINE_PLACEHOLDER_ATTRIBUTE]);
  const present = presentations[index];
  if (present === undefined) {
    diagnostics.add({
      message: `Internal error: outline placeholder ${index} has no deferred presentation`,
    });
    return undefined;
  }
  const rendered = adapt(present(outline));
  if (rendered === undefined) {
    diagnostics.add({
      message: `Internal error: outline presentation ${index} produced no element`,
    });
  }
  return rendered;
};

const completeChildren = ({
  parent,
  presentations,
  outline,
  diagnostics,
  adapt,
}: {
  readonly parent: Root | Element;
  readonly presentations: DeferredOutlinePresentations;
  readonly outline: DocumentOutline;
  readonly diagnostics: DiagnosticCollector;
  readonly adapt: ReactHastAdapter;
}): void => {
  let index = 0;
  while (index < parent.children.length) {
    const child = parent.children[index];
    if (child === undefined || !isElement(child)) {
      index += 1;
      continue;
    }
    if (child.properties[OUTLINE_PLACEHOLDER_ATTRIBUTE] === undefined) {
      completeChildren({
        parent: child,
        presentations,
        outline,
        diagnostics,
        adapt,
      });
      index += 1;
      continue;
    }
    const rendered = presentPlaceholder({
      placeholder: child,
      presentations,
      outline,
      diagnostics,
      adapt,
    });
    parent.children.splice(
      index,
      1,
      ...(rendered === undefined ? [] : [rendered]),
    );
    if (rendered !== undefined) {
      index += 1;
    }
  }
};

/** Replaces every outline placeholder with its outline-aware presentation. */
export const completeOutlinePlaceholders = ({
  tree,
  presentations,
  outline,
  diagnostics,
  adapt = reactToHast,
}: {
  readonly tree: Root;
  readonly presentations: DeferredOutlinePresentations;
  readonly outline: DocumentOutline;
  readonly diagnostics: DiagnosticCollector;
  readonly adapt?: ReactHastAdapter;
}): void => {
  completeChildren({
    parent: tree,
    presentations,
    outline,
    diagnostics,
    adapt,
  });
};
