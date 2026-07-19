// Publishes every canonical docs page as one concatenated Markdown document.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { fullDocumentSection, orderAllEntries } from "../docs-delivery";

// Concatenates every canonical page in stable reader-oriented order.
export const GET: APIRoute = async () => {
  const entries = orderAllEntries(await getCollection("docs"));
  const content = `${entries.map(fullDocumentSection).join("\n\n---\n\n")}\n`;

  return new Response(content, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
