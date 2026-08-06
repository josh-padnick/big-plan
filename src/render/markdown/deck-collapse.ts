// Owns the deck's collapse contract: the transform builds every collapsible
// region through this module, and the geometry (deck.css) and behavior
// (shell/viewer-script.ts) both read the resulting vocabulary. Their shared
// assumptions live here so a change to one cannot silently invalidate another.
//
// WHY THIS MODULE EXISTS
// Collapse was first built with the structure implied by the transform, the
// geometry re-derived by CSS selectors, and the hit target re-derived by
// viewer-script queries. Each concern hard-coded its own idea of where the
// header ends and the body begins. A later fix that made collapsed chips
// uniform moved slide bodies *inside* the element the viewer script used as
// its click target, which silently turned every slide body into a collapse
// button and made a sub-slide's click bubble into its parent group. Nothing
// failed loudly because no file owned the invariant. Keep it owned here.
//
// STRUCTURE INVARIANTS (deck-collapse.test.ts enforces these)
//  1. Header and body are SIBLINGS. The body is never inside the header.
//     The header is the click hit target, so anything placed in it becomes a
//     toggle; body content and nested collapsibles must stay out of it.
//  2. A nested collapsible lives only in an ancestor's BODY, never in an
//     ancestor's header. This is what makes toggles independent: a click in
//     a nested region cannot bubble into an ancestor's hit target.
//  3. The collapsible element is itself the visible frame. There is no
//     separate wrapper whose geometry could drift from the frame's.
//
// GEOMETRY MODEL (deck.css owns the numbers; this is the shape it relies on)
// The header is the containing block for [toggle, chrome]; the absolutely
// positioned toggle escapes the frame's left padding into the gutter without
// shifting the chrome, so the reading column is never indented by the control.
// Because the header holds only chrome, its height is identical collapsed and
// expanded, which makes both chevron centering and collapse geometry stable by
// construction rather than by keeping hand-tuned insets in agreement.
// Collapsing sets display:none on the body and changes nothing else.

import type { Element, ElementContent, Properties } from "hast";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { lucideIconToHast } from "./lucide-icon-hast.js";

/** Marks a collapsible region and names which deck level it is. */
export const COLLAPSIBLE_ATTRIBUTE = "data-collapsible";

/** Stable per-region key the viewer script persists collapse state under. */
export const COLLAPSE_ID_ATTRIBUTE = "data-collapse-id";

/**
 * The click hit target: chrome only (toggle, kicker, title). Never holds
 * body content or a nested collapsible - see invariants 1 and 2.
 */
export const COLLAPSE_HEADER_ATTRIBUTE = "data-collapse-header";

/** The region hidden when collapsed. Always a sibling of the header. */
export const COLLAPSE_BODY_ATTRIBUTE = "data-collapse-body";

/** The chevron control; keyboard and assistive-technology entry point. */
export const COLLAPSE_TOGGLE_ATTRIBUTE = "data-collapse-toggle";

/** The deck levels that collapse. Each renders the same canonical shape. */
export type CollapseKind = "part" | "slide" | "subslide";

// Minimal utilities only. Vertical alignment and gutter placement are
// layout concerns owned by deck.css, never per-kind margin insets.
const TOGGLE_CLASSES = [
  "plan-collapse-toggle",
  "inline-flex",
  "shrink-0",
  "cursor-pointer",
  "items-center",
  "justify-center",
  "rounded-md",
  "border-0",
  "bg-transparent",
  "p-0",
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-accent",
] as const;

const HEADER_CLASSES = [
  "plan-collapse-header",
  "relative",
  "min-w-0",
  "cursor-pointer",
] as const;

// Builds the inert collapse control; the viewer script wires behavior and the
// document stays fully readable when scripts are disabled. The chevron is the
// catalog Lucide glyph so that pointing it right (collapsed) or down
// (expanded) is a pure rotation of centered ink, leaving the icon's apparent
// position identical in both states - a chevron drawn from box borders puts
// its ink off-center, so it visibly shifts when a region toggles.
const createCollapseToggle = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    [COLLAPSE_TOGGLE_ATTRIBUTE]: "",
    "aria-expanded": "true",
    "aria-label": "Collapse",
    className: [...TOGGLE_CLASSES],
  },
  children: [lucideIconToHast({ icon: CHEVRON_RIGHT_ICON })],
});

// The hit target: the toggle beside the chrome block that stacks kicker and
// title. Callers pass chrome only (invariant 1).
const createCollapseHeader = (
  chrome: ReadonlyArray<ElementContent>,
): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    [COLLAPSE_HEADER_ATTRIBUTE]: "",
    className: [...HEADER_CLASSES],
  },
  children: [
    createCollapseToggle(),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["plan-collapse-chrome"] },
      children: [...chrome],
    },
  ],
});

/** Wraps the region hidden when collapsed. Nested collapsibles belong here. */
export const createCollapseBody = (
  children: ReadonlyArray<ElementContent>,
): Element => ({
  type: "element",
  tagName: "div",
  properties: { [COLLAPSE_BODY_ATTRIBUTE]: "" },
  children: [...children],
});

/**
 * Builds a collapsible frame: the element itself is the visible frame, and
 * its children are exactly the header and (optionally) the body.
 *
 * Body is optional only because a Part's slides are not known until its
 * following sections have been walked; finish those with appendCollapseBody
 * so the sibling invariant still holds.
 */
export const createCollapsible = ({
  kind,
  collapseId,
  tagName,
  properties,
  className,
  chrome,
  body,
}: {
  readonly kind: CollapseKind;
  readonly collapseId: string;
  readonly tagName: string;
  readonly properties?: Properties;
  readonly className: ReadonlyArray<string>;
  readonly chrome: ReadonlyArray<ElementContent>;
  readonly body?: ReadonlyArray<ElementContent>;
}): Element => ({
  type: "element",
  tagName,
  properties: {
    ...properties,
    [COLLAPSIBLE_ATTRIBUTE]: kind,
    [COLLAPSE_ID_ATTRIBUTE]: collapseId,
    className: ["plan-collapse-frame", ...className],
  },
  children: [
    createCollapseHeader(chrome),
    ...(body === undefined ? [] : [createCollapseBody(body)]),
  ],
});

/** Adds the deferred body of a frame built without one, keeping it a sibling. */
export const appendCollapseBody = ({
  host,
  children,
}: {
  readonly host: Element;
  readonly children: ReadonlyArray<ElementContent>;
}): void => {
  host.children = [...host.children, createCollapseBody(children)];
};
