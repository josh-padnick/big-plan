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
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  renderPlanEndedPage,
  renderPlanInterruptedPage,
  renderPlanNeverStartedPage,
  renderPlanUnknownPage,
  renderServiceStopConfirmPage,
  renderServiceStoppedPage,
  renderServiceWelcomePage,
} from "../../render/service-page.js";
import { answerForPlan } from "./plan-status.js";
import { readFormNonce } from "./stop-form.js";
import { servicePort } from "./paths.js";
import { isServicePlanId } from "./registry.js";

const TOKEN_HEADER = "x-big-plan-service-token";
const PLAN_ROUTE = /^\/plan\/([a-z0-9]+)\/?$/;

// A stop posted from the identity page carries this instead of the owner
// token. The browser must never hold the token that authorizes the CLI, but
// same-origin checks alone are not a credential, so the page gets one of its
// own: minted per boot, kept in memory, never written to disk, and embedded
// only in pages this very process served. It dies with the process, which is
// exactly the lifetime a page-scoped credential should have.

// How long the service waits for a browser to follow the stop redirect before
// shutting down anyway. Long enough for a slow page load, short enough that an
// abandoned stop is still a stop.
const ABANDONED_STOP_MS = 10_000;

// How long a connection that is not idle gets to finish before it is dropped,
// matching the session runtime's own shutdown grace.
const SHUTDOWN_GRACE_MS = 100;

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

