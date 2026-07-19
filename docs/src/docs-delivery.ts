// Owns Markdown serialization and sidebar-derived ordering for the
// agent-facing docs endpoints. Page order and grouping come from the
// navigation sidebar, so new pages flow into llms.txt without edits here.

import type { CollectionEntry } from "astro:content";
import { SIDEBAR } from "./sidebar";

type DocsEntry = CollectionEntry<"docs">;

const SIDEBAR_SLUGS: readonly string[] = SIDEBAR.flatMap((group) =>
  group.items.map((item) => item.slug),
);

// The landing page leads the concatenated document; sidebar order follows.
const FULL_DOCUMENT_ORDER: readonly string[] = ["index", ...SIDEBAR_SLUGS];

const THEME_IMAGE = /<ThemeImage\b[\s\S]*?\/>/g;
const TABS = /<Tabs>([\s\S]*?)<\/Tabs>/g;
const TAB_ITEM =
  /[ \t]*<TabItem\s+label=(?:"([^"]*)"|'([^']*)')>[ \t]*\r?\n([\s\S]*?)[ \t]*<\/TabItem>/g;
const IMPORT_END = /(?:from\s+)?["'][^"']+["'];?[ \t]*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const CLOSING_FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

// Removes the leading MDX import block without touching import examples later
// in the document.
const removeImports = (body: string): string => {
  const lines = body.split("\n");
  let index = 0;

  while (lines[index]?.trim() === "") {
    index += 1;
  }
  while (lines[index]?.trimStart().startsWith("import ") === true) {
    do {
      index += 1;
    } while (
      index < lines.length &&
      IMPORT_END.test(lines[index - 1]?.trimEnd() ?? "") === false
    );

    while (lines[index]?.trim() === "") {
      index += 1;
    }
  }

  return lines.slice(index).join("\n");
};

// Removes indentation introduced solely by an enclosing presentation
// component while preserving the Markdown nested inside it.
const dedent = (body: string): string => {
  const lines = body.replace(/^\r?\n|\r?\n$/g, "").split("\n");
  const indents = lines.flatMap((line) => {
    if (line.trim() === "") {
      return [];
    }
    return [line.length - line.trimStart().length];
  });
  const indentation = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(indentation)).join("\n");
};

// Applies a transformation around protected fenced examples.
const transformProse = (
  body: string,
  transform: (prose: string) => string,
): string => {
  const protectedLines: string[] = [];
  let tokenPrefix = "\0big-plan-fence:";
  let openFence: string | undefined;

  while (body.includes(tokenPrefix)) {
    tokenPrefix += ":";
  }

  const protectedBody = body
    .split("\n")
    .map((line) => {
      if (openFence === undefined) {
        const marker = FENCE.exec(line)?.[1];
        if (marker === undefined) {
          return line;
        }
        openFence = marker;
      } else {
        const marker = CLOSING_FENCE.exec(line)?.[1];
        if (marker?.[0] === openFence[0] && marker.length >= openFence.length) {
          openFence = undefined;
        }
      }

      const indentation = line.slice(0, line.length - line.trimStart().length);
      const token = `${tokenPrefix}${protectedLines.length}\0`;
      protectedLines.push(line.slice(indentation.length));
      return `${indentation}${token}`;
    })
    .join("\n");

  return protectedLines.reduce(
    (result, line, index) =>
      result.replaceAll(`${tokenPrefix}${index}\0`, line),
    transform(protectedBody),
  );
};

// Converts the presentation-only MDX used by the docs site into portable
// Markdown for agent-facing endpoints.
export const serializeMarkdownBody = (body: string): string => {
  return transformProse(removeImports(body), (prose) =>
    prose
      .replace(TABS, (_tabs, children: string) =>
        children
          .replace(
            TAB_ITEM,
            (
              _item,
              doubleQuotedLabel: string,
              singleQuotedLabel: string,
              content: string,
            ) =>
              `### ${doubleQuotedLabel || singleQuotedLabel}\n\n${dedent(content)}\n`,
          )
          .trim(),
      )
      .replace(THEME_IMAGE, (element) => {
        const alt = /\balt=(?:"([^"]*)"|'([^']*)')/.exec(element);
        return alt?.[1] ?? alt?.[2] ?? "";
      }),
  );
};

// Returns the canonical body in the agent-facing Markdown representation.
export const markdownBody = (entry: DocsEntry): string =>
  serializeMarkdownBody(entry.body ?? "");

// Builds the public HTML path represented by a content collection entry.
export const htmlPath = (entry: DocsEntry): string =>
  entry.id === "index" ? "/" : `/${entry.id}/`;

// Builds the clean Markdown endpoint path represented by an entry.
export const markdownPath = (entry: DocsEntry): string => `/${entry.id}.md`;

// Serializes one entry with machine-readable frontmatter and a clean body.
export const markdownDocument = ({
  entry,
  site,
}: {
  readonly entry: DocsEntry;
  readonly site: URL;
}): string => {
  const canonical = new URL(htmlPath(entry), site).href;
  return [
    "---",
    `title: ${JSON.stringify(entry.data.title)}`,
    `description: ${JSON.stringify(entry.data.description ?? "")}`,
    `canonical: ${JSON.stringify(canonical)}`,
    "---",
    "",
    markdownBody(entry),
  ].join("\n");
};

// Orders every page for the deterministic full-document representation.
export const orderAllEntries = (
  entries: readonly DocsEntry[],
): readonly DocsEntry[] => {
  // Pages outside the sidebar remain deterministic after the ranked set.
  const rank = (entry: DocsEntry): number => {
    const index = FULL_DOCUMENT_ORDER.indexOf(entry.id);
    return index === -1 ? FULL_DOCUMENT_ORDER.length : index;
  };

  return [...entries].sort((left, right) => {
    const rankDifference = rank(left) - rank(right);
    return rankDifference === 0
      ? left.id.localeCompare(right.id)
      : rankDifference;
  });
};

export type CuratedSection = {
  readonly label: string;
  readonly entries: readonly DocsEntry[];
};

// Groups pages for the concise agent map, mirroring the sidebar sections.
// Pages published outside the sidebar land in a trailing section instead of
// silently disappearing from the map; the landing page alone is skipped
// because the map's own header already carries its message.
export const curatedSections = (
  entries: readonly DocsEntry[],
): readonly CuratedSection[] => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const sections = SIDEBAR.map((group) => ({
    label: group.label,
    entries: group.items.flatMap((item) => {
      const entry = byId.get(item.slug);
      return entry === undefined ? [] : [entry];
    }),
  }));
  const unlisted = orderAllEntries(
    entries.filter(
      (entry) => entry.id !== "index" && !SIDEBAR_SLUGS.includes(entry.id),
    ),
  );
  return [
    ...sections,
    ...(unlisted.length > 0 ? [{ label: "Other", entries: unlisted }] : []),
  ].filter((section) => section.entries.length > 0);
};

// Formats one page as a section in the complete concatenated document.
export const fullDocumentSection = (entry: DocsEntry): string =>
  [
    `# ${entry.data.title}`,
    "",
    `> ${entry.data.description ?? ""}`,
    "",
    markdownBody(entry),
  ].join("\n");
