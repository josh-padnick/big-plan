// Owns the Agent Status mark and the viewer-chrome control that opens the
// agent sidebar. Both live here because the chrome control and the sidebar's
// own heading must show the identical mark for the identical state.

import type { LucideIcon } from "../../icons/lucide-icon.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { CIRCLE_ICON } from "../../icons/lucide/circle.js";
import { SQUARE_ICON } from "../../icons/lucide/square.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type {
  AgentHealth,
  AgentHealthIndicator,
} from "../shared/agent-status.js";
import { Icon } from "./icon.browser.js";

/** The label is fixed so the control never changes width as the state changes. */
export const AGENT_STATUS_LABEL = "Agent Status";

/** Closing the sidebar has to put focus back here, from wherever it closed. */
export const AGENT_STATUS_TRIGGER_ID = "review-agent-trigger";

// Shape carries the state alongside colour: a filled dot for healthy, the
// hazard triangle for warning, a filled square for error, and a question mark
// for a state the review session cannot observe. Each entry is a complete
// static class string so the candidate stays discoverable in source.
const INDICATOR_PRESENTATION: Record<
  AgentHealthIndicator,
  { readonly icon: LucideIcon; readonly className: string }
> = {
  healthy: {
    icon: CIRCLE_ICON,
    className: "text-success [&>svg]:fill-current",
  },
  warning: { icon: TRIANGLE_ALERT_ICON, className: "text-warning" },
  error: { icon: SQUARE_ICON, className: "text-danger [&>svg]:fill-current" },
  unavailable: { icon: CIRCLE_QUESTION_MARK_ICON, className: "text-muted" },
};

/**
 * Draws one status mark; the caller owns its size through the surrounding text.
 * A working agent keeps the orbiting ring around its mark, because "connected"
 * and "connected and doing something right now" are different glances.
 */
export const AgentStatusGlyph = ({
  indicator,
  isWorking = false,
}: {
  readonly indicator: AgentHealthIndicator;
  readonly isWorking?: boolean;
}) => {
  const presentation = INDICATOR_PRESENTATION[indicator];
  return (
    <span
      className={`review-agent-active-indicator inline-flex shrink-0 items-center ${isWorking ? "review-agent-active-indicator--working" : ""} ${presentation.className}`}
      data-review-agent-status={indicator}
      aria-hidden="true"
    >
      <Icon icon={presentation.icon} />
    </span>
  );
};

/**
 * The one entry point to the agent sidebar in viewer chrome. It keeps the same
 * shape, width, and label in every state, and it stays legible when the sidebar
 * is closed, so a reader never has to open anything to learn the agent is fine.
 */
export const AgentStatusTrigger = ({
  status,
  isWorking,
  isSelected,
  onToggle,
}: {
  readonly status: AgentHealth;
  readonly isWorking: boolean;
  readonly isSelected: boolean;
  readonly onToggle: () => void;
}) => (
  <button
    id={AGENT_STATUS_TRIGGER_ID}
    type="button"
    className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-muted shadow-none hover:bg-surface hover:text-ink hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed aria-expanded:border-accent aria-expanded:bg-accent-wash aria-expanded:text-accent aria-expanded:shadow-raised wide:min-h-8 [&>span>svg]:size-3.5"
    aria-expanded={isSelected}
    aria-controls="big-plan-feedback-sidebar"
    aria-label={`${AGENT_STATUS_LABEL}: ${status.label}`}
    onClick={onToggle}
  >
    <AgentStatusGlyph indicator={status.indicator} isWorking={isWorking} />
    {AGENT_STATUS_LABEL}
  </button>
);
