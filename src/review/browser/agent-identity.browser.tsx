// Owns how the review island names the agent on the other end.
//
// Several surfaces say who an agent is - every card on the agent rail, and a
// pushed arrival in the feed - and they are read minutes apart in the same
// session. Composing the same line at each of them let them drift into three
// ways of writing one agent's name, which reads as three agents. The catalog
// already owns the lookup from what the connector declared to what a vendor
// writes; this owns the one line those lookups are arranged into, and nothing
// else.

import type { ReactNode } from "react";
import { Fragment } from "react";
import type { BrandIcon } from "../../icons/brand-icon.js";
import { CLAUDE_ICON } from "../../icons/brands/claude.js";
import { GROK_ICON } from "../../icons/brands/grok.js";
import { MISTRAL_ICON } from "../../icons/brands/mistral.js";
import { OPENAI_ICON } from "../../icons/brands/openai.js";
import {
  agentClientDisplayName,
  agentModelDisplayName,
  agentModelVendor,
  type AgentModelVendor,
} from "../shared/agent-identity-catalog.js";
import { BrandIconView } from "./icon.browser.js";

/** The quiet identity chip shared by agent-facing review entries. */
export const AgentIdentityChip = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <span className="w-fit rounded-sm bg-surface px-1.5 py-0.5 text-2xs font-semibold text-ink">
    {children}
  </span>
);

/**
 * The agent's name, and the tool it is connected through when it declared one.
 * The client is deliberately secondary: it answers "which window is this?"
 * after the model has already answered "who is this?".
 */
export const AgentIdentityText = ({
  label,
  client,
}: {
  readonly label: string;
  readonly client: string | undefined;
}) => (
  <>
    {label}
    {client === undefined ? null : (
      <span className="font-normal text-muted">
        {" · "}
        {agentClientDisplayName(client)}
      </span>
    )}
  </>
);

const VENDOR_ICONS: Record<AgentModelVendor, BrandIcon> = {
  openai: OPENAI_ICON,
  claude: CLAUDE_ICON,
  grok: GROK_ICON,
  mistral: MISTRAL_ICON,
};

/**
 * Draws the reported model's own mark, or nothing at all.
 *
 * A model the catalog has no faithful mark for shows its name alone. The
 * generic robot that used to stand in was a placeholder in the literal sense:
 * it occupied the space a mark would occupy while identifying nobody.
 */
export const ModelIcon = ({ modelName }: { readonly modelName: string }) => {
  const vendor = agentModelVendor(modelName);
  return vendor === undefined ? null : (
    <BrandIconView icon={VENDOR_ICONS[vendor]} />
  );
};

// Four characters, because that is what a reviewer compares against the handle
// their agent's own tool printed: enough to tell two attached sessions apart,
// and short enough to sit at the end of a line without taking it over.
const SESSION_TAIL_LENGTH = 4;

/**
 * The tail of a session handle, marked as a tail.
 *
 * The ellipsis leads, because the characters kept are the END of the handle -
 * the same end every other tool prints. A leading mark over a leading slice
 * is the mismatch that had a reviewer checking a card against their terminal
 * and finding the two disagreeing about which end had been cut.
 */
export const agentSessionTail = (handle: string): string =>
  `\u2026${handle.slice(-SESSION_TAIL_LENGTH)}`;

/** What a connector said about itself, as one agent card needs to read it. */
export type AgentIdentityFacts = {
  /** The provider's canonical model id, as declared. */
  readonly model?: string;
  /**
   * How hard the connector was told to think, when it reports it. It sits
   * directly after the model because it qualifies the model and nothing else.
   */
  readonly effort?: string;
  /** The tool the agent is connected through, as declared. */
  readonly client?: string;
  /** The conversation handle the connector declared, when it declared one. */
  readonly sessionId?: string;
  /**
   * This agent's id on the roster, which names the session when the connector
   * declared no handle of its own. It is the only name such an agent has, and
   * it is stable across the short-lived processes one agent answers through.
   */
  readonly writerId?: string;
};

type AgentIdentitySegment = {
  readonly key: "model" | "effort" | "client" | "session";
  readonly text: string;
};

/**
 * The one identity line, in the order a reviewer asks it: who is this, which
 * tool is it in, and which of its conversations am I looking at.
 *
 * Each segment is independent, because each is declared independently, and a
 * segment nobody declared is left out rather than filled in. The catalog
 * decides how a declared id is written - never this module, and never by
 * re-casing what a vendor was handed.
 */
export const agentIdentitySegments = ({
  model,
  effort,
  client,
  sessionId,
  writerId,
}: AgentIdentityFacts): ReadonlyArray<AgentIdentitySegment> => {
  const handle = sessionId ?? writerId;
  return [
    model === undefined
      ? undefined
      : ({ key: "model", text: agentModelDisplayName(model) } as const),
    effort === undefined
      ? undefined
      : ({ key: "effort", text: effort } as const),
    client === undefined
      ? undefined
      : ({ key: "client", text: agentClientDisplayName(client) } as const),
    handle === undefined
      ? undefined
      : ({ key: "session", text: agentSessionTail(handle) } as const),
  ].filter((segment) => segment !== undefined);
};

/**
 * The identity line every agent card wears, in every state it can be in.
 *
 * One component rather than one per card, because a reviewer reads these
 * minutes apart in the same rail and three ways of writing one agent's name
 * read as three agents. It was three: the status card wrote client, model and
 * effort; a roster card wrote model and client; an arriving agent wrote
 * client, model and a session tail - so the same agent changed shape as it
 * moved between them (BIG-273).
 *
 * It renders nothing when nothing was declared and there is no roster id to
 * stand in. A line saying so would occupy the space an answer occupies while
 * carrying none.
 */
export const AgentIdentityLine = ({
  model,
  effort,
  client,
  sessionId,
  writerId,
}: AgentIdentityFacts) => {
  const segments = agentIdentitySegments({
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(client === undefined ? {} : { client }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(writerId === undefined ? {} : { writerId }),
  });
  if (segments.length === 0) return null;
  return (
    <span
      className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-full border border-current/20 bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-2 py-0.5 text-2xs font-semibold text-ink [&>svg]:size-3"
      {...(model === undefined ? {} : { "data-review-agent-model": model })}
      {...(effort === undefined ? {} : { "data-review-agent-effort": effort })}
      {...(client === undefined ? {} : { "data-review-agent-client": client })}
      {...(writerId === undefined
        ? {}
        : { "data-review-agent-writer": writerId })}
    >
      {model === undefined ? null : <ModelIcon modelName={model} />}
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index === 0 ? null : (
            /* The separator carries its own even spacing rather than
               inheriting the row's gap on one side only. */
            <span aria-hidden="true" className="shrink-0 opacity-50">
              ·
            </span>
          )}
          <span
            className={
              /* The session tail is fixed-width and the whole point of its
                 being there, so the names give way before it does. The effort
                 is a qualifier rather than a name, and reads as one. */
              segment.key === "session" || segment.key === "effort"
                ? "shrink-0 font-normal text-muted"
                : "min-w-0 truncate"
            }
          >
            {segment.text}
          </span>
        </Fragment>
      ))}
    </span>
  );
};
