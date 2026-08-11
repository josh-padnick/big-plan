// Owns the browser-safe rule for an optimistic cancellation. A poll may return
// older request data while the cancel write is still in flight, so local
// intent remains active until the server confirms it.

export type CancelableRequest = {
  readonly requestId: string;
  readonly canceledAt?: string;
};

export const requestIsCanceled = ({
  request,
  pendingRequestIds,
}: {
  readonly request: CancelableRequest;
  readonly pendingRequestIds: ReadonlySet<string>;
}): boolean =>
  request.canceledAt !== undefined || pendingRequestIds.has(request.requestId);

export const reconcilePendingCancellations = ({
  pendingRequestIds,
  requests,
}: {
  readonly pendingRequestIds: ReadonlySet<string>;
  readonly requests: ReadonlyArray<CancelableRequest>;
}): ReadonlySet<string> => {
  const confirmed = new Set(
    requests.flatMap((request) =>
      request.canceledAt === undefined ? [] : [request.requestId],
    ),
  );
  return new Set(
    [...pendingRequestIds].filter((requestId) => !confirmed.has(requestId)),
  );
};
