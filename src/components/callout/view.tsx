// Renders a compiled Callout as a semantic, type-tinted panel.

import type { CalloutType, CompiledCallout } from "./compile.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { OCTAGON_ALERT_ICON } from "../../icons/lucide/octagon-alert.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";

type CalloutConfig = {
  readonly defaultTitle: string;
  readonly icon: LucideIcon;
};

const CALLOUT_CONFIGS = {
  note: { defaultTitle: "Note", icon: INFO_ICON },
  tip: { defaultTitle: "Tip", icon: LIGHTBULB_ICON },
  warning: { defaultTitle: "Warning", icon: TRIANGLE_ALERT_ICON },
  danger: { defaultTitle: "Danger", icon: OCTAGON_ALERT_ICON },
} satisfies Readonly<Record<CalloutType, CalloutConfig>>;

export const Callout = ({ model }: { readonly model: CompiledCallout }) => {
  const config = CALLOUT_CONFIGS[model.type];
  return (
    // Border colors come from the stylesheet's [data-callout] rules; a
    // border-edge utility here would win the cascade and flatten the accent.
    <aside
      data-callout={model.type}
      className="callout mb-5 rounded-md border border-l-4 px-4 py-3"
    >
      <header className="callout-header mb-2 flex items-center gap-2 font-semibold text-[var(--callout-accent)] [&_svg]:size-4 [&_svg]:shrink-0">
        {lucideIconToReact({ icon: config.icon, hidden: false })}
        <span className="callout-title text-sm leading-5">
          {model.title ?? config.defaultTitle}
        </span>
      </header>
      <div className="callout-body text-ink [&>:last-child]:mb-0">
        {hastContentToReact(model.body)}
      </div>
    </aside>
  );
};
