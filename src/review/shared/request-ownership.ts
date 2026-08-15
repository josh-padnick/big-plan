// Owns the browser-safe fact that distinguishes queued reviewer work from a
// request the agent has started.

export type OwnableRequest = {
  readonly claimedAt?: string;
};

export const agentOwnsRequest = (request: OwnableRequest): boolean =>
  request.claimedAt !== undefined;
