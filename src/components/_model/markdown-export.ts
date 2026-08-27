// Owns the framework-free Markdown presentation contract shared by component
// slices and the document exporter, including portable HAST prose, tables,
// and collision-safe fences.

import type { Element, ElementContent, RootContent } from "hast";
import type { DocumentOutline } from "./document-outline/document-outline.js";

export const MARKDOWN_EXPORT_PLACEHOLDER = "big-plan-markdown-export";

// Marks a placeholder whose component presentation is still deferred, so the
// document can finish deciding heading depth before any component commits to
// one.
export const MARKDOWN_EXPORT_INDEX_ATTRIBUTE = "data-markdown-export";

export type ComponentMarkdownContext = {
  readonly outline: DocumentOutline;
  /**
   * How far this component's own headings sit below the document's top level.
   * A Part opens an act at h2, so everything under it moves one level down;
   * a component that hard-coded its depth would become the section's peer.
   */
  readonly headingOffset: number;
};

export type ComponentMarkdownRenderer<Model> = (
  model: Model,
  context: ComponentMarkdownContext,
) => string;

export class MarkdownExportRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownExportRejected";
  }
}

const isElement = (
  node: RootContent | ElementContent | undefined,
): node is Element => node?.type === "element";

const propertyString = (element: Element, name: string): string | undefined => {
  const value = element.properties[name];
  return typeof value === "string" ? value : undefined;
};

/**
 * Escapes one already-inline-Markdown table cell without introducing
 * viewer-specific HTML. Callers holding raw authored text escape it with
 * `markdownInlineText` first; this helper only protects the cell boundary.
 */
export const markdownTableCell = (value: string): string =>
  value.replace(/\|/gu, "\\|").replace(/\s*\n\s*/gu, " ");

/** Renders one component-owned heading at its document-relative depth. */
export const markdownHeading = ({
  level,
  offset,
  text,
}: {
  readonly level: number;
  readonly offset: number;
  readonly text: string;
}): string => `${"#".repeat(Math.min(6, level + offset))} ${text}`;

/**
 * Splits component prose into the part one GFM table row can hold and the
 * block content it cannot. A table cell is a single line, so a fenced example
 * or a second paragraph has to keep its structure beside the table instead of
 * being flattened into the row.
 */
