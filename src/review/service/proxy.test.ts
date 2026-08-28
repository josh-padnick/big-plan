// Proves BIG-236's stable hop across the two real listeners. The service and
// session remain separate processes in production; separate listeners here
// preserve the address, origin, and route boundary the browser actually sees.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startReviewRuntime } from "../server.js";
import type { ReviewRuntime } from "../server.js";
import { REVIEW_HEARTBEAT_INTERVAL_MS } from "../session-authority.js";
import {
  MAX_IMAGE_BYTES,
  RAW_IMAGE_BODY_LIMIT,
} from "../shared/review-image.js";
import {
  deriveReviewPlanId,
  prepareStore,
  reviewStoreFor,
  writeSessionDescriptorValue,
  writeSessionHeartbeatValue,
} from "../store.js";
import { rememberPlan } from "./registry.js";
import { startService } from "./server.js";
import type { ServiceRuntime } from "./server.js";

// Cold document rendering competes with the full suite's renderer workers.
// This test still owns a finite bound, but not Vitest's too-tight 5s default.
const PROXY_INTEGRATION_TEST_TIMEOUT_MS = 90_000;
const MAX_PROXY_OVERHEAD_BASELINE_MULTIPLE = 8;

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

type ChildRuntime = {
  readonly process: ChildProcess;
  readonly port: number;
  readonly url: string;
};

/** Starts a separate runtime-shaped listener that can be killed without cleanup. */
const startChildRuntime = async (
  label: string,
  readDelayMs = 0,
): Promise<ChildRuntime> => {
  const source = `
    const { createServer } = require("node:http");
    const server = createServer((request, response) => {
      let bytes = 0;
      request.on("data", (chunk) => {
        bytes += chunk.length;
        if (${readDelayMs} > 0) {
          request.pause();
          setTimeout(() => request.resume(), ${readDelayMs});
        }
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": request.method === "GET" ? "text/plain" : "application/json" });
        response.end(request.method === "GET" ? ${JSON.stringify(label)} : JSON.stringify({ bytes }));
      });
    });
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      process.stdout.write(JSON.stringify(server.address()) + "\\n");
    });
  `;
  const child = spawn(process.execPath, ["-e", source], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const line = await new Promise<string>((settle, fail) => {
    let output = "";
    child.once("error", fail);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline !== -1) settle(output.slice(0, newline));
    });
  });
  const address: unknown = JSON.parse(line);
  if (
    typeof address !== "object" ||
    address === null ||
    !("port" in address) ||
    typeof address.port !== "number"
  ) {
    child.kill("SIGKILL");
    throw new Error("The child runtime reported no port");
  }
  return {
    process: child,
    port: address.port,
    url: `http://127.0.0.1:${address.port}/`,
  };
};

/** Streams a generated body from another process and reports the HTTP answer. */
const uploadFromChild = async ({
  url,
  byteLength,
}: {
  readonly url: string;
  readonly byteLength: number;
}): Promise<{ readonly status: number; readonly body: string }> => {
  const source = `
    const { request } = require("node:http");
    const target = new URL(process.argv[1]);
    const byteLength = Number(process.argv[2]);
    const outgoing = request(target, {
      method: "POST",
      headers: {
        "content-length": String(byteLength),
        "content-type": "image/png",
        "x-big-plan-review-token": "A".repeat(43),
        "sec-fetch-site": "same-origin",
        "origin": target.origin,
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => process.stdout.write(JSON.stringify({ status: response.statusCode, body }) + "\\n"));
    });
    outgoing.on("error", (error) => { throw error; });
    const chunk = Buffer.alloc(64 * 1024);
    let written = 0;
    const write = () => {
      while (written < byteLength) {
        const size = Math.min(chunk.length, byteLength - written);
        written += size;
        if (!outgoing.write(size === chunk.length ? chunk : chunk.subarray(0, size))) {
          outgoing.once("drain", write);
          return;
        }
      }
      outgoing.end();
    };
    write();
  `;
  const child = spawn(
    process.execPath,
    ["-e", source, url, String(byteLength)],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const line = await new Promise<string>((settle, fail) => {
    let output = "";
    child.once("error", fail);
    child.once("exit", (code) => {
      if (code !== 0) fail(new Error(`Upload child exited with ${code}`));
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline !== -1) settle(output.slice(0, newline));
    });
  });
  const result: unknown = JSON.parse(line);
  if (
    typeof result !== "object" ||
    result === null ||
    !("status" in result) ||
    typeof result.status !== "number" ||
    !("body" in result) ||
    typeof result.body !== "string"
  ) {
    throw new Error("Upload child returned an invalid result");
  }
  return { status: result.status, body: result.body };
};

