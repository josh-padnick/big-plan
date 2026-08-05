// The local review runtime: the loopback server that renders the plan, serves
// that document, holds the reviewer's drafts, and writes the feedback package
// on Send.
//
// Loopback is not an authentication boundary. Any page the reviewer visits can
// reach 127.0.0.1, and any process running as the reviewer can too, so every
// request is authorised on its own merits here rather than trusted because of
// where it arrived from:
//
//  - Bound explicitly to 127.0.0.1 on an ephemeral port. Never 0.0.0.0, never
//    a hostname.
//  - A per-session token, minted at start and injected into the one document
//    this runtime serves, is required on every API request and travels in a
//    header so it stays out of history, referrers, and logs.
//  - Any request whose Host header is not this runtime's own address is
//    refused. That, not the address check, is what defeats DNS rebinding.
//  - No CORS allowance is ever sent, and a foreign Origin or a Sec-Fetch-Site
//    other than same-origin is refused outright. CORS hides a response; it
//    does not stop a write, so it is not the control here.
//  - A fixed route-and-method allow-list. No static passthrough, no directory
//    listing, and no path segment that reaches the filesystem.
//  - The document is always rendered in-process from the authoritative MDX. A
//    pre-existing .html is never served, because arbitrary HTML is arbitrary
//    script running on this runtime's own origin.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";
import {
  derivePlanId,
  renderDocument,
  MarkdownDiagnosticsError,
} from "../render/render-document.js";
import type { BlockMapEntry, ReviewComment } from "./comment.js";
import {
  CommentRejected,
  validateActiveDraft,
  validateComments,
} from "./comment.js";
import { buildFeedbackPackage, renderBrief } from "./feedback-package.js";
import {
  appendProgress,
  prepareStore,
  randomId,
  readActiveDraft,
  readComments,
  readProgress,
  reviewStoreFor,
  writeActiveDraft,
  writeComments,
  writeFeedbackPackage,
  writeSessionDescriptor,
} from "./store.js";
import type { ReviewStore } from "./store.js";

type ReviewRuntimeOperations = {
  readonly createServer: typeof createServer;
  readonly writeSessionDescriptor: typeof writeSessionDescriptor;
};

const DEFAULT_OPERATIONS: ReviewRuntimeOperations = {
  createServer,
  writeSessionDescriptor,
};

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT_BYTES = 1024 * 1024;

// Everything the document needs is embedded, and the only origin it may reach
// is this runtime. The browser enforces the egress boundary the design claims.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

type Route = {
  readonly method: "GET" | "PUT" | "POST";
  readonly path: string;
};

const DOCUMENT_ROUTE: Route = { method: "GET", path: "/" };

// The whole surface. A request that does not match one of these pairs exactly
// is refused before anything else looks at it.
const API_ROUTES: ReadonlyArray<Route> = [
  { method: "GET", path: "/api/session" },
  { method: "GET", path: "/api/drafts" },
  { method: "PUT", path: "/api/drafts" },
  { method: "POST", path: "/api/feedback" },
  { method: "GET", path: "/api/progress" },
];

/** A running review runtime. */
export type ReviewRuntime = {
  readonly url: string;
  readonly port: number;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly store: ReviewStore;
  readonly close: () => Promise<void>;
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // Length is not secret, and timingSafeEqual requires equal lengths.
  return a.length === b.length && timingSafeEqual(a, b);
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new CommentRejected("The request body is too large");
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CommentRejected("The request body is not valid JSON");
  }
};

