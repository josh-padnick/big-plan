// Proves BIG-235's opt-in hop across the two real listeners. The service and
// session remain separate processes in production; separate listeners here
// preserve the address, origin, and route boundary the browser actually sees.

import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startReviewRuntime } from "../server.js";
import type { ReviewRuntime } from "../server.js";
import { rememberPlan } from "./registry.js";
import { startService } from "./server.js";
import type { ServiceRuntime } from "./server.js";

const reserveFreePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((settle) => {
    probe.listen({ host: "127.0.0.1", port: 0 }, settle);
  });
  const address = probe.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((settle) => probe.close(() => settle()));
  return port;
};

describe("the opt-in review proxy", () => {
  let stateDirectory: string;
  let planDirectory: string;
  let planPath: string;
  let service: ServiceRuntime | undefined;
  let review: ReviewRuntime | undefined;
  let previousStateDirectory: string | undefined;
  let previousPort: string | undefined;
  let previousProxy: string | undefined;

  beforeEach(async () => {
    stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-proxy-state-"));
    planDirectory = await mkdtemp(join(tmpdir(), "big-plan-proxy-plan-"));
    planPath = join(planDirectory, "plan.mdx");
    await writeFile(
      planPath,
      "# Proxied plan\n\nThe hop preserves every byte.\n",
    );
    previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
    previousPort = process.env["BIG_PLAN_PORT"];
    previousProxy = process.env["BIG_PLAN_PROXY"];
    process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
    process.env["BIG_PLAN_PORT"] = String(await reserveFreePort());
  });

  afterEach(async () => {
    await Promise.all([
      service?.close().catch(() => undefined),
      review?.close().catch(() => undefined),
    ]);
    for (const [name, value] of [
      ["BIG_PLAN_STATE_DIR", previousStateDirectory],
      ["BIG_PLAN_PORT", previousPort],
      ["BIG_PLAN_PROXY", previousProxy],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(stateDirectory, { recursive: true, force: true });
    await rm(planDirectory, { recursive: true, force: true });
  });

  const startPair = async (): Promise<{
    readonly service: ServiceRuntime;
    readonly review: ReviewRuntime;
    readonly token: string;
  }> => {
    service = await startService({
      readToken: async () => "service-owner-token",
      version: "9.9.9-proxy-test",
    });
    review = await startReviewRuntime({ planPath });
    await rememberPlan({ planId: review.planId, planPath: review.planPath });
    const descriptor: unknown = JSON.parse(
      await readFile(review.store.sessionPath, "utf8"),
    );
    if (
      typeof descriptor !== "object" ||
      descriptor === null ||
      !("token" in descriptor) ||
      typeof descriptor.token !== "string"
    ) {
      throw new Error("The live review descriptor carried no token");
    }
    return { service, review, token: descriptor.token };
  };

  it("should preserve the redirect when the switch was off at startup", async () => {
    delete process.env["BIG_PLAN_PROXY"];
    const running = await startPair();
    process.env["BIG_PLAN_PROXY"] = "1";

    const response = await fetch(
      `${running.service.origin}/plan/${running.review.planId}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(running.review.url);
  });

  it("should serve identical bytes and accept browser reads and writes through the hop", async () => {
    process.env["BIG_PLAN_PROXY"] = "1";
    const running = await startPair();
    delete process.env["BIG_PLAN_PROXY"];
    const planPrefix = `/plan/${running.review.planId}/`;

    const canonical = await fetch(
      `${running.service.origin}${planPrefix.slice(0, -1)}`,
      { redirect: "manual" },
    );
    expect(canonical.status).toBe(302);
    expect(canonical.headers.get("location")).toBe(planPrefix);

    const [directDocument, proxiedResponse] = await Promise.all([
      fetch(running.review.url).then((response) => response.arrayBuffer()),
      fetch(`${running.service.origin}${planPrefix}`, { redirect: "manual" }),
    ]);
    expect(proxiedResponse.status).toBe(200);
    expect(Buffer.from(await proxiedResponse.arrayBuffer())).toEqual(
      Buffer.from(directDocument),
    );

    const browserReadHeaders = {
      "x-big-plan-review-token": running.token,
      "sec-fetch-site": "same-origin",
    };
    const read = await fetch(
      `${running.service.origin}${planPrefix}api/drafts`,
      { headers: browserReadHeaders },
    );
    expect(read.status).toBe(200);
    const snapshot = (await read.json()) as { readonly version?: unknown };
    expect(typeof snapshot.version).toBe("string");

    const write = await fetch(
      `${running.service.origin}${planPrefix}api/drafts`,
      {
        method: "PUT",
        headers: {
          ...browserReadHeaders,
          origin: running.service.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          drafts: [],
          resolvedCommentIds: [],
          version: snapshot.version,
        }),
      },
    );
    expect(write.status).toBe(200);
  });

  it("should refuse a document's own requests once the session it was served by is gone", async () => {
    process.env["BIG_PLAN_PROXY"] = "1";
    const running = await startPair();
    delete process.env["BIG_PLAN_PROXY"];
    const planPrefix = `/plan/${running.review.planId}/`;
    await running.review.close();

    const [page, poll, image] = await Promise.all([
      fetch(`${running.service.origin}${planPrefix}`, { redirect: "manual" }),
      fetch(`${running.service.origin}${planPrefix}api/drafts`, {
        headers: {
          "x-big-plan-review-token": running.token,
          "sec-fetch-site": "same-origin",
        },
      }),
      fetch(`${running.service.origin}${planPrefix}review-images/anything`),
    ]);

    // The address a person saved still explains what happened to the review.
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    // What the open page asks for itself must not read as a successful answer,
    // or the document parses a status page as data instead of showing that its
    // runtime is gone.
    for (const answer of [poll, image]) {
      expect(answer.ok).toBe(false);
      expect(answer.status).toBe(502);
      expect(answer.headers.get("content-type")).not.toContain("text/html");
    }
  });

  it("should answer as a gateway when the runtime stops answering after the lookup", async () => {
    process.env["BIG_PLAN_PROXY"] = "1";
    const running = await startPair();
    delete process.env["BIG_PLAN_PROXY"];
    // Every record the service reads still says this session is live; only
    // the address it published stops answering, which is the runtime dying
    // between the lookup and the connection.
    const descriptor: unknown = JSON.parse(
      await readFile(running.review.store.sessionPath, "utf8"),
    );
    if (typeof descriptor !== "object" || descriptor === null) {
      throw new Error("The live review descriptor was unreadable");
    }
    await writeFile(
      running.review.store.sessionPath,
      JSON.stringify({
        ...descriptor,
        url: `http://127.0.0.1:${await reserveFreePort()}/`,
      }),
    );

    const answer = await fetch(
      `${running.service.origin}/plan/${running.review.planId}/api/drafts`,
      {
        headers: {
          "x-big-plan-review-token": running.token,
          "sec-fetch-site": "same-origin",
        },
      },
    );

    expect(answer.status).toBe(502);
  });
});
