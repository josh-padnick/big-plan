// A route that answers and then fails used to end the review runtime process.
// The outer request boundary refused the request a second time, the second
// writeHead threw ERR_HTTP_HEADERS_SENT out of the handler, and the caller runs
// that handler with `void`, so the throw became an unhandled rejection. These
// tests need their own file because the failure is injected through a mocked
// route module.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// Node writes the head for a binary answer before it writes the body, and it
// refuses a body that is not a view over a buffer. That is a dispatch which
// answered and then failed.
const unwritableBody = vi.hoisted(
  () => Object.create(Uint8Array.prototype) as Uint8Array,
);

vi.mock("./routes-session.js", () => ({
  readRuntimeSession: () =>
    Promise.resolve({
      kind: "binary" as const,
      status: 200,
      contentType: "application/octet-stream",
      body: unwritableBody,
    }),
}));

const { startReviewRuntime } = await import("./server.js");
const { readCurrentReviewSession } = await import("./session-authority.js");

const PLAN = `# Answer failure plan

The runtime must survive a route that answers and then fails.
`;

let directory: string;
let runtime: Awaited<ReturnType<typeof startReviewRuntime>>;
let token: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "big-plan-answer-failure-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  runtime = await startReviewRuntime({ planPath });
  const session = await readCurrentReviewSession({ store: runtime.store });
  token = session?.token ?? "";
});

afterAll(async () => {
  await runtime.close();
  await rm(directory, { recursive: true, force: true });
});

const get = (path: string) =>
  fetch(`${runtime.url.replace(/\/$/, "")}${path}`, {
    headers: {
      "x-big-plan-review-token": token,
      "sec-fetch-site": "same-origin",
    },
  });

it("should survive a route that answered and then failed", async () => {
  const rejections: Array<unknown> = [];
  const collect = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", collect);
  try {
    // The answer is already on the wire, so the runtime has nothing left to
    // refuse with and closes the connection instead.
    await expect(get("/api/session")).rejects.toThrow();
    // A later request proves the process and its listener are still there.
    expect((await get("/api/drafts")).status).toBe(200);
    expect(rejections).toEqual([]);
  } finally {
    process.off("unhandledRejection", collect);
  }
});
