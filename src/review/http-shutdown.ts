// How every loopback listener in this product shuts down, owned once.
//
// Both listeners - the session runtime and the local link service - have the
// same problem: a client parked mid-request is not idle, so waiting on it
// would mean never finishing. Two copies of that policy would drift, and the
// drift would only show up as one of the two hanging on shutdown.

import type { Server } from "node:http";

// How long a connection that is not idle gets to finish before it is dropped.
const SHUTDOWN_GRACE_MS = 100;

/**
 * Closes a bound server without waiting on its connections: idle ones are
 * dropped at once and the rest are forced shut after the shutdown grace, so a
 * request arriving at the wrong moment cannot keep close() from settling.
 */
export const drainAndCloseServer = async (server: Server): Promise<void> => {
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
};
