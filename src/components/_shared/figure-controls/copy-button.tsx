// Owns the shared direct copy control used by component-rendered code figures.
// The viewer script wires the dormant button to the figure's hidden source.

import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

const BUTTON_CLASSES =
  "figure-control inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors hover:bg-transparent hover:text-ink focus-visible:bg-transparent focus-visible:text-ink focus-visible:shadow-focus focus-visible:outline-none [&_svg]:size-3.5";

export const CopyButton = ({
  subject,
}: {
  readonly subject: "code" | "diff" | "schema" | "table";
}) => {
  const label =
    subject === "diff"
      ? "Copy diff"
      : subject === "schema"
        ? "Copy schema"
        : subject === "table"
          ? "Copy table"
          : "Copy code";
  return (
    <button
      type="button"
      className={BUTTON_CLASSES}
      aria-label={label}
      data-tooltip={label}
      data-tooltip-delay="1s"
      hidden
      data-copy-source=""
    >
      {lucideIconToReact({ icon: COPY_ICON, hidden: false })}
      {lucideIconToReact({ icon: CHECK_ICON, hidden: true })}
    </button>
  );
};
