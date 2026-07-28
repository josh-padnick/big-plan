// Renders a compiled Callout as a semantic, type-tinted panel.

import type {
  CalloutType,
  CompiledCallout,
} from "../../model/compile-callout.js";
import type { LucideIcon } from "../../render/icons/lucide-icon.js";
import { INFO_ICON } from "../../render/icons/lucide/info.js";
import { LIGHTBULB_ICON } from "../../render/icons/lucide/lightbulb.js";
import { OCTAGON_ALERT_ICON } from "../../render/icons/lucide/octagon-alert.js";
import { TRIANGLE_ALERT_ICON } from "../../render/icons/lucide/triangle-alert.js";
import { hastContentToReact } from "../hast-content.js";
import { lucideIconToReact } from "../lucide-icon.js";

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
      <header className="callout-header mb-2 flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:shrink-0">
        {lucideIconToReact({ icon: config.icon, hidden: false })}
        <span className="callout-title text-sm leading-5">
          {model.title ?? config.defaultTitle}
        </span>
      </header>
      <div className="callout-body text-ink">
        {hastContentToReact(model.body)}
      </div>
    </aside>
  );
};
