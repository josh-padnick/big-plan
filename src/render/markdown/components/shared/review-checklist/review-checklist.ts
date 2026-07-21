// Owns the Review checklist contract and presentation shared by the protocol
// review cards: one optional attribute-free Review child whose markdown body
// (typically a task list) closes the card with the architectural questions a
// reviewer should answer before implementation. Modules in shared/ are never
// authorable from MDX; the registered component directories beside shared/
// declare the Review scoped child and delegate here.

import type { Element, ElementContent } from "hast";
import { CLIPBOARD_CHECK_ICON } from "../../../../icons/lucide/clipboard-check.js";
import { renderLucideIcon } from "../../../../icons/lucide-icon.js";
import {
  validateComponentAttributes,
  type ScopedChild,
} from "../../component-contract.js";
import type { DiagnosticCollector } from "../../diagnostics.js";
import {
  renderCardSection,
  renderSectionLabel,
} from "../labeled-section/labeled-section.js";

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

/** Validates a card's at-most-one Review child and returns its body. */
export const compileReviewChild = ({
  component,
  scopedChildren,
  diagnostics,
}: {
  readonly component: string;
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ElementContent> | undefined => {
  const reviews = scopedChildren.filter((child) => child.name === "Review");
  for (const duplicate of reviews.slice(1)) {
    diagnostics.add({
      message: `${component} cannot contain more than one Review`,
      position: duplicate.position,
    });
  }
  const review = reviews[0];
  if (review === undefined) {
    return undefined;
  }
  validateComponentAttributes({
    component: "Review",
    attributes: review.attributes,
    position: review.position,
    diagnostics,
    schema: {},
  });
  const body = review.children.filter((node) => !isWhitespace(node));
  if (body.length === 0) {
    diagnostics.add({
      message: "Review requires a markdown body",
      position: review.position,
    });
  }
  return body;
};

/** Renders the checklist as the card's closing section. */
export const renderReviewChecklist = ({
  review,
}: {
  readonly review: ReadonlyArray<ElementContent>;
}): Element =>
  renderCardSection({
    children: [
      {
        type: "element",
        tagName: "div",
        properties: {
          className: [
            "flex",
            "items-center",
            "gap-1.5",
            "text-muted",
            "[&_svg]:size-3.5",
            "[&_svg]:shrink-0",
          ],
          "data-review-checklist": "",
        },
        children: [
          renderLucideIcon({ icon: CLIPBOARD_CHECK_ICON, hidden: false }),
          renderSectionLabel("Review checklist"),
        ],
      },
      {
        type: "element",
        tagName: "div",
        properties: {
          className: ["mt-2", "text-sm", "[&>:last-child]:mb-0"],
        },
        children: [...review],
      },
    ],
  });