export const markdownTableProse = (
  markdown: string,
): { readonly cell: string; readonly blocks?: string } => {
  if (markdown === "" || !markdown.includes("\n")) return { cell: markdown };
  const [first = "", ...rest] = markdown.split("\n\n");
  const opensBlock = /^(?:[`~>#|]|[-+*](?=\s)|\d+[.)](?=\s))/u.test(
    first.trim(),
  );
  const cell = opensBlock ? "" : first.replace(/\s*\n\s*/gu, " ").trim();
  // One soft-wrapped paragraph fits a row whole, so repeating it below the
  // table would say the same thing twice.
  return rest.length === 0 && !opensBlock
    ? { cell }
    : { cell, blocks: markdown };
};

/** Renders a GFM table in the authored row and column order. */
export const markdownTable = ({
  headers,
  rows,
  alignments,
}: {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly alignments?: ReadonlyArray<"left" | "center" | "right">;
}): string => {
  if (headers.length === 0) return "";
  const row = (cells: ReadonlyArray<string>): string =>
    `| ${headers.map((_, index) => markdownTableCell(cells[index] ?? "")).join(" | ")} |`;
  const divider = headers.map((_, index) => {
    const alignment = alignments?.[index] ?? "left";
    return alignment === "center"
      ? ":---:"
      : alignment === "right"
        ? "---:"
        : "---";
  });
  return [row(headers), row(divider), ...rows.map(row)].join("\n");
};

/** Chooses a backtick fence longer than every run inside the payload. */
export const markdownFence = ({
  source,
  language = "",
}: {
  readonly source: string;
  readonly language?: string;
}): string => {
  const longest = Math.max(
    0,
    ...(source.match(/`+/gu) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  const body = source.endsWith("\n") ? source.slice(0, -1) : source;
  return `${fence}${language}\n${body}\n${fence}`;
};

export const markdownInlineText = (value: string): string =>
  value
    // GFM reads a flanking single tilde as strikethrough, so authored text
    // carrying one has to escape it like every other emphasis delimiter.
    .replace(/([\\`*_[\]<>#~])/gu, "\\$1")
    .replace(/(^|\n)(\s*)([-+])(?=\s)/gu, "$1$2\\$3")
    // CommonMark only honours a backslash before ASCII punctuation, so an
    // ordered marker has to escape its delimiter rather than its digits.
    .replace(/(^|\n)(\s*)(\d{1,9})([.)])(?=\s)/gu, "$1$2$3\\$4");

// Long sources - a data URI above all - would bury the rule the refusal is
// stating, so the reviewer gets enough of the reference to find it.
const locator = (source: string): string =>
  source === ""
    ? "the image has no source to name"
    : source.length > 80
      ? `${source.slice(0, 80)}...`
      : source;

const textOf = (nodes: ReadonlyArray<ElementContent>): string =>
  nodes
    .map((node) =>
      node.type === "text"
        ? node.value
        : isElement(node)
          ? textOf(node.children)
          : "",
    )
    .join("");

/** Wraps raw text as a code span whose delimiter outruns its backticks. */
export const markdownInlineCode = (value: string): string => {
  const longest = Math.max(
    0,
    ...(value.match(/`+/gu) ?? []).map((run) => run.length),
  );
  const delimiter = "`".repeat(longest + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
};

const inline = (nodes: ReadonlyArray<ElementContent>): string =>
  nodes
    .map((node) => {
      if (node.type === "text") return markdownInlineText(node.value);
      if (!isElement(node)) return "";
      const content = inline(node.children);
      switch (node.tagName) {
        case "strong":
          return `**${content}**`;
        case "em":
          return `_${content}_`;
        case "del":
          return `~~${content}~~`;
        case "code":
          return markdownInlineCode(textOf(node.children));
        case "a": {
          const href = propertyString(node, "href") ?? "";
          if (href.startsWith("#user-content-fn-")) {
            return `[^${href.slice("#user-content-fn-".length)}]`;
          }
          if (href.startsWith("#user-content-fnref-")) return "";
          const title = propertyString(node, "title");
          return `[${content}](${href}${title === undefined ? "" : ` "${title.replace(/"/gu, '\\"')}"`})`;
        }
        case "img": {
          const alt = propertyString(node, "alt")?.trim() ?? "";
          const source = propertyString(node, "src") ?? "";
          if (alt === "") {
            throw new MarkdownExportRejected(
              `A referenced image needs meaningful alternative text before this plan can be exported: ${locator(source)}`,
            );
          }
          const title = propertyString(node, "title");
          return `![${alt.replace(/([\\\]])/gu, "\\$1")}](${source}${title === undefined ? "" : ` "${title.replace(/"/gu, '\\"')}"`})`;
        }
        case "br":
          return "  \n";
        default:
          return content;
      }
    })
    .join("");

const indent = (value: string, prefix: string): string =>
  value
    .split("\n")
    .map((line, index) =>
      index === 0 || line === "" ? line : `${prefix}${line}`,
    )
    .join("\n");

/**
 * Renders one bullet whose content may span several Markdown blocks, keeping
 * every continuation line inside the item instead of ending the list.
 */
export const markdownBullet = (content: string): string =>
  `- ${indent(content.trim(), "  ")}`.trimEnd();