/** Returns the middle observed duration without letting one cold run dominate. */
const median = (samples: ReadonlyArray<number>): number => {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? Number.NaN;
};

/** Measures one complete response, including consumption of its body. */
const responseDurationMs = async ({
  url,
  headers,
}: {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}): Promise<number> => {
  const startedAt = performance.now();
  const response = await fetch(url, { headers });
  await response.arrayBuffer();
  expect(response.status).toBe(200);
  return performance.now() - startedAt;
};

/** Waits until a child has observed the requested ungraceful ending. */
const killChild = async (
  runtime: ChildRuntime,
  signal: NodeJS.Signals = "SIGKILL",
): Promise<void> => {
  if (
    runtime.process.exitCode !== null ||
    runtime.process.signalCode !== null
  ) {
    return;
  }
  const exited = new Promise<void>((settle) => {
    runtime.process.once("exit", () => settle());
  });
  runtime.process.kill(signal);
  await exited;
};

describe("the stable review proxy", () => {
  let stateDirectory: string;
  let planDirectory: string;
  let planPath: string;
  let service: ServiceRuntime | undefined;
  let review: ReviewRuntime | undefined;
  let previousStateDirectory: string | undefined;
  let previousPort: string | undefined;
  let previousProxy: string | undefined;
  let childRuntimes: Array<ChildRuntime>;

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
    childRuntimes = [];
  });

  afterEach(async () => {
    await Promise.all([
      service?.close().catch(() => undefined),
      review?.close().catch(() => undefined),
      ...childRuntimes.map((runtime) => killChild(runtime)),
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
    review = await startReviewRuntime({ planPath });
    await rememberPlan({ planId: review.planId, planPath: review.planPath });
    // Rendering a cold document can monopolize this test worker while the full
    // suite is saturated. Pin service time for pair tests so that scheduler
    // delay cannot masquerade as a missed heartbeat; the outage tests below
    // advance their own clocks explicitly.
    const observedAtMs = Date.now();
    service = await startService({
      readToken: async () => "service-owner-token",
      version: "9.9.9-proxy-test",
      clock: () => observedAtMs,
    });
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

  const activateChild = async ({
    runtime,
    sessionId,
    updatedAtMs,
  }: {
    readonly runtime: ChildRuntime;
    readonly sessionId: string;
    readonly updatedAtMs: number;
  }): Promise<string> => {
    const planId = deriveReviewPlanId({ planPath });
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    await rememberPlan({ planId, planPath });
    await writeSessionDescriptorValue({
      store,
      value: {
        version: 1,
        sessionId,
        planId,
        plan: planPath,
        url: runtime.url,
        port: runtime.port,
        pid: runtime.process.pid ?? 0,
        startedAt: new Date(updatedAtMs).toISOString(),
        token: "A".repeat(43),
      },
    });
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs },
    });
    return planId;
  };

  it("should preserve the redirect when the startup switch is off", async () => {
    process.env["BIG_PLAN_PROXY"] = "0";
    const running = await startPair();
    process.env["BIG_PLAN_PROXY"] = "1";

    const response = await fetch(
      `${running.service.origin}/plan/${running.review.planId}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(running.review.url);

    // Nothing the hop taught this address may reach a switched-off service.
    // Without the hop there is no document reading its own address here, so a
    // request that states a non-document destination still gets the page it
    // got before the switch existed.
    await running.review.close();
    const ended = await fetch(
      `${running.service.origin}/plan/${running.review.planId}`,
      {
        redirect: "manual",
        headers: {
          "sec-fetch-dest": "empty",
          "sec-fetch-site": "same-origin",
        },
      },
    );
    expect(ended.status).toBe(200);
    expect(ended.headers.get("content-type")).toContain("text/html");
  });

  it("should keep the stable address when the startup switch is unset", async () => {
    delete process.env["BIG_PLAN_PROXY"];
    const running = await startPair();
    process.env["BIG_PLAN_PROXY"] = "0";

    const response = await fetch(
      `${running.service.origin}/plan/${running.review.planId}/`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(200);
    expect(response.url).toBe(
      `${running.service.origin}/plan/${running.review.planId}/`,
    );
  });

  it(
    "should serve identical bytes and accept browser reads and writes through the hop",
    async () => {
      delete process.env["BIG_PLAN_PROXY"];
      const running = await startPair();
      delete process.env["BIG_PLAN_PROXY"];
      const planPrefix = `/plan/${running.review.planId}/`;

      const canonical = await fetch(
        `${running.service.origin}${planPrefix.slice(0, -1)}`,
        { redirect: "manual" },
      );
      expect(canonical.status).toBe(302);
      expect(canonical.headers.get("location")).toBe(planPrefix);

      // Avoid asking one runtime to cold-render the same document twice at once;
      // the byte comparison needs both paths, not simultaneous compilation.
      const directDocument = await fetch(running.review.url).then((response) =>
        response.arrayBuffer(),
      );
      const proxiedResponse = await fetch(
        `${running.service.origin}${planPrefix}`,
        { redirect: "manual" },
      );
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
    },
    PROXY_INTEGRATION_TEST_TIMEOUT_MS,
  );

  it("should refuse a document's own requests once the session it was served by is gone", async () => {
    delete process.env["BIG_PLAN_PROXY"];
    const running = await startPair();
    delete process.env["BIG_PLAN_PROXY"];
    const planPrefix = `/plan/${running.review.planId}/`;
    await running.review.close();

    const [page, refresh, poll, image] = await Promise.all([
      fetch(`${running.service.origin}${planPrefix}`, {
        redirect: "manual",
        headers: { "sec-fetch-dest": "document" },
      }),
      // The open document refetching its own address to pick up a revision.
      // It shares that address with the navigation above and reads the answer
      // as the plan, so it must be told the runtime is gone rather than handed
      // a status page it would report as a plan with no reading surface.
      fetch(`${running.service.origin}${planPrefix}`, {
        redirect: "manual",
        headers: { "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin" },
      }),
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
    for (const answer of [refresh, poll, image]) {
      expect(answer.ok).toBe(false);
      expect(answer.status).toBe(502);
      expect(answer.headers.get("content-type")).not.toContain("text/html");
    }
  });

  it("should answer as a gateway when the runtime stops answering after the lookup", async () => {
    delete process.env["BIG_PLAN_PROXY"];
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

    expect(answer.status).toBe(503);
    expect(answer.headers.get("retry-after")).toBe("1");
  });

  it("should hold a SIGKILLed review at one and ten seconds and recover at the same address", async () => {
    const startedAtMs = Date.parse("2026-08-27T20:00:00.000Z");
    let observedAtMs = startedAtMs;
    const first = await startChildRuntime("first runtime");
    childRuntimes.push(first);
    const planId = await activateChild({
      runtime: first,
      sessionId: "1111111111111111",
      updatedAtMs: startedAtMs,
    });
    service = await startService({
      readToken: async () => "service-owner-token",
      version: "9.9.9-restart-test",
      clock: () => observedAtMs,
    });
    const stableUrl = `${service.origin}/plan/${planId}/`;
    expect(await (await fetch(stableUrl)).text()).toBe("first runtime");

    await killChild(first, "SIGKILL");
    observedAtMs = startedAtMs + 1_000;
    const afterOneSecond = await fetch(stableUrl);
    expect(afterOneSecond.status).toBe(200);
    expect(await afterOneSecond.text()).toContain("The review is restarting.");

    observedAtMs = startedAtMs + 10_000;
    const afterTenSeconds = await fetch(stableUrl);
    expect(afterTenSeconds.status).toBe(200);
    expect(await afterTenSeconds.text()).toContain("The review is restarting.");

    const second = await startChildRuntime("second runtime");
    childRuntimes.push(second);
    await activateChild({
      runtime: second,
      sessionId: "2222222222222222",
      updatedAtMs: observedAtMs,
    });
    observedAtMs += REVIEW_HEARTBEAT_INTERVAL_MS;

    const restarted = await fetch(stableUrl);
    expect(restarted.status).toBe(200);
    expect(restarted.url).toBe(stableUrl);
    expect(await restarted.text()).toBe("second runtime");
  });

  it("should cache resolution for one heartbeat and evict it on connect failure", async () => {
    const startedAtMs = Date.parse("2026-08-27T21:00:00.000Z");
    let observedAtMs = startedAtMs;
    const first = await startChildRuntime("cached first runtime");
    childRuntimes.push(first);
    const planId = await activateChild({
      runtime: first,
      sessionId: "3333333333333333",
      updatedAtMs: startedAtMs,
    });
    service = await startService({
      readToken: async () => "service-owner-token",
      version: "9.9.9-cache-test",
      clock: () => observedAtMs,
    });
    const stableUrl = `${service.origin}/plan/${planId}/`;
    expect(await (await fetch(stableUrl)).text()).toBe("cached first runtime");

    const second = await startChildRuntime("replacement runtime");
    childRuntimes.push(second);
    observedAtMs += 100;
    await activateChild({
      runtime: second,
      sessionId: "4444444444444444",
      updatedAtMs: observedAtMs,
    });
    expect(await (await fetch(stableUrl)).text()).toBe("cached first runtime");

    await killChild(first, "SIGKILL");
    expect(await (await fetch(stableUrl)).text()).toContain(
      "The review is restarting.",
    );
    expect(await (await fetch(stableUrl)).text()).toBe("replacement runtime");
  });

  it("should refuse a protocol upgrade explicitly", async () => {
    delete process.env["BIG_PLAN_PROXY"];
    const running = await startPair();
    const statusLine = await new Promise<string>((settle, fail) => {
      const socket = connect({
        host: "127.0.0.1",
        port: running.service.port,
      });
      let response = "";
      socket.once("error", fail);
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
      });
      socket.once("close", () => settle(response.split("\r\n")[0] ?? ""));
      socket.write(
        `GET /plan/${running.review.planId}/ HTTP/1.1\r\nHost: 127.0.0.1:${running.service.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });

    expect(statusLine).toBe("HTTP/1.1 426 Upgrade Required");
  });

  it("should bound measured direct-to-stable-hop overhead", async () => {
    delete process.env["BIG_PLAN_PROXY"];
    const running = await startPair();
    const planPrefix = `/plan/${running.review.planId}/`;
    const browserReadHeaders = {
      "x-big-plan-review-token": running.token,
      "sec-fetch-site": "same-origin",
    };
    const routes = [
      {
        route: "document",
        direct: running.review.url,
        proxied: `${running.service.origin}${planPrefix}`,
        iterations: 3,
      },
      {
        route: "poll",
        direct: `${running.review.url}api/drafts`,
        proxied: `${running.service.origin}${planPrefix}api/drafts`,
        headers: browserReadHeaders,
        iterations: 10,
      },
    ] as const;

    const overheadTable = [];
    for (const route of routes) {
      const directSamples: Array<number> = [];
      const proxiedSamples: Array<number> = [];
      for (let iteration = 0; iteration < route.iterations; iteration += 1) {
        directSamples.push(
          await responseDurationMs({
            url: route.direct,
            ...(route.headers === undefined ? {} : { headers: route.headers }),
          }),
        );
        proxiedSamples.push(
          await responseDurationMs({
            url: route.proxied,
            ...(route.headers === undefined ? {} : { headers: route.headers }),
          }),
        );
      }
      const directMedianMs = median(directSamples);
      const proxiedMedianMs = median(proxiedSamples);
      overheadTable.push({
        route: route.route,
        directMedianMs,
        proxiedMedianMs,
        overheadMs: proxiedMedianMs - directMedianMs,
      });
    }

    expect(overheadTable).toHaveLength(routes.length);
    for (const row of overheadTable) {
      expect(Number.isFinite(row.directMedianMs)).toBe(true);
      expect(Number.isFinite(row.proxiedMedianMs)).toBe(true);
      expect(Number.isFinite(row.overheadMs)).toBe(true);
      expect(row.overheadMs).toBeLessThanOrEqual(
        row.directMedianMs * MAX_PROXY_OVERHEAD_BASELINE_MULTIPLE,
      );
    }
    // TODO(BIG-236): Reconcile these regression bounds with the authoritative
    // plan overhead table's exact stated figures when Firstmate supplies it.
  });

  it("should stream a 10 MiB request without retaining one body in proxy RSS", async () => {
    const startedAtMs = Date.now();
    const upstream = await startChildRuntime("stream target", 2);
    childRuntimes.push(upstream);
    const planId = await activateChild({
      runtime: upstream,
      sessionId: "5555555555555555",
      updatedAtMs: startedAtMs,
    });
    service = await startService({
      readToken: async () => "service-owner-token",
      version: "9.9.9-memory-test",
    });
    const uploadUrl = `${service.origin}/plan/${planId}/api/review-images`;

    const warmup = await uploadFromChild({
      url: uploadUrl,
      byteLength: 1024 * 1024,
    });
    expect(warmup.status).toBe(200);

    const baselineRss = process.memoryUsage.rss();
    let peakRss = baselineRss;
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage.rss());
    }, 1);
    const uploaded = await uploadFromChild({
      url: uploadUrl,
      byteLength: MAX_IMAGE_BYTES,
    }).finally(() => clearInterval(sampler));

    expect(uploaded.status).toBe(200);
    expect(JSON.parse(uploaded.body)).toEqual({ bytes: MAX_IMAGE_BYTES });
    expect(peakRss - baselineRss).toBeLessThan(MAX_IMAGE_BYTES);
  });

  it("should let the runtime accept a 10 MiB image and own its larger-body refusal", async () => {
    delete process.env["BIG_PLAN_PROXY"];
    const running = await startPair();
    const planPrefix = `/plan/${running.review.planId}/`;
    const image = Buffer.alloc(MAX_IMAGE_BYTES);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
    image.writeUInt32BE(1, 16);
    image.writeUInt32BE(1, 20);
    const headers = {
      "x-big-plan-review-token": running.token,
      "sec-fetch-site": "same-origin",
      origin: running.service.origin,
      "content-type": "image/png",
      "x-big-plan-image-alt": "Ten MiB capture",
    };

    const accepted = await fetch(
      `${running.service.origin}${planPrefix}api/review-images`,
      { method: "POST", headers, body: image },
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      byteLength: MAX_IMAGE_BYTES,
      width: 1,
      height: 1,
    });

    const refused = await fetch(
      `${running.service.origin}${planPrefix}api/review-images`,
      {
        method: "POST",
        headers,
        body: Buffer.alloc(RAW_IMAGE_BODY_LIMIT + 1),
      },
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: "The image body is too large",
    });
  });
});
