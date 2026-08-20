// Proves the real listener behaves, against a real review store on disk.
//
// The security assertions are the point of this file: the service is reachable
// by any page the reviewer's browser happens to be showing, so the Host,
// Origin, Sec-Fetch-Site, and token refusals are pinned here rather than
// trusted to review.

import { request as httpRequest } from "node:http";
import type { Socket } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareStore,
  reviewStoreFor,
  writeSessionDescriptorValue,
  writeSessionHeartbeatValue,
} from "../store.js";
import type { ReviewStore } from "../store.js";
import {
  clearServiceRuntimeRecord,
  readServiceRuntimeRecord,
  writeServiceRuntimeRecord,
} from "./lifecycle.js";
import { startReviewRuntime } from "../server.js";
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

// The same, but keeping the response so its headers can be read; `fetch`
// reserves the Host header for itself.
const rawResponse = ({
  path,
  host,
}: {
  readonly path: string;
  readonly host: string;
}): Promise<Response> =>
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
        settle(
          new Response(null, {
            status: response.statusCode ?? 0,
            headers: Object.entries(response.headers).flatMap(([key, value]) =>
              typeof value === "string" ? [[key, value] as const] : [],
            ),
          }),
        );
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

  it("should keep redirecting a saved link after the former idle window", async () => {
    // The durable /plan/<id> URL is the contract a shared link must honour.
    // A default review no longer expires, so this address must still send the
    // reader to that session after the window that used to close it.
    const review = await startReviewRuntime({ planPath });
    try {
      await rememberPlan({ planId: review.planId, planPath: review.planPath });
      const oldWindowMs = 200;
      await new Promise((settle) => setTimeout(settle, oldWindowMs * 4));
      const response = await get(`/plan/${review.planId}`);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(review.url);
      await expect(fetch(review.url)).resolves.toMatchObject({ status: 200 });
    } finally {
      await review.close();
    }
  });

  it("should explain a deliberately stopped default review on the durable link", async () => {
    // Closing is now the normal way a default review ends. The saved link
    // must still speak that ending instead of refusing the connection.
    const review = await startReviewRuntime({ planPath });
    try {
      await rememberPlan({ planId: review.planId, planPath: review.planPath });
      await review.close("The review session was stopped by the reviewer.");
      const response = await get(`/plan/${review.planId}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("This plan review has ended.");
      expect(html).toContain("The review session was stopped by the reviewer.");
      expect(html).toContain(`big-plan review ${review.planPath}`);
      await expect(fetch(review.url)).rejects.toThrow();
    } finally {
      await review.close().catch(() => undefined);
    }
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

  it("should never forward a saved link off this machine", async () => {
    await rememberPlan({ planId, planPath });
    await activateSession("http://plans.evil.example.com/");
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs: Date.now() },
    });
    const response = await get(`/plan/${planId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBe(null);
    expect(await response.text()).toContain("No review has run for this plan.");
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
    expect(html).toContain("The review stopped unexpectedly.");
    expect(html).toContain("Last seen at");
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

  it("should welcome a visitor who opened the port, and offer the way out", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain("Welcome to Big Plan.");
    expect(html).toContain("Big Plan service");
    expect(html).toContain(
      `Hosted at <span class="font-mono">127.0.0.1:${runtime.port}</span>.`,
    );
    expect(html).toContain('href="/stop"');
  });

  it("should confirm a stop with the consequence before the control", async () => {
    const response = await get("/stop");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Stop the service?");
    expect(html).toContain(
      "Big Plans on this machine will no longer be accessible through the web browser.",
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('name="nonce"');
    // The service is still running: reaching the confirm page changes nothing.
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should let a page this process served stop it, without the owner token", async () => {
    // Post/Redirect/Get: the browser is sent to a page it can land on, so a
    // refresh never re-submits the stop. The process stays up for exactly that
    // one GET, then goes.
    const nonce = /name="nonce" type="hidden" value="([^"]+)"/u.exec(
      await (await get("/stop")).text(),
    )?.[1];
    expect(nonce).toBeDefined();
    const posted = await get("/stop", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ nonce: nonce ?? "" }).toString(),
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get("location")).toBe("/stopped");
    // Still listening: the redirect target has to be servable.
    expect((await get("/healthz")).status).toBe(200);

    const landed = await get("/stopped");
    expect(landed.status).toBe(200);
    const html = await landed.text();
    expect(html).toContain("The service is stopped.");
    expect(html).toContain(
      "Reloading this page will show a browser connection error",
    );
    await expect(get("/healthz")).rejects.toThrow();
  });

  it("should still stop when the reader leaves before the page arrives", async () => {
    // The confirmation promised the service stops, and the route disarms as
    // soon as it is served, so this response is the only thing that can end
    // the process - however the reader's side of it ends.
    const nonce = /name="nonce" type="hidden" value="([^"]+)"/u.exec(
      await (await get("/stop")).text(),
    )?.[1];
    const posted = await get("/stop", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ nonce: nonce ?? "" }).toString(),
    });
    expect(posted.status).toBe(303);

    let landingSocket: Socket | undefined;
    await new Promise<void>((settle, fail) => {
      const landing = httpRequest(
        {
          host: "127.0.0.1",
          port: runtime.port,
          path: "/stopped",
          method: "GET",
        },
        (response) => {
          // Gone the moment the headers land, long before the page's last
          // byte: the reader closed the tab.
          response.destroy();
          landingSocket?.destroy();
          settle();
        },
      );
      landing.on("error", fail);
      landing.on("socket", (socket: Socket) => {
        landingSocket = socket;
      });
      landing.end();
    });

    await vi.waitFor(async () => {
      await expect(get("/healthz")).rejects.toThrow();
    });
  });

  it("should not let anyone stop it by guessing the landing page", async () => {
    // /stopped is armed by an authenticated stop and disarmed by serving it,
    // so it is not a credential-free way to end the service.
    expect((await get("/stopped")).status).toBe(404);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should refuse a stop carrying a nonce it never issued", async () => {
    const response = await get("/stop", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nonce: "not-the-nonce" }).toString(),
    });
    expect(response.status).toBe(401);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should accept the stop form a browser sends with no origin claim", async () => {
    // Regression: this page sets Referrer-Policy: no-referrer, so Chrome sends
    // its own same-origin form navigation with Origin: null. Refusing that
    // refused the service's own stop button, and only a real browser showed it.
    const nonce = /name="nonce" type="hidden" value="([^"]+)"/u.exec(
      await (await get("/stop")).text(),
    )?.[1];
    const response = await get("/stop", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "null",
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ nonce: nonce ?? "" }).toString(),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/stopped");
  });

  it("should still refuse an absent origin claim that came from another site", async () => {
    // A sandboxed cross-site frame also sends Origin: null, so Sec-Fetch-Site
    // is what has to carry the refusal once null is admitted.
    const nonce = /name="nonce" type="hidden" value="([^"]+)"/u.exec(
      await (await get("/stop")).text(),
    )?.[1];
    const response = await get("/stop", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "null",
        "sec-fetch-site": "cross-site",
      },
      body: new URLSearchParams({ nonce: nonce ?? "" }).toString(),
    });
    expect(response.status).toBe(403);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should tell the browser the stop form may only post to this service", async () => {
    const policy = (await get("/stop")).headers.get("content-security-policy");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("base-uri 'none'");
    // A framed confirmation page would carry a nonce this process issued, and
    // a click on it would pass every same-origin check below.
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("should refuse a nonce replayed from another site", async () => {
    // The nonce proves the page came from this process, not that the request
    // did, so the origin and site checks stay unconditional in front of it.
    const nonce = /name="nonce" type="hidden" value="([^"]+)"/u.exec(
      await (await get("/stop")).text(),
    )?.[1];
    const response = await get("/stop", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://evil.test",
      },
      body: new URLSearchParams({ nonce: nonce ?? "" }).toString(),
    });
    expect(response.status).toBe(403);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should send inert, uncacheable pages that reveal no referrer", async () => {
    const response = await get("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const policy = response.headers.get("content-security-policy");
    expect(policy).toContain("default-src 'none'");
    // The shell embeds the logo, favicons, and typeface as data: URIs, so the
    // product's own chrome must not be blocked on the product's own page - and
    // nothing beyond data: is ever allowed, so no byte comes from the network.
    expect(policy).toContain("img-src data:");
    expect(policy).toContain("font-src data:");
    expect(policy).not.toContain("http");
  });

  it("should defend every response it makes, not only the pages", async () => {
    // A cross-origin page can navigate a window straight at any of these, so
    // the rules the HTML routes carry are the rules all of them carry.
    for (const response of [
      await get("/healthz"),
      // Unarmed, so this is the refusal a browser could otherwise cache and
      // replay in place of the page the stop redirect is aimed at.
      await get("/stopped"),
      await rawResponse({ path: "/healthz", host: "plan-review.evil.test" }),
    ]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
    }
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

  it("should finish closing even while a client holds a request open", async () => {
    // A parked request is not idle, so waiting for it would mean never
    // settling: a listener-less process, and the record of it left on disk.
    const parked = httpRequest({
      host: "127.0.0.1",
      port: runtime.port,
      path: "/stop",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "100",
      },
    });
    parked.on("error", () => {});
    await new Promise<void>((settle) => {
      parked.write("nonce=", () => settle());
    });

    await runtime.close();

    await expect(get("/healthz")).rejects.toThrow();
  });

  it("should leave no record behind when an HTTP stop ends it", async () => {
    // The advisory record names a pid and a port. The HTTP stop is the path
    // both the CLI and the browser use, so a record that outlived it would
    // describe a process that no longer exists.
    const stopping = await startService({
      readToken: async () => token,
      version: "9.9.9-test",
      port: 0,
      onClosed: async () => {
        await clearServiceRuntimeRecord({ pid: process.pid });
      },
    });
    await writeServiceRuntimeRecord({
      pid: process.pid,
      port: stopping.port,
      startedAt: new Date().toISOString(),
      managedBy: "on-demand",
    });
    expect(await readServiceRuntimeRecord()).not.toBe(undefined);

    const stopped = await fetch(`${stopping.origin}/stop`, {
      method: "POST",
      headers: { "x-big-plan-service-token": token },
    });
    expect(stopped.status).toBe(200);

    await vi.waitFor(async () => {
      expect(await readServiceRuntimeRecord()).toBe(undefined);
    });
  });

  it("should leave no record behind when a browser stops it", async () => {
    const stopping = await startService({
      readToken: async () => token,
      version: "9.9.9-test",
      port: 0,
      onClosed: async () => {
        await clearServiceRuntimeRecord({ pid: process.pid });
      },
    });
    await writeServiceRuntimeRecord({
      pid: process.pid,
      port: stopping.port,
      startedAt: new Date().toISOString(),
      managedBy: "on-demand",
    });
    const nonce = /name="nonce" type="hidden" value="([^"]+)"/u.exec(
      await (await fetch(`${stopping.origin}/stop`)).text(),
    )?.[1];
    await fetch(`${stopping.origin}/stop`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ nonce: nonce ?? "" }).toString(),
    });
    expect((await fetch(`${stopping.origin}/stopped`)).status).toBe(200);

    await vi.waitFor(async () => {
      expect(await readServiceRuntimeRecord()).toBe(undefined);
    });
  });
});
