// Rejects implementation and review notes disguised as product copy inside a
// Wireframe, so the artboard contains only language its intended user sees.

import type { Node, Parent, Position } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

type JsxAttribute = {
  readonly type: string;
  readonly name?: string | null;
  readonly value?: unknown;
  readonly position?: Position;
};

type JsxElement = Node & {
  readonly name?: string | null;
  readonly attributes?: ReadonlyArray<JsxAttribute>;
};

const PROCESS_COPY: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: "sticky", pattern: /\bsticky\b/iu },
  { label: "remembered", pattern: /\bremembered\b/iu },
  { label: "Cmd+K", pattern: /\bcmd\s*\+\s*k\b/iu },
  { label: "J/K", pattern: /\bj\s*\/\s*k\b/iu },
];

const isParent = (node: Node): node is Parent => "children" in node;

const isJsxElement = (node: Node): node is JsxElement =>
  node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

const processTermsIn = (value: string): ReadonlyArray<string> =>
  PROCESS_COPY.filter(({ pattern }) => pattern.test(value)).map(
    ({ label }) => label,
  );

const checkWireframeProductCopy = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const findings: Array<PlanLintFinding> = [];

  const visit = (node: Node, insideWireframe: boolean): void => {
    const wireframe =
      insideWireframe || (isJsxElement(node) && node.name === "Wireframe");
    if (wireframe && isJsxElement(node)) {
      for (const attribute of node.attributes ?? []) {
        if (
          attribute.type !== "mdxJsxAttribute" ||
          typeof attribute.value !== "string"
        ) {
          continue;
        }
        const terms = processTermsIn(attribute.value);
        const position = attribute.position ?? node.position;
        if (terms.length > 0 && position !== undefined) {
          findings.push({
            line: position.start.line,
            column: position.start.column,
            message: `Move process note ${terms.map((term) => `"${term}"`).join(", ")} outside the Wireframe; artboard attributes contain only product UI copy its intended user sees`,
          });
        }
      }
    }
    if (isParent(node)) {
      node.children.forEach((child) => visit(child, wireframe));
    }
  };

  visit(tree, false);
  return findings;
};

export const wireframeProductCopyRule: PlanLintRule = {
  id: "wireframe-product-copy",
  check: checkWireframeProductCopy,
};
