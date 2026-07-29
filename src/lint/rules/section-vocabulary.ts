// Implements the section-vocabulary authoring rule: section headings use Big
// Plan's opinionated review vocabulary, so every plan names the same concept
// the same way for its reviewer.

import type { Heading, Text } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// Exact heading phrases (case-insensitive) mapped to the preferred heading.
// Only whole-heading matches fire, so prose mentioning a phrase or a heading
// merely containing it is never flagged.
const PREFERRED_HEADINGS: ReadonlyArray<{
  readonly discouraged: ReadonlyArray<string>;
  readonly preferred: string;
}> = [
  {
    discouraged: ["desired outcome", "desired outcomes", "definition of done"],
    preferred: "Acceptance criteria",
  },
];

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

const isText = (node: Node): node is Text => node.type === "text";

// A heading's comparable text is the concatenation of its plain-text children;
// headings carrying inline code or emphasis compare over their text content.
const headingText = (heading: Heading): string =>
  heading.children
    .map((child) => (isText(child) ? child.value : ""))
    .join("")
    .trim()
    .toLowerCase();

const checkSectionVocabulary = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const findings: Array<PlanLintFinding> = [];

  const visit = (node: Node): void => {
    if (isHeading(node) && node.position !== undefined) {
      const text = headingText(node);
      for (const { discouraged, preferred } of PREFERRED_HEADINGS) {
        if (discouraged.includes(text)) {
          findings.push({
            line: node.position.start.line,
            column: node.position.start.column,
            message: `Name this section "${preferred}"; it is Big Plan's vocabulary for the contract this heading introduces`,
          });
        }
      }
    }
    if (isParent(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(tree);
  return findings;
};

export const sectionVocabularyRule: PlanLintRule = {
  id: "section-vocabulary",
  check: checkSectionVocabulary,
};