// The session runtime sends these on every response it makes, and so does
// this one: a rule that holds for the HTML routes and not for the JSON or
// plain-text ones is an approximation of that runtime, not a copy of it.
//
// The pages are self-contained: every byte they need is inline or a data:
// URI, so nothing here may reach the network. data: is allowed for images and
// fonts because the shared shell embeds the Big Plan logo, the favicons, and
// the typeface that way; without it the product's own chrome is blocked on its
// own page. form-action is named explicitly because it does not fall back to
// default-src, and the stop flow is a form: this is what stops a page from
// being tricked into posting it somewhere else. frame-ancestors is what stops
// a page on another origin from framing the stop confirmation and harvesting a
// click against a nonce this process itself issued, which every same-origin
// check here would then accept.
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

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
    ...SECURITY_HEADERS,
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
    ...SECURITY_HEADERS,
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const sendRedirect = ({
  response,
  status,
  location,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly location: string;
}): void => {
  response.writeHead(status, {
    location,
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
  });
  response.end();
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
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    ...SECURITY_HEADERS,
  });
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
  onClosed,
}: {
  readonly readToken: () => Promise<string | undefined>;
  readonly version: string;
  readonly port?: number;
  readonly now?: number;
  /**
   * Runs once after the listener closes, however the stop arrived.
   *
   * Every way this process ends passes through the same `close`, so anything
   * the process leaves behind on disk is cleaned up here rather than at each
   * call site, where the HTTP stop - the path people actually use - would be
   * the easiest one to forget.
   */
  readonly onClosed?: () => Promise<void>;
}): Promise<ServiceRuntime> => {
  const startedAtMs = now;
  const pageNonce = randomBytes(32).toString("base64url");
  // Armed only by an authenticated stop, and only once. A browser stop is a
  // form post, so it answers with a redirect rather than a page: refreshing
  // afterwards must not re-submit it. The process therefore has to outlive its
  // own POST long enough to serve one more GET, and `/stopped` is that page.
  // Unarmed it does not exist, so nobody can end the service by guessing a URL.
  let stopArmed = false;

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
        html: renderServiceWelcomePage({ port: boundPort, startedAtMs }),
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
          sendRedirect({ response, status: 302, location: answer.url });
          return;
        case "ended":
          sendHtml({
            response,
            status: 200,
            html: renderPlanEndedPage({
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
            html: renderPlanInterruptedPage({
              planPath: answer.planPath,
              lastSeenAtMs: answer.lastSeenAtMs,
            }),
          });
          return;
        case "never-started":
          sendHtml({
            response,
            status: 200,
            html: renderPlanNeverStartedPage({ planPath: answer.planPath }),
          });
          return;
        case "unknown":
          sendHtml({ response, status: 404, html: renderPlanUnknownPage() });
          return;
      }
    }

    if (method === "GET" && target.pathname === "/stopped") {
      if (!stopArmed) {
        refuse({ response, status: 404, reason: "No such route" });
        return;
      }
      stopArmed = false;
      sendHtml({ response, status: 200, html: renderServiceStoppedPage() });
      // The last thing this process does. Closing after the response finishes
      // is what makes the page's own warning true: reloading it errors,
      // because by then nothing is listening.
      response.on("finish", () => {
        void close();
      });
      return;
    }

    if (method === "GET" && target.pathname === "/stop") {
      // A link, not a scripted button, so the whole stop flow works with
      // scripts disabled.
      sendHtml({
        response,
        status: 200,
        html: renderServiceStopConfirmPage({
          port: boundPort,
          startedAtMs,
          nonce: pageNonce,
        }),
      });
      return;
    }

    if (method === "POST" && target.pathname === "/stop") {
      // No CORS allowance is ever sent, so a browser hides the response - but
      // a simple cross-origin POST still arrives and would still be executed
      // without these checks.
      //
      // "null" is an absent origin claim, not a foreign one, and this page
      // produces it on purpose: a form navigation from a response carrying
      // Referrer-Policy: no-referrer is sent with Origin: null. Refusing it
      // would mean refusing the service's own stop form. Sec-Fetch-Site below
      // is the check that actually distinguishes where a request came from,
      // and it stays unconditional; the credential still has to be one this
      // process issued.
      const requestOrigin = request.headers.origin;
      if (
        requestOrigin !== undefined &&
        requestOrigin !== "null" &&
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
      // Either credential authorizes a stop, and one of them is required:
      // the owner token for the CLI and the runtime relay, the page nonce for
      // a page this process served. A request carrying neither is refused.
      //
      // The body is claimed before the token is read, not after: a request
      // that aborts during that read has already announced it, and listeners
      // attached afterwards would wait for an event that has been and gone.
      const formNonce = readFormNonce(request);
      const supplied = request.headers[TOKEN_HEADER];
      const expected = await readToken();
      const byToken =
        expected !== undefined &&
        typeof supplied === "string" &&
        constantTimeEquals(supplied, expected);
      const byNonce =
        !byToken && constantTimeEquals((await formNonce) ?? "", pageNonce);
      if (!byToken && !byNonce) {
        refuse({
          response,
          status: 401,
          reason: "Missing or wrong credential",
        });
        return;
      }
      if (byNonce) {
        // Post/Redirect/Get: the browser lands on a page it can safely reload
        // rather than on a form post it would re-submit. The process stays up
        // for exactly that one GET.
        stopArmed = true;
        sendRedirect({ response, status: 303, location: "/stopped" });
        // A browser that never follows the redirect must not leave the service
        // running after someone asked it to stop.
        const abandoned = setTimeout(() => {
          if (!stopArmed) return;
          stopArmed = false;
          void close();
        }, ABANDONED_STOP_MS);
        abandoned.unref();
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
    // The session runtime's shutdown shape: idle connections go at once and
    // the rest are forced shut after the grace, because a client parked
    // mid-request is not idle and would otherwise keep this from ever
    // settling - leaving a listener-less process and a record of it on disk.
    const closedServer = new Promise<void>((settle) => {
      server.close(() => settle());
    });
    server.closeIdleConnections();
    const forceClose = setTimeout(() => {
      server.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);
    forceClose.unref();
    try {
      await closedServer;
    } finally {
      clearTimeout(forceClose);
    }
    try {
      await onClosed?.();
    } catch {
      // Whatever it was tidying is advisory: `/healthz` is what liveness is
      // read from, and a listener that is already closed stays closed.
    }
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
