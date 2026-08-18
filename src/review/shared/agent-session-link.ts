// Decides whether a declared agent session can be opened, and refuses to guess.
//
// An agent can say anything about where its conversation lives, and the first
// thing a reviewer did with a declared address was click it and land nowhere.
// A link that does not open is worse than no link: it spends the reader's
// attention and their trust, and it does it silently.
//
// So linkability is decided here rather than taken from the declaration. Only
// the interfaces below are known to answer a URL a browser can follow, and a
// declaration that does not match one of them is treated as an identifier: the
// reader is offered the string to copy into whatever tool it belongs to,
// instead of a link Big Plan cannot stand behind.
//
// Adding an interface is deliberately a code change with a shape stated in it.
// The alternative - accepting any https URL - is how the broken link arrived.

export type LinkableAgentInterface =
  "claude-code-web" | "codex-web" | "grok-web";

type InterfaceShape = {
  readonly id: LinkableAgentInterface;
  /** Hosts, matched exactly or as a subdomain, that serve this interface. */
  readonly hosts: ReadonlyArray<string>;
  /** The path a conversation lives under on those hosts. */
  readonly path: RegExp;
};

/*
The table. Each entry is one interface whose conversation URLs are known to
open, matched on host and path rather than on host alone, because the host
alone would accept a marketing page as a conversation.

The desktop applications for these products open the same addresses their web
interfaces do, so an entry covers both surfaces of its product rather than
claiming a separate desktop shape. A desktop-only scheme - anything that is not
http or https - is never linked: the browser showing this card cannot know
whether that application exists on the reader's machine, and a link that opens
nothing is the failure this table exists to prevent.
*/
const LINKABLE_INTERFACES: ReadonlyArray<InterfaceShape> = [
  {
    id: "claude-code-web",
    hosts: ["claude.ai", "claude.com"],
    path: /^\/code\/[^/]+/u,
  },
  {
    id: "codex-web",
    hosts: ["chatgpt.com", "chat.openai.com"],
    path: /^\/codex\/[^/]+/u,
  },
  {
    id: "grok-web",
    hosts: ["grok.com"],
    path: /^\/(?:chat|c)\/[^/]+/u,
  },
];

const hostMatches = (host: string, allowed: string): boolean =>
  host === allowed || host.endsWith(`.${allowed}`);

export type AgentSessionAffordance =
  | {
      readonly kind: "link";
      readonly href: string;
      readonly interfaceId: LinkableAgentInterface;
    }
  | { readonly kind: "identifier"; readonly value: string }
  | { readonly kind: "none" };

/**
 * Chooses what a session declaration earns: a link, a copyable identifier, or
 * nothing at all when nothing was declared.
 */
export const agentSessionAffordance = ({
  sessionUrl,
  sessionId,
}: {
  readonly sessionUrl?: string;
  readonly sessionId?: string;
}): AgentSessionAffordance => {
  if (sessionUrl !== undefined) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(sessionUrl);
    } catch {
      parsed = undefined;
    }
    const shape =
      parsed === undefined || parsed.protocol !== "https:"
        ? undefined
        : LINKABLE_INTERFACES.find(
            (candidate) =>
              candidate.hosts.some((host) =>
                hostMatches(parsed.hostname, host),
              ) && candidate.path.test(parsed.pathname),
          );
    return shape === undefined
      ? { kind: "identifier", value: sessionUrl }
      : { kind: "link", href: sessionUrl, interfaceId: shape.id };
  }
  return sessionId === undefined
    ? { kind: "none" }
    : { kind: "identifier", value: sessionId };
};
