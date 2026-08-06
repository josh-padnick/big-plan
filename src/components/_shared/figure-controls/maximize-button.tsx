// Owns the React edge of the maximize control: one dormant button that every
// component-rendered figure shares, so five figure families cannot drift into
// five slightly different affordances. The contract it writes lives in
// _model/figure-controls; the HAST edge for plain fenced code writes the same
// attributes from that same module.

import { MAXIMIZE_2_ICON } from "../../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../../icons/lucide/minimize-2.js";
import {
  TRIGGER_ATTRIBUTE,
  maximizeLabel,
} from "../../_model/figure-controls/figure-controls.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

// A transparent resting state keeps the control quieter than the figure it
// acts on; hover and focus still reveal the full affordance.
const BUTTON_CLASSES =
  "figure-control inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors hover:bg-transparent hover:text-ink focus-visible:bg-transparent focus-visible:text-ink focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-c)_20%,transparent)] focus-visible:outline-none";

const BUTTON_SIZE_CLASSES = {
  compact: "h-6 w-6 [&_svg]:size-3.5",
  toolbar: "h-9 w-9 [&_svg]:size-4",
} as const;

/**
 * Renders the dormant maximize control. Both glyphs ship server-side so the
 * viewer script only ever toggles visibility, never builds markup.
 */
export const MaximizeButton = ({
  subject,
  size = "compact",
}: {
  readonly subject: string;
  readonly size?: keyof typeof BUTTON_SIZE_CLASSES;
}) => {
  const label = maximizeLabel(subject);
  return (
    <button
      type="button"
      className={`${BUTTON_CLASSES} ${BUTTON_SIZE_CLASSES[size]}`}
      aria-label={label}
      data-tooltip={label}
      data-tooltip-delay="1s"
      hidden
      {...{ [TRIGGER_ATTRIBUTE]: "" }}
    >
      {lucideIconToReact({ icon: MAXIMIZE_2_ICON, hidden: false })}
      {lucideIconToReact({ icon: MINIMIZE_2_ICON, hidden: true })}
    </button>
  );
};
