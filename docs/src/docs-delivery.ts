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

// Returns the raw canonical body retained by the Starlight docs loader.
export const rawBody = (entry: DocsEntry): string => entry.body ?? "";

// Builds the public HTML path represented by a content collection entry.
export const htmlPath = (entry: DocsEntry): string =>
  entry.id === "index" ? "/" : `/${entry.id}/`;

// Builds the clean Markdown endpoint path represented by an entry.
export const markdownPath = (entry: DocsEntry): string => `/${entry.id}.md`;

// Serializes one entry with machine-readable frontmatter and its raw body.
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
    rawBody(entry),
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
    rawBody(entry),
  ].join("\n");
