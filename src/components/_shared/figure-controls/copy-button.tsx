// Owns the shared direct copy control used by React-rendered source figures.
// The viewer script wires the dormant button to the figure's source, deriving
// table text from the rendered view.

import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import type { CopySubject } from "../../_model/figure-controls/figure-controls.js";
import { copyLabel } from "../../_model/figure-controls/figure-controls.js";
import { FIGURE_CONTROL_BUTTON_CLASSES } from "./control-button-classes.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

export const CopyButton = ({ subject }: { readonly subject: CopySubject }) => {
  const label = copyLabel(subject);
  return (
    <button
      type="button"
      className={FIGURE_CONTROL_BUTTON_CLASSES}
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
