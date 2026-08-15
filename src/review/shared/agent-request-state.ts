// Owns browser-safe terminal-state facts shared by agent request readers.

export type TerminalAgentRequest = {
  readonly answeredAt?: string;
  readonly canceledAt?: string;
};

/** True once an agent request has reached either durable terminal state. */
export const requestIsTerminal = (request: TerminalAgentRequest): boolean =>
  request.answeredAt !== undefined || request.canceledAt !== undefined;
