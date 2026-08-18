// The local service: one loopback listener on a fixed port that owns every
// saved review address.
//
// It holds no review state. Given a plan id it reads the registry for where
// that plan lives, reads that plan's own session files for what happened, and
// either redirects to the live session or explains the ending. Redirecting
// rather than proxying is deliberate: the session runtime authenticates every
// request against its own host and origin, so putting a second process in the
// path would mean moving that protection into this one.
//
// The request rules below are the session runtime's rules, copied on purpose
// rather than approximated, because this process is reachable by any page the
// reviewer's browser happens to be showing.

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { answerForPlan } from "./plan-status.js";
import {
  endedReviewPage,
  identityPage,
  interruptedReviewPage,
  neverStartedReviewPage,
  unknownPlanPage,
} from "./pages.js";
import { servicePort } from "./paths.js";
import { isServicePlanId } from "./registry.js";

const TOKEN_HEADER = "x-big-plan-service-token";
const PLAN_ROUTE = /^\/plan\/([a-z0-9]+)\/?$/;

/** What `GET /healthz` answers, and the only thing that proves identity. */
export const SERVICE_PRODUCT = "big-plan-service";

export type ServiceHealth = {
  readonly product: typeof SERVICE_PRODUCT;
  /**
   * The build this process came from.
   *
   * Nothing restarts the service on upgrade, so without this a months-old
   * process could keep serving old pages while the installed docs describe
   * something else. A link-printing command compares it and respawns on a
   * mismatch.
   */
  readonly version: string;
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
};

export type ServiceRuntime = {
  readonly port: number;
  readonly origin: string;
  readonly startedAtMs: number;
  readonly close: () => Promise<void>;
};

const sendHtml = ({
  response,
  status,
  html,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly html: string;
}): void => {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    // The pages are self-contained; nothing they need comes from anywhere
    // else, so the policy that says so is free to be this strict.
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(html);
};

const sendJson = ({
  response,
  status,
  value,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly value: unknown;
}): void => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const refuse = ({
  response,
  status,
  reason,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly reason: string;
}): void => {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(`${reason}\n`);
};

const constantTimeEquals = (supplied: string, expected: string): boolean => {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Starts the service and resolves once it is listening.
 *
 * `readToken` is called per mutating request rather than once at boot. The
 * token is owner-only on disk and the CLI may re-mint it; a service holding a
 * boot-time copy would keep refusing its own operator until it was restarted.
 * A browser never holds this credential: the CLI reads the file directly, and
 * the session runtime relays stop requests server-side.
 */
export const startService = async ({
  readToken,
  version,
  port = servicePort(),
  now = Date.now(),
}: {
  readonly readToken: () => Promise<string | undefined>;
  readonly version: string;
  readonly port?: number;
  readonly now?: number;
}): Promise<ServiceRuntime> => {
  const startedAtMs = now;

  const handle = async ({
    request,
    response,
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<void> => {
    // The port actually bound, which is the configured one in production and
    // an OS-assigned one under test. Read from the socket rather than trusted
    // from configuration, the same way the session runtime does it.
    const address = server.address();
    const boundPort =
      typeof address === "object" && address !== null ? address.port : port;

    // Anti-rebinding, first and unconditionally, exactly as the session
    // runtime does it: a hostname that resolves to 127.0.0.1 is same-origin to
    // the browser, so only the Host header proves where a request thinks it is.
    const host = request.headers.host;
    if (
      host !== `127.0.0.1:${boundPort}` &&
      host !== `localhost:${boundPort}`
    ) {
      refuse({ response, status: 403, reason: "Unrecognised host" });
      return;
    }

    const target = new URL(request.url ?? "/", `http://127.0.0.1:${boundPort}`);
    const method = request.method ?? "GET";

    if (method === "GET" && target.pathname === "/healthz") {
      const health: ServiceHealth = {
        product: SERVICE_PRODUCT,
        version,
        pid: process.pid,
        port: boundPort,
        startedAt: new Date(startedAtMs).toISOString(),
      };
      sendJson({ response, status: 200, value: health });
      return;
    }

    if (method === "GET" && target.pathname === "/") {
      sendHtml({
        response,
        status: 200,
        html: identityPage({ port: boundPort, startedAtMs }),
      });
      return;
    }

    const planRoute = PLAN_ROUTE.exec(target.pathname);
    if (method === "GET" && planRoute !== null) {
      const planId = planRoute[1] ?? "";
      // A malformed id is answered like an unknown one rather than with a
      // validation error, because the visitor clicked a link and cannot act
      // on the difference.
      const answer = isServicePlanId(planId)
        ? await answerForPlan({ planId })
        : ({ kind: "unknown" } as const);
      switch (answer.kind) {
        case "live":
          response.writeHead(302, {
            location: answer.url,
            "cache-control": "no-store",
          });
          response.end();
          return;
        case "ended":
          sendHtml({
            response,
            status: 200,
            html: endedReviewPage({
              planPath: answer.planPath,
              reason: answer.reason,
              atMs: answer.atMs,
            }),
          });
          return;
        case "interrupted":
          sendHtml({
            response,
            status: 200,
            html: interruptedReviewPage({
              planPath: answer.planPath,
              lastSeenAtMs: answer.lastSeenAtMs,
            }),
          });
          return;
        case "never-started":
          sendHtml({
            response,
            status: 200,
            html: neverStartedReviewPage({ planPath: answer.planPath }),
          });
          return;
        case "unknown":
          sendHtml({ response, status: 404, html: unknownPlanPage() });
          return;
      }
    }

    if (method === "POST" && target.pathname === "/stop") {
      // No CORS allowance is ever sent, so a browser hides the response - but
      // a simple cross-origin POST still arrives and would still be executed
      // without these checks.
      const requestOrigin = request.headers.origin;
      if (
        requestOrigin !== undefined &&
        requestOrigin !== `http://127.0.0.1:${boundPort}` &&
        requestOrigin !== `http://localhost:${boundPort}`
      ) {
        refuse({ response, status: 403, reason: "Foreign origin" });
        return;
      }
      const site = request.headers["sec-fetch-site"];
      if (typeof site === "string" && site !== "same-origin") {
        refuse({ response, status: 403, reason: "Foreign site" });
        return;
      }
      const supplied = request.headers[TOKEN_HEADER];
      const expected = await readToken();
      if (
        expected === undefined ||
        typeof supplied !== "string" ||
        !constantTimeEquals(supplied, expected)
      ) {
        refuse({ response, status: 401, reason: "Missing or wrong token" });
        return;
      }
      sendJson({ response, status: 200, value: { stopping: true } });
      // Answered before the listener closes, so the caller learns the request
      // was accepted rather than seeing its connection cut mid-reply.
      response.on("finish", () => {
        void close();
      });
      return;
    }

    refuse({ response, status: 404, reason: "No such route" });
  };

  const server: Server = createServer((request, response) => {
    void handle({ request, response }).catch(() => {
      // A handler that threw has already told the visitor nothing useful; the
      // service stays up, because a dead service turns every saved link back
      // into a connection error.
      if (!response.headersSent) {
        refuse({ response, status: 500, reason: "Request failed" });
        return;
      }
      response.end();
    });
  });

  await new Promise<void>((settle, fail) => {
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.removeListener("error", fail);
      settle();
    });
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((settle) => {
      server.close(() => settle());
      server.closeIdleConnections();
    });
  };
  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : port;
  return {
    port: boundPort,
    origin: `http://127.0.0.1:${boundPort}`,
    startedAtMs,
    close,
  };
};