const listItem = ({
  node,
  marker,
  headingOffset,
}: {
  readonly node: Element;
  readonly marker: string;
  readonly headingOffset: number;
}): string => {
  const body = blocks(node.children, headingOffset, {
    insideListItem: true,
  }).trim();
  const checkbox = node.children.find(
    (child): child is Element =>
      isElement(child) &&
      child.tagName === "input" &&
      child.properties.type === "checkbox",
  );
  const task =
    checkbox === undefined
      ? ""
      : checkbox.properties.checked === true
        ? "[x] "
        : "[ ] ";
  // A continuation line belongs at the item's content column, which an
  // ordered marker pushes past the two spaces a bullet needs.
  return `${marker} ${task}${indent(body, " ".repeat(marker.length + 1))}`.trimEnd();
};

const tableFromElement = (table: Element): string => {
  const rows: Array<ReadonlyArray<string>> = [];
  let header: ReadonlyArray<string> | undefined;
  let alignments: ReadonlyArray<"left" | "center" | "right"> | undefined;
  const visit = (node: Element): void => {
    if (node.tagName === "tr") {
      const cells = node.children
        .filter(isElement)
        .filter((child) => child.tagName === "th" || child.tagName === "td")
        .map((cell) => inline(cell.children).trim());
      if (
        node.children.some(
          (child) => isElement(child) && child.tagName === "th",
        ) &&
        header === undefined
      ) {
        header = cells;
        alignments = node.children
          .filter(isElement)
          .filter((child) => child.tagName === "th")
          .map((cell) => {
            const align = propertyString(cell, "align");
            return align === "center" || align === "right" ? align : "left";
          });
      } else {
        rows.push(cells);
      }
      return;
    }
    for (const child of node.children) {
      if (isElement(child)) visit(child);
    }
  };
  visit(table);
  const resolvedHeader = header ?? rows.shift() ?? [];
  return markdownTable({
    headers: resolvedHeader,
    rows,
    ...(alignments === undefined ? {} : { alignments }),
  });
};

const footnotesFromSection = (
  section: Element,
  headingOffset: number,
): string => {
  const list = section.children.find(
    (child): child is Element => isElement(child) && child.tagName === "ol",
  );
  if (list === undefined) return "";
  return list.children
    .filter(isElement)
    .filter((child) => child.tagName === "li")
    .map((item, index) => {
      const id = propertyString(item, "id") ?? "";
      const label = id.startsWith("user-content-fn-")
        ? id.slice("user-content-fn-".length)
        : String(index + 1);
      const body = blocks(item.children, headingOffset).trim();
      const indented = body
        .split("\n")
        .map((line, lineIndex) => (lineIndex === 0 ? line : `    ${line}`))
        .join("\n");
      return `[^${label}]: ${indented}`;
    })
    .join("\n\n");
};

// A tight list item holds phrasing content directly: mdast-util-to-hast drops
// the paragraph wrapper. Treating each of those children as its own block
// would break one sentence into several paragraphs, so consecutive phrasing
// nodes are serialized as one inline run wherever they appear.
const PHRASING_TAG_NAMES: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

type EmittedBlock = {
  readonly value: string;
  readonly phrasing: boolean;
  readonly list: boolean;
};