const send = ({
  response,
  status,
  contentType,
  body,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  response.end(body);
};

const sendJson = ({
  response,
  status,
  value,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly value: unknown;
}): void =>
  send({
    response,
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(value),
  });

const refuse = ({
  response,
  status,
  reason,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly reason: string;
}): void => sendJson({ response, status, value: { error: reason } });

/**
 * Starts the review runtime for one plan and resolves once it is listening.
 * The caller owns the plan path; nothing about a request ever contributes one.
 */
export const startReviewRuntime = async ({
  planPath,
  operations = DEFAULT_OPERATIONS,
  validatePlan,
}: {
  readonly planPath: string;
  readonly operations?: ReviewRuntimeOperations;
  readonly validatePlan: (input: { readonly markdown: string }) => void;
}): Promise<ReviewRuntime> => {
  const resolvedPlanPath = resolve(planPath);
  const planId = derivePlanId({ planPath: resolvedPlanPath });
  const sessionId = randomId(8);
  const token = randomBytes(32).toString("base64url");
  const store = reviewStoreFor({ planPath: resolvedPlanPath, planId });
  await prepareStore(store);

  // Every block this session has served, so a draft written against an earlier
  // render still resolves after the agent revises the plan. Phase 1 does not
  // re-anchor; it simply refuses to forget what it once addressed.
  const blocks = new Map<string, BlockMapEntry>();
  let progressSeq = 0;

  const validate = (value: unknown): ReadonlyArray<ReviewComment> =>
    validateComments({ value, blocks, now: new Date().toISOString() });

  const readBootstrap = async (): Promise<string> =>
    JSON.stringify({
      drafts: await readComments({ path: store.draftsPath, validate }),
      sent: await readComments({ path: store.sentPath, validate }),
      activeDraft: await readActiveDraft({
        path: store.activeDraftPath,
        validate: validateActiveDraft,
      }),
    });

  const renderPlan = async (): Promise<string> => {
    const markdown = await readFile(resolvedPlanPath, "utf8");
    validatePlan({ markdown });
    const firstPass = renderDocument({
      markdown,
      fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
      identity: { planId, reviewSessionId: sessionId, reviewToken: token },
    });
    for (const block of firstPass.blocks) {
      blocks.set(block.id, block);
    }
    return renderDocument({
      markdown,
      fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
      identity: {
        planId,
        reviewSessionId: sessionId,
        reviewToken: token,
        reviewBootstrap: await readBootstrap(),
      },
    }).html;
  };

  const handleDocument = async (response: ServerResponse): Promise<void> => {
    try {
      send({
        response,
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: await renderPlan(),
      });
    } catch (error: unknown) {
      const detail =
        error instanceof MarkdownDiagnosticsError
          ? error.diagnostics
              .map(
                ({ line, column, message }) =>
                  `${line ?? "?"}:${column ?? "?"} ${message}`,
              )
              .join("\n")
          : String(error);
      send({
        response,
        status: 500,
        contentType: "text/plain; charset=utf-8",
        body: `The plan could not be rendered.\n\n${detail}\n`,
      });
    }
  };

  const handleApi = async ({
    route,
    request,
    response,
  }: {
    readonly route: Route;
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<void> => {
    if (route.path === "/api/session") {
      sendJson({
        response,
        status: 200,
        value: { sessionId, planId, plan: resolvedPlanPath },
      });
      return;
    }
    if (route.path === "/api/drafts" && route.method === "GET") {
      // The document must exist before drafts can be resolved, because the
      // block map is what makes a stored target meaningful.
      await renderPlan();
      sendJson({
        response,
        status: 200,
        value: {
          drafts: await readComments({ path: store.draftsPath, validate }),
          sent: await readComments({ path: store.sentPath, validate }),
          activeDraft: await readActiveDraft({
            path: store.activeDraftPath,
            validate: validateActiveDraft,
          }),
        },
      });
      return;
    }
    if (route.path === "/api/drafts") {
      const body = await readBody(request);
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const drafts = validate(payload.drafts);
      const activeDraft = validateActiveDraft(payload.activeDraft);
      await writeComments({ path: store.draftsPath, comments: drafts });
      await writeActiveDraft({
        path: store.activeDraftPath,
        value: activeDraft,
      });
      sendJson({ response, status: 200, value: { drafts: drafts.length } });
      return;
    }
    if (route.path === "/api/feedback") {
      const body = await readBody(request);
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const comments = validate(payload.comments);
      if (comments.length === 0) {
        refuse({ response, status: 400, reason: "Nothing to send" });
        return;
      }
      const feedback = buildFeedbackPackage({
        sessionId,
        packageId: randomId(8),
        planId,
        planPath: resolvedPlanPath,
        createdAt: new Date().toISOString(),
        comments,
      });
      const written = await writeFeedbackPackage({
        store,
        feedback,
        brief: renderBrief(feedback),
      });
      const alreadySent = await readComments({
        path: store.sentPath,
        validate,
      });
      await writeComments({
        path: store.sentPath,
        comments: [...alreadySent, ...comments],
      });
      await writeComments({ path: store.draftsPath, comments: [] });
      await writeActiveDraft({ path: store.activeDraftPath, value: "" });
      progressSeq += 1;
      // The one event the runtime can honestly author: it has the package.
      // Everything after this belongs to the agent that reads the channel.
      await appendProgress({
        store,
        event: {
          sessionId,
          seq: progressSeq,
          step: "Feedback package received",
          state: "done",
          detail: `${comments.length} comment${comments.length === 1 ? "" : "s"}`,
        },
      });
      sendJson({
        response,
        status: 200,
        value: {
          packageId: feedback.packageId,
          comments: comments.length,
          package: written.jsonPath,
          brief: written.briefPath,
        },
      });
      return;
    }
    const events = await readProgress({ store, sessionId });
    progressSeq = Math.max(
      progressSeq,
      events.reduce((highest, event) => Math.max(highest, event.seq), 0),
    );
    sendJson({ response, status: 200, value: { events } });
  };

  const server: Server = operations.createServer((request, response) => {
    void handle({ request, response });
  });

  const handle = async ({
    request,
    response,
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<void> => {
    try {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      const expectedHost = `127.0.0.1:${port}`;
      const origin = `http://${expectedHost}`;

      // Anti-rebinding, first and unconditionally: a name that resolves to
      // 127.0.0.1 is same-origin to the browser, so the address a request
      // arrived on proves nothing and the Host header is what must match.
      if (request.headers.host !== expectedHost) {
        refuse({ response, status: 403, reason: "Unrecognised host" });
        return;
      }

      const target = new URL(request.url ?? "/", origin);
      const method = request.method ?? "GET";

      if (method === DOCUMENT_ROUTE.method && target.pathname === "/") {
        await handleDocument(response);
        return;
      }

      const route = API_ROUTES.find(
        (candidate) => candidate.path === target.pathname,
      );
      if (route === undefined) {
        refuse({ response, status: 404, reason: "No such route" });
        return;
      }
      const allowed = API_ROUTES.filter(
        (candidate) => candidate.path === target.pathname,
      );
      const matched = allowed.find((candidate) => candidate.method === method);
      if (matched === undefined) {
        refuse({ response, status: 405, reason: "Method not allowed here" });
        return;
      }

      // No CORS allowance is ever sent, so a browser hides the response - but
      // a simple cross-origin POST still arrives, and would still be executed
      // without this check. These two headers are what refuse the write.
      const requestOrigin = request.headers.origin;
      if (requestOrigin !== undefined && requestOrigin !== origin) {
        refuse({ response, status: 403, reason: "Foreign origin" });
        return;
      }
      const site = request.headers["sec-fetch-site"];
      if (typeof site === "string" && site !== "same-origin") {
        refuse({ response, status: 403, reason: "Foreign site" });
        return;
      }

      const supplied = request.headers[TOKEN_HEADER];
      if (
        typeof supplied !== "string" ||
        !constantTimeEquals(supplied, token)
      ) {
        refuse({
          response,
          status: 401,
          reason: "Missing or wrong session token",
        });
        return;
      }

      await handleApi({ route: matched, request, response });
    } catch (error: unknown) {
      if (error instanceof CommentRejected) {
        refuse({ response, status: 400, reason: error.message });
        return;
      }
      refuse({ response, status: 500, reason: "The review runtime failed" });
    }
  };

  await new Promise<void>((settle, fail) => {
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port: 0 }, settle);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}/`;

  try {
    await operations.writeSessionDescriptor({
      store,
      descriptor: {
        version: 1,
        sessionId,
        planId,
        plan: resolvedPlanPath,
        url,
        port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        // The token is here so the reviewer's own tools can reach the runtime;
        // the file is owner-only, which is what keeps that safe.
        token,
      },
    });
  } catch (error: unknown) {
    await new Promise<void>((settle) => {
      server.close(() => settle());
    });
    throw error;
  }

  return {
    url,
    port,
    sessionId,
    planId,
    planPath: resolvedPlanPath,
    store,
    close: () =>
      new Promise<void>((settle) => {
        server.close(() => settle());
      }),
  };
};
