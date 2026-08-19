// Reading the one form this service accepts: the stop confirmation's nonce.
//
// The rule this module exists to hold is that the promise settles exactly once
// for every request, including one that was already aborted before it was ever
// called. The handler awaits this, so a request that never settles keeps its
// own request and response objects alive for the life of the process, and any
// local client can abort as many of them as it likes.

import type { IncomingMessage } from "node:http";

// A stop form is a handful of bytes; anything larger is not one, and reading
// it would only give an unauthenticated caller a way to occupy memory.
const MAX_FORM_BYTES = 4 * 1024;

/** Reads a stop form's nonce, or undefined when there is none to read. */
export const readFormNonce = async (
  request: IncomingMessage,
): Promise<string | undefined> =>
  new Promise((settle) => {
    let body = "";
    let overflowed = false;
    request.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      body += chunk.toString("utf8");
      if (body.length > MAX_FORM_BYTES) {
        overflowed = true;
        body = "";
      }
    });
    request.on("end", () => {
      settle(
        overflowed
          ? undefined
          : (new URLSearchParams(body).get("nonce") ?? undefined),
      );
    });
    request.on("error", () => settle(undefined));
    // `close` answers a client that aborts while the body is being read. The
    // check below answers one that aborted earlier still: that event has
    // already fired, and a listener added afterwards can never hear it, so the
    // state of the stream is the only thing left to ask.
    request.on("close", () => settle(undefined));
    if (request.destroyed || request.closed || request.readableEnded) {
      settle(undefined);
    }
  });
