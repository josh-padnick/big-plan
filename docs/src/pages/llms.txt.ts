// Publishes the concise curated map of Big Plan's machine-readable docs,
// grouped and ordered by the navigation sidebar.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { curatedSections, markdownPath } from "../docs-delivery";

// Builds the concise page map from canonical collection metadata.
export const GET: APIRoute = async ({ site }) => {
  if (site === undefined) {
    return new Response("Site URL is not configured.\n", { status: 500 });
  }

  const sections = curatedSections(await getCollection("docs"));
  const body = sections.flatMap((section) => [
    "",
    `## ${section.label}`,
    "",
    ...section.entries.map((entry) => {
      const url = new URL(markdownPath(entry), site).href;
      return `- [${entry.data.title}](${url}): ${entry.data.description ?? ""}`;
    }),
  ]);
  const content = [
    "# Big Plan",
    "",
    "> Good AI output depends on a great plan.",
    "",
    "The plan is where the real decisions get made: what to build, how, and why.",
    "Plans are a big deal, and Big Plan treats them like one: it makes plan review a first-class experience so people and agents reach agreement before the agent acts.",
    ...body,
    "",
  ].join("\n");

  return new Response(content, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