const blocks = (
  nodes: ReadonlyArray<RootContent | ElementContent>,
  headingOffset: number,
  { insideListItem = false }: { readonly insideListItem?: boolean } = {},
): string => {
  const emitted: Array<EmittedBlock> = [];
  const add = (
    value: string,
    kind: { readonly phrasing?: boolean; readonly list?: boolean } = {},
  ): void => {
    if (value.trim() === "") return;
    emitted.push({
      value,
      phrasing: kind.phrasing === true,
      list: kind.list === true,
    });
  };
  let run: Array<ElementContent> = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    const value = inline(run).trim();
    run = [];
    add(value, { phrasing: true });
  };
  for (const node of nodes) {
    if (
      node.type === "text" ||
      (node.type === "element" && PHRASING_TAG_NAMES.has(node.tagName))
    ) {
      run.push(node);
      continue;
    }
    flushRun();
    if (!isElement(node)) continue;
    if (node.tagName === MARKDOWN_EXPORT_PLACEHOLDER) {
      add(textOf(node.children));
      continue;
    }
    if (/^h[1-6]$/u.test(node.tagName)) {
      const authoredLevel = Number(node.tagName.slice(1));
      const level = Math.min(6, authoredLevel + headingOffset);
      add(`${"#".repeat(level)} ${inline(node.children).trim()}`);
      continue;
    }
    if (
      node.tagName === "section" &&
      node.properties.dataFootnotes !== undefined
    ) {
      add(footnotesFromSection(node, headingOffset));
      continue;
    }
    switch (node.tagName) {
      case "p":
        add(inline(node.children).trim());
        break;
      case "pre": {
        const code = node.children.find(
          (child): child is Element =>
            isElement(child) && child.tagName === "code",
        );
        const classes = code?.properties.className;
        const language = Array.isArray(classes)
          ? classes
              .find(
                (entry) =>
                  typeof entry === "string" && entry.startsWith("language-"),
              )
              ?.slice("language-".length)
          : undefined;
        add(
          markdownFence({
            source:
              code === undefined
                ? textOf(node.children)
                : textOf(code.children),
            ...(language === undefined ? {} : { language }),
          }),
        );
        break;
      }
      case "blockquote":
        add(
          blocks(node.children, headingOffset)
            .trim()
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        );
        break;
      case "ul":
        add(
          node.children
            .filter(isElement)
            .filter((child) => child.tagName === "li")
            .map((child) =>
              listItem({ node: child, marker: "-", headingOffset }),
            )
            .join("\n"),
          { list: true },
        );
        break;
      case "ol": {
        const start =
          typeof node.properties.start === "number" ? node.properties.start : 1;
        add(
          node.children
            .filter(isElement)
            .filter((child) => child.tagName === "li")
            .map((child, index) =>
              listItem({
                node: child,
                marker: `${start + index}.`,
                headingOffset,
              }),
            )
            .join("\n"),
          { list: true },
        );
        break;
      }
      case "table":
        add(tableFromElement(node));
        break;
      case "hr":
        add("---");
        break;
      case "section":
      case "div":
      case "nav":
      case "figure":
      case "figcaption":
      case "details":
      case "summary":
        add(blocks(node.children, headingOffset));
        break;
      case "li":
        add(blocks(node.children, headingOffset));
        break;
      default: {
        add(inline([node]).trim());
      }
    }
  }
  flushRun();
  // A sublist directly under an item's own sentence stays tight: a blank line
  // there would make every item in the surrounding list a paragraph.
  return emitted.reduce((document, entry, index) => {
    if (index === 0) return entry.value;
    const separator =
      insideListItem && entry.list && emitted[index - 1]?.phrasing === true
        ? "\n"
        : "\n\n";
    return `${document}${separator}${entry.value}`;
  }, "");
};

/** Converts authored rich HAST and semantic component placeholders to Markdown. */
export const markdownFromHast = (
  nodes: ReadonlyArray<RootContent | ElementContent>,
  { headingOffset = 0 }: { readonly headingOffset?: number } = {},
): string => blocks(nodes, headingOffset).trim();

/** Builds the compiler-only node used to carry component-owned Markdown. */
export const markdownExportPlaceholder = ({
  markdown,
  position,
}: {
  readonly markdown: string;
  readonly position?: Element["position"];
}): Element => ({
  type: "element",
  tagName: MARKDOWN_EXPORT_PLACEHOLDER,
  properties: {},
  children: [{ type: "text", value: markdown }],
  ...(position === undefined ? {} : { position }),
});

/** Builds the compiler-only node standing in for a deferred presentation. */
export const deferredMarkdownPlaceholder = ({
  index,
  position,
}: {
  readonly index: number;
  readonly position?: Element["position"];
}): Element => ({
  type: "element",
  tagName: MARKDOWN_EXPORT_PLACEHOLDER,
  properties: { [MARKDOWN_EXPORT_INDEX_ATTRIBUTE]: String(index) },
  children: [],
  ...(position === undefined ? {} : { position }),
});
