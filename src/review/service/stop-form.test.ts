// Proves the stop form's reader always settles, against real request objects
// from a real listener rather than a hand-rolled stream.
//
// The case that matters is an abort that happened before the reader was ever
// called: the handler reads the owner token from disk first, and a client that
// disappears during that read has already emitted every event it will emit.

import { createServer, request as httpRequest } from "node:http";
import type { ClientRequest, IncomingMessage, Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { readFormNonce } from "./stop-form.js";

let server: Server | undefined;

// The handler deliberately never answers: the request object stays open and
// unread, exactly as it is while the service awaits something else.
const postToListener = async (
  headers: Record<string, string> = {},
): Promise<{
  readonly client: ClientRequest;
  readonly received: Promise<IncomingMessage>;
}> => {
  let deliver: ((request: IncomingMessage) => void) | undefined;
  const received = new Promise<IncomingMessage>((settle) => {
    deliver = settle;
  });
  const created = createServer((request) => deliver?.(request));
  await new Promise<void>((settle) => {
    created.listen({ host: "127.0.0.1", port: 0 }, () => settle());
  });
  server = created;
  const address = created.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const client = httpRequest({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/stop",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });
  client.on("error", () => {});
  return { client, received };
};

afterEach(async () => {
  if (server === undefined) return;
  server.closeAllConnections();
  await new Promise<void>((settle) => server?.close(() => settle()));
  server = undefined;
});

describe("reading a stop form", () => {
  it("should answer with the nonce a complete form carried", async () => {
    const { client, received } = await postToListener();
    client.end("nonce=page-nonce-value");

    await expect(readFormNonce(await received)).resolves.toBe(
      "page-nonce-value",
    );
  });

  it("should settle for a request that was already aborted before it was read", async () => {
    // The reported leak: the abort lands while the handler awaits the token,
    // so by the time the body is claimed there is no future event to wait for.
    const { client, received } = await postToListener({
      "content-length": "100",
    });
    client.write("nonce=");
    const incoming = await received;
    await new Promise<void>((settle) => {
      incoming.on("close", () => settle());
      client.destroy();
    });
    expect(incoming.destroyed || incoming.closed).toBe(true);

    await expect(readFormNonce(incoming)).resolves.toBe(undefined);
  });

  it("should settle for a request aborted while it is being read", async () => {
    const { client, received } = await postToListener({
      "content-length": "100",
    });
    client.write("nonce=");
    const pending = readFormNonce(await received);
    client.destroy();

    await expect(pending).resolves.toBe(undefined);
  });

  it("should refuse a body too large to be a stop form", async () => {
    const { client, received } = await postToListener();
    client.write("nonce=");
    const pending = readFormNonce(await received);
    client.end("x".repeat(8 * 1024));

    await expect(pending).resolves.toBe(undefined);
  });
});
