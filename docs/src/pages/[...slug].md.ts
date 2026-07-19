// Publishes a clean Markdown representation for every Starlight docs page.

import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { markdownDocument } from "../docs-delivery";

// Creates one static dotted Markdown route for each canonical docs entry.
export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection("docs");
  return entries.map((entry) => ({ params: { slug: entry.id } }));
};

// Serves the raw canonical body with a small machine-readable frontmatter block.
export const GET: APIRoute = async ({ params, site }) => {
  const entries = await getCollection("docs");
  const entry = entries.find((candidate) => candidate.id === params.slug);

  if (entry === undefined || site === undefined) {
    return new Response("Documentation page not found.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(markdownDocument({ entry, site }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
