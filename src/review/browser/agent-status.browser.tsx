// Owns the Agent Status mark and the viewer-chrome control that opens the
// agent sidebar. Both live here because the chrome control and the sidebar's
// own heading must show the identical mark for the identical state.

import type { LucideIcon } from "../../icons/lucide-icon.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { CIRCLE_ICON } from "../../icons/lucide/circle.js";
import { LOCK_ICON } from "../../icons/lucide/lock.js";
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

// Shape carries the state alongside colour: a filled dot for healthy, the same
// dot fading for working, a padlock for a session that has gone read-only, the
// hazard triangle for an agent that is gone, and a question mark for a state
// the review session cannot observe.
//
// A padlock rather than a second triangle for read-only: the hazard mark now
// belongs to the offline state, and two triangles apart only by colour would
// leave a reader who cannot separate amber from red unable to tell a locked
// session from a lost agent.
//
// The filled dot is drawn smaller than the outlined glyphs, at the captain's
// measurement: a disc reads far heavier than a line drawing of the same width,
// so matching their boxes makes the dot the loudest thing in the toolbar.
// Every entry is a complete static class string so each Tailwind candidate
// stays discoverable in source.
const FILLED_MARK = "[&>svg]:size-2 [&>svg]:fill-current";
const OUTLINED_MARK = "[&>svg]:size-3.5";

// The working mark is the connected dot with work happening inside it: the same
// green, the same box, drawn as a three-by-three grid whose ring brightens one
// position at a time. It says "busy" through motion rather than through a
// second colour, which keeps the state readable for a reader who cannot
// separate the greens, and it never grows past the dot it replaces.
//
// It is drawn as SVG rather than as nine elements, because at this size CSS
// boxes are the wrong tool: a two-pixel round div lands on fractional device
// pixels and antialiases into an oval, so the dots come out visibly different
// shapes. An SVG circle is a circle at any scale, and the mark then matches the
// other status glyphs, which are all SVG.
//
// Geometry is stated in the icon system's own 24-unit box so it sits beside
// those glyphs unconverted: centres nine units apart, and a radius that leaves
// the dots almost touching. The captain chose this weight against a lighter one
// - heavier dots, a deeper drop between lit and unlit, and a quicker cycle read
// as more insistent without moving differently.
const SWEEP_CENTRES = [3, 12, 21] as const;
const SWEEP_DELAYS = [
  "[animation-delay:0ms]",
  "[animation-delay:163ms]",
  "[animation-delay:325ms]",
  "[animation-delay:1138ms]",
  null,
  "[animation-delay:488ms]",
  "[animation-delay:975ms]",
  "[animation-delay:813ms]",
  "[animation-delay:650ms]",
] as const;

const AgentWorkingMark = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-2 shrink-0 fill-current text-agent-live"
    aria-hidden="true"
  >
    {SWEEP_DELAYS.map((delay, index) => (
      <circle
        key={index}
        cx={SWEEP_CENTRES[index % 3]}
        cy={SWEEP_CENTRES[Math.floor(index / 3)]}
        r={3.7}
        className={
          delay === null
            ? "opacity-75"
            : `opacity-15 animate-agent-sweep motion-reduce:animate-none motion-reduce:opacity-75 ${delay}`
        }
      />
    ))}
  </svg>
);

const INDICATOR_PRESENTATION: Record<
  AgentHealthIndicator,
  { readonly icon: LucideIcon; readonly className: string }
> = {
  healthy: {
    icon: CIRCLE_ICON,
    className: `text-agent-live ${FILLED_MARK}`,
  },
  // The working state draws its own mark rather than an icon; the entry keeps
  // its shape so the record stays exhaustive over the indicators.
  working: {
    icon: CIRCLE_ICON,
    className: `text-agent-live ${FILLED_MARK}`,
  },
  warning: { icon: LOCK_ICON, className: `text-warning ${OUTLINED_MARK}` },
  error: {
    icon: TRIANGLE_ALERT_ICON,
    className: `text-danger ${OUTLINED_MARK}`,
  },
  unavailable: {
    icon: CIRCLE_QUESTION_MARK_ICON,
    className: `text-muted ${OUTLINED_MARK}`,
  },
};

/** Draws one status mark; the caller owns its size through the surrounding text. */
export const AgentStatusGlyph = ({
  indicator,
}: {
  readonly indicator: AgentHealthIndicator;
}) => {
  const presentation = INDICATOR_PRESENTATION[indicator];
  return (
    <span
      className={`inline-flex shrink-0 items-center ${presentation.className}`}
      data-review-agent-status={indicator}
      aria-hidden="true"
    >
      {indicator === "working" ? (
        <AgentWorkingMark />
      ) : (
        <Icon icon={presentation.icon} />
      )}
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
  className,
  isSelected,
  onToggle,
}: {
  readonly status: AgentHealth;
  /** The toolbar owns the shared control look; this owns only the mark. */
  readonly className: string;
  readonly isSelected: boolean;
  readonly onToggle: () => void;
}) => (
  <button
    id={AGENT_STATUS_TRIGGER_ID}
    type="button"
    className={className}
    aria-expanded={isSelected}
    aria-controls="big-plan-feedback-sidebar"
    aria-label={`${AGENT_STATUS_LABEL}: ${status.label}`}
    onClick={onToggle}
  >
    {/* The mark sits a step further from the label than the toolbar's shared
        gap, at the captain's measurement: a small dot needs the extra air to
        read as a status rather than as punctuation. It is set here rather than
        on the shared control class so the Feedback button keeps its own
        spacing. */}
    <span className="mr-0.5 inline-flex">
      <AgentStatusGlyph indicator={status.indicator} />
    </span>
    {AGENT_STATUS_LABEL}
  </button>
);
