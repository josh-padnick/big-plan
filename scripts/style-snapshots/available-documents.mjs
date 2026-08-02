// Selects configured capture documents that exist in one historical checkout.

import { access } from "node:fs/promises";
import { join } from "node:path";

/** Returns documents whose revision-local source is available to render. */
export const availableDocuments = async ({ checkout, documents }) => {
  const available = [];
  for (const document of documents) {
    try {
      await access(join(checkout, document.source));
      available.push(document);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return available;
};
