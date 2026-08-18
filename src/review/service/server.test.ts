// Proves the real listener behaves, against a real review store on disk.
//
// The security assertions are the point of this file: the service is reachable
// by any page the reviewer's browser happens to be showing, so the Host,
// Origin, Sec-Fetch-Site, and token refusals are pinned here rather than
// trusted to review.

import { request as httpRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  prepareStore,
  reviewStoreFor,
  writeSessionDescriptorValue,
  writeSessionHeartbeatValue,
} from "../store.js";
import type { ReviewStore } from "../store.js";
import { rememberPlan } from "./registry.js";
import { startService } from "./server.js";
import type { ServiceRuntime } from "./server.js";

const planId = "1111111111111111";
const sessionId = "abcdef0123456789";
const token = "test-token-value";

let stateDirectory: string;
let planDirectory: string;
let planPath: string;
let store: ReviewStore;
let runtime: ServiceRuntime;
let previousStateDirectory: string | undefined;

const get = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${runtime.origin}${path}`, { redirect: "manual", ...init });

// Speaks HTTP directly so a test can set headers fetch() reserves for itself.
const rawStatus = ({
  path,
  host,
}: {
  readonly path: string;
  readonly host: string;
}): Promise<number> =>
  new Promise((settle, fail) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: runtime.port,
        path,
        method: "GET",
        headers: { host },
      },
      (response) => {
        response.resume();
        settle(response.statusCode ?? 0);
      },
    );
    request.on("error", fail);
    request.end();
  });

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-service-state-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;

  planDirectory = await mkdtemp(join(tmpdir(), "big-plan-service-plan-"));
  planPath = join(planDirectory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  store = reviewStoreFor({ planPath, planId });
  await prepareStore(store);

  runtime = await startService({
    readToken: async () => token,
    version: "9.9.9-test",
    port: 0,
  });
});

afterEach(async () => {
  await runtime.close();
  if (previousStateDirectory === undefined) {
    delete process.env["BIG_PLAN_STATE_DIR"];
  } else {
    process.env["BIG_PLAN_STATE_DIR"] = previousStateDirectory;
  }
  await rm(stateDirectory, { recursive: true, force: true });
  await rm(planDirectory, { recursive: true, force: true });
});

const activateSession = async (url: string): Promise<void> => {
  await writeSessionDescriptorValue({
    store,
    value: {
      version: 1,
      sessionId,
      planId,
      plan: planPath,
      url,
      port: 41_922,
      pid: 4242,
      startedAt: new Date().toISOString(),
      token: "A".repeat(43),
    },
  });
};

describe("the service listener", () => {
  it("should identify itself, with the version an upgrade check needs", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      product: "big-plan-service",
      version: "9.9.9-test",
      port: runtime.port,
    });
  });

  it("should refuse a request whose Host is not its own address", async () => {
    // The anti-rebinding control: a name that resolves to 127.0.0.1 is
    // same-origin to the browser, so the Host header is what has to match.
    await expect(
      rawStatus({ path: "/healthz", host: "plan-review.evil.example.com" }),
    ).resolves.toBe(403);
    await expect(
      rawStatus({ path: "/healthz", host: `127.0.0.1:${runtime.port}` }),
    ).resolves.toBe(200);
    await expect(
      rawStatus({ path: "/healthz", host: `localhost:${runtime.port}` }),
    ).resolves.toBe(200);
  });

  it("should redirect a live plan to the session's own address", async () => {
    await rememberPlan({ planId, planPath });
    await activateSession("http://127.0.0.1:41922/");
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs: Date.now() },
    });
    const response = await get(`/plan/${planId}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:41922/");
  });

  it("should explain an ending instead of refusing the connection", async () => {
    await rememberPlan({ planId, planPath });
    await activateSession("http://127.0.0.1:41922/");
    await writeSessionHeartbeatValue({
      store,
      value: {
        sessionId,
        running: false,
        updatedAtMs: Date.now() - 60_000,
        stopReason: "The review session was stopped by the reviewer.",
      },
    });
    const response = await get(`/plan/${planId}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("This plan review has ended.");
    expect(html).toContain("The review session was stopped by the reviewer.");
    expect(html).toContain(`big-plan review ${planPath}`);
  });

  it("should call an unwritten ending interrupted, never a clean stop", async () => {
    await rememberPlan({ planId, planPath });
    await activateSession("http://127.0.0.1:41922/");
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs: Date.now() - 30_000 },
    });
    const html = await (await get(`/plan/${planId}`)).text();
    expect(html).toContain("stopped unexpectedly");
    expect(html).not.toContain("ended normally");
  });

  it("should answer a plan it has never seen without listing any other", async () => {
    const response = await get("/plan/9999999999999999");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("This machine has no review at this address.");
  });

  it("should answer a malformed plan id like an unknown one", async () => {
    const response = await get("/plan/not-a-plan-id");
    expect(response.status).toBe(404);
  });

  it("should send inert, uncacheable pages that reveal no referrer", async () => {
    const response = await get("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("should refuse a stop that carries no credential", async () => {
    const response = await get("/stop", { method: "POST" });
    expect(response.status).toBe(401);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should refuse a stop from a foreign origin before reading its token", async () => {
    const response = await get("/stop", {
      method: "POST",
      headers: {
        origin: "http://evil.test",
        "x-big-plan-service-token": token,
      },
    });
    expect(response.status).toBe(403);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should refuse a stop a browser sent from another site", async () => {
    const response = await get("/stop", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
        "x-big-plan-service-token": token,
      },
    });
    expect(response.status).toBe(403);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should refuse a stop carrying the wrong token", async () => {
    const response = await get("/stop", {
      method: "POST",
      headers: { "x-big-plan-service-token": "not-the-token" },
    });
    expect(response.status).toBe(401);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should answer a valid stop before it closes its listener", async () => {
    const response = await get("/stop", {
      method: "POST",
      headers: { "x-big-plan-service-token": token },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopping: true });
    await expect(get("/healthz")).rejects.toThrow();
  });

  it("should refuse a route it does not serve", async () => {
    expect((await get("/admin")).status).toBe(404);
    expect(
      (await get("/plan/1111111111111111", { method: "DELETE" })).status,
    ).toBe(404);
  });
});
