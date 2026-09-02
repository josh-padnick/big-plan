// Publishes the agent setup guide at the stable /setup.md address.
//
// The install prompt Big Plan hands to every agent points here and never
// changes, so this route must keep answering even as the page moves inside the
// content collection. The page itself is authored in the collection, which is
// what gives it linting, link checking, and the same Markdown projection every
// other page gets.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { markdownDocument } from "../docs-delivery";

const SETUP_SLUG = "for-agents/setup";

// Serves the canonical setup page's Markdown at the stable address.
export const GET: APIRoute = async ({ site }) => {
  const entries = await getCollection("docs");
  const entry = entries.find((candidate) => candidate.id === SETUP_SLUG);

  if (entry === undefined || site === undefined) {
    return new Response("Setup guide not found.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(markdownDocument({ entry, site }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
