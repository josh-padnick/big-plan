// Owns the browser-safe lifecycle rule for whether an agent still owes one
// request an answer.

import { requestIsCanceled, type CancelableRequest } from "./cancel-pending.js";

/** Decides outstanding work from its answer and effective cancellation state. */
export const requestIsOutstanding = ({
  request,
  answeredRequestIds,
  cancelPendingRequestIds,
}: {
  readonly request: CancelableRequest;
  readonly answeredRequestIds: ReadonlySet<string>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
}): boolean =>
  !answeredRequestIds.has(request.requestId) &&
  !requestIsCanceled({ request, pendingRequestIds: cancelPendingRequestIds });
