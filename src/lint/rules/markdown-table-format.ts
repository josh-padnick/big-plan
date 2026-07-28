// Implements the markdown-table-format authoring rule: find strong table
// intent that GFM left as prose because its delimiter row is invalid.

import type { InlineCode, Paragraph } from "mdast";
import type { Node, Parent, Position } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

type TableRow = {
  readonly cells: ReadonlyArray<string>;
  readonly column: number;
  readonly endColumn: number;
};

const isParent = (node: Node): node is Parent => "children" in node;

const isParagraph = (node: Node): node is Paragraph =>
  node.type === "paragraph";

const isInlineCode = (node: Node): node is InlineCode =>
  node.type === "inlineCode";

// Outer pipes make table intent strong enough to lint without treating
// ordinary prose containing a vertical bar as a malformed table.
const tableRowOf = (line: string): TableRow | undefined => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return undefined;
  }
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length < 2) {
    return undefined;
  }
  return {
    cells,
    column: line.indexOf("|") + 1,
    endColumn: line.lastIndexOf("|") + 1,
  };
};

const isDelimiterCell = (cell: string): boolean => /^:?-{3,}:?$/u.test(cell);

const isValidDelimiterRow = ({
  row,
  columnCount,
}: {
  readonly row: TableRow;
  readonly columnCount: number;
}): boolean =>
  row.cells.length === columnCount && row.cells.every(isDelimiterCell);

const delimiterExample = (columnCount: number): string =>
  `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;

const positionContainsPoint = ({
  position,
  line,
  column,
}: {
  readonly position: Position;
  readonly line: number;
  readonly column: number;
}): boolean => {
  if (line < position.start.line || line > position.end.line) {
    return false;
  }
  if (line === position.start.line && column < position.start.column) {
    return false;
  }
  return line !== position.end.line || column < position.end.column;
};

const inlineCodeContainsRow = ({
  node,
  line,
  row,
}: {
  readonly node: Node;
  readonly line: number;
  readonly row: TableRow;
}): boolean => {
  if (isInlineCode(node) && node.position !== undefined) {
    return (
      positionContainsPoint({
        position: node.position,
        line,
        column: row.column,
      }) &&
      positionContainsPoint({
        position: node.position,
        line,
        column: row.endColumn,
      })
    );
  }
  return (
    isParent(node) &&
    node.children.some((child) =>
      inlineCodeContainsRow({ node: child, line, row }),
    )
  );
};

// Visits paragraphs only: valid GFM tables and fenced code have distinct node
// types, so they never reach the table-intent heuristic.
const checkMarkdownTableFormat = ({
  markdown,
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const sourceLines = markdown.split(/\r?\n/u);
  const findings: Array<PlanLintFinding> = [];

  const visit = (node: Node): void => {
    if (isParagraph(node) && node.position !== undefined) {
      const startLine = node.position.start.line;
      const endLine = node.position.end.line;
      const paragraphLines = sourceLines.slice(startLine - 1, endLine);
      for (let index = 0; index < paragraphLines.length - 1; index += 1) {
        const headerLine = paragraphLines[index];
        const followingLine = paragraphLines[index + 1];
        if (headerLine === undefined || followingLine === undefined) {
          continue;
        }
        const header = tableRowOf(headerLine);
        const following = tableRowOf(followingLine);
        if (
          header === undefined ||
          following === undefined ||
          inlineCodeContainsRow({
            node,
            line: startLine + index,
            row: header,
          }) ||
          inlineCodeContainsRow({
            node,
            line: startLine + index + 1,
            row: following,
          }) ||
          isValidDelimiterRow({
            row: following,
            columnCount: header.cells.length,
          })
        ) {
          continue;
        }
        const example = delimiterExample(header.cells.length);
        findings.push({
          line: startLine + index + 1,
          column: following.column,
          message: `Table-like block needs a valid delimiter row with ${header.cells.length} columns, for example "${example}"`,
        });
        break;
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

export const markdownTableFormatRule: PlanLintRule = {
  id: "markdown-table-format",
  check: checkMarkdownTableFormat,
};
