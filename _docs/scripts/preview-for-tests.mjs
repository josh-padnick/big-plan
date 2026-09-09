// Owns the docs preview socket for a Playwright run and announces its bound URL.

import { fileURLToPath } from "node:url";
import { preview } from "astro";

const server = await preview({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "silent",
});
console.log(`BIG_PLAN_DOCS_READY http://127.0.0.1:${server.port}/`);

// Playwright terminates this process group when the run ends.
process.once("SIGTERM", () => void server.stop());
process.once("SIGINT", () => void server.stop());
