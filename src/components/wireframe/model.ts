// Owns Wireframe's framework-free vocabulary: the constrained design tokens a
// plan author may write, the device presets that shape an artboard, and the
// validated node union every accepted wireframe compiles into. Nothing here
// knows about React, HTML, or CSS; the view consumes this model and the
// catalog produces it.

export type WireframeSpace = "none" | "xs" | "sm" | "md" | "lg" | "xl";

export const WIREFRAME_SPACES: ReadonlyArray<WireframeSpace> = [
  "none",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
];

export type WireframeAlign = "start" | "center" | "end" | "stretch";

export const WIREFRAME_ALIGNMENTS: ReadonlyArray<WireframeAlign> = [
  "start",
  "center",
  "end",
  "stretch",
];

export type WireframeJustify = "start" | "center" | "end" | "between";

export const WIREFRAME_JUSTIFICATIONS: ReadonlyArray<WireframeJustify> = [
  "start",
  "center",
  "end",
  "between",
];

export type WireframeEmphasis =
  "primary" | "secondary" | "tertiary" | "destructive";

export const WIREFRAME_EMPHASES: ReadonlyArray<WireframeEmphasis> = [
  "primary",
  "secondary",
  "tertiary",
  "destructive",
];

export type WireframeMediaShape = "square" | "wide" | "tall";

export const WIREFRAME_MEDIA_SHAPES: ReadonlyArray<WireframeMediaShape> = [
  "square",
  "wide",
  "tall",
];

// The native input types a wireframe may draw. Each renders as the real
// control, so a reviewer meets the same affordance the product will have.
export type WireframeFieldKind =
  "text" | "search" | "email" | "password" | "number" | "date";

export const WIREFRAME_FIELD_KINDS: ReadonlyArray<WireframeFieldKind> = [
  "text",
  "search",
  "email",
  "password",
  "number",
  "date",
];

export type WireframeStepState = "done" | "current" | "todo";

export const WIREFRAME_STEP_STATES: ReadonlyArray<WireframeStepState> = [
  "done",
  "current",
  "todo",
];

export type WireframeDirection = "right" | "down";

export const WIREFRAME_DIRECTIONS: ReadonlyArray<WireframeDirection> = [
  "right",
  "down",
];

// How wide a block of content is allowed to get. Prose stops being readable
// somewhere past 80 characters, so a desktop screen constrains its reading
// content rather than letting it run the full width of the window.
export type WireframeMeasure = "narrow" | "prose" | "wide";

export const WIREFRAME_MEASURES: ReadonlyArray<WireframeMeasure> = [
  "narrow",
  "prose",
  "wide",
];

/**
 * How much chrome a region draws around itself.
 *
 * Outlining every region makes controls, panels, and page structure compete
 * equally, so nothing reads as more important than anything else. The default
 * is no chrome at all: a heading and the space around it group content, and a
 * box is spent only where something genuinely behaves like one.
 */
export type WireframeSurface = "plain" | "filled" | "outlined";

export const WIREFRAME_SURFACES: ReadonlyArray<WireframeSurface> = [
  "plain",
  "filled",
  "outlined",
];

// Status carries meaning, so it is never carried by color alone: a tone tints
// a chip that is already saying the same thing in words.
export type WireframeTone =
  "neutral" | "info" | "success" | "warning" | "danger";

export const WIREFRAME_TONES: ReadonlyArray<WireframeTone> = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
];

/**
 * Where one item of work stands.
 *
 * A review surface that lists work has to say, at a glance, which lines are
 * finished and which still want a person. Words alone make the reader read
 * every row to find that out, and a tone alone would carry the meaning in
 * colour. So a status draws a distinct mark, which is legible in greyscale and
 * scannable down a column, beside copy that still says the same thing. The set
 * is closed and small on purpose: four states a reviewer can tell apart
 * instantly beats a palette of decorative glyphs.
 */
export type WireframeStatus = "done" | "attention" | "waiting" | "blocked";

export const WIREFRAME_STATUSES: ReadonlyArray<WireframeStatus> = [
  "done",
  "attention",
  "waiting",
  "blocked",
];

/** One cell of a table: its text, and a chip tone when it reports state. */
export type WireframeTableCell = {
  readonly text: string;
  readonly tone?: WireframeTone;
};

export type WireframeTextRole = "body" | "helper" | "muted" | "section";

export const WIREFRAME_TEXT_ROLES: ReadonlyArray<WireframeTextRole> = [
  "body",
  "helper",
  "muted",
  "section",
];

// A heading's rank inside one screen. It never joins the review document's
// outline: the view renders these below the surrounding section's level so a
// wireframe cannot disturb the reader's navigation.
export type WireframeHeadingLevel = "1" | "2" | "3";

export const WIREFRAME_HEADING_LEVELS: ReadonlyArray<WireframeHeadingLevel> = [
  "1",
  "2",
  "3",
];

/**
 * The device a screen is designed for.
 *
 * One value owns both logical width and frame. Keeping those decisions
 * together makes incoherent combinations such as desktop content in a phone
 * shell impossible to author.
 */
export type WireframeDevice =
  "desktop" | "tablet" | "tablet-portrait" | "phone";

export const WIREFRAME_DEVICES: ReadonlyArray<WireframeDevice> = [
  "desktop",
  "tablet",
  "tablet-portrait",
  "phone",
];

/** An optional proven layout that expands into the open wireframe vocabulary. */
export type WireframePattern = "list-detail" | "triage" | "create" | "settings";

export const WIREFRAME_PATTERNS: ReadonlyArray<WireframePattern> = [
  "list-detail",
  "triage",
  "create",
  "settings",
];

/**
 * One device preset's logical frame and reader-facing name.
 *
 * The artboard lays out at this true size and scales as one unit to fit the
 * review surface. Desktop and phone use a minimum height and grow with
 * content. Tablet holds an iPad-shaped viewport, and its content must fit that
 * fixed frame without stretching the bezel or introducing internal scrolling.
 */
export type WireframeDevicePreset = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly heightPolicy: "fixed" | "minimum";
};

export const WIREFRAME_DEVICE_PRESETS: Readonly<
  Record<WireframeDevice, WireframeDevicePreset>
> = {
  desktop: {
    label: "Desktop",
    width: 1200,
    height: 820,
    heightPolicy: "minimum",
  },
  tablet: {
    label: "Tablet, landscape",
    width: 1020,
    height: 720,
    heightPolicy: "fixed",
  },
  "tablet-portrait": {
    label: "Tablet",
    width: 820,
    height: 1180,
    heightPolicy: "fixed",
  },
  phone: {
    label: "Phone",
    width: 390,
    height: 720,
    heightPolicy: "minimum",
  },
};

/**
 * One validated wireframe element. Containers carry their children; leaves
 * carry only the tokens and copy the author supplied. Every variant is closed,
 * so the view is exhaustive over the vocabulary by compilation.
 */
export type WireframeNode =
  | {
      readonly element: "Stack";
      readonly gap: WireframeSpace;
      readonly align: WireframeAlign;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Row";
      readonly gap: WireframeSpace;
      readonly align: WireframeAlign;
      readonly justify: WireframeJustify;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Panel";
      readonly title?: string;
      readonly eyebrow?: string;
      readonly surface: WireframeSurface;
      // Where the group this panel holds stands as a whole. A grouped review
      // surface is scanned by its headers first, so the header is where a
      // "all done" or "needs you" answer belongs.
      readonly status?: WireframeStatus;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Heading";
      readonly text: string;
      readonly level: WireframeHeadingLevel;
    }
  | {
      readonly element: "Text";
      readonly text: string;
      readonly role: WireframeTextRole;
    }
  | {
      readonly element: "Button";
      readonly label: string;
      readonly emphasis: WireframeEmphasis;
      // The screen this button moves the prototype to. Every target is
      // resolved against the wireframe's own screens before rendering, so a
      // rendered document can never offer a dead action.
      readonly navigateTo?: string;
    }
  | {
      // Mutually exclusive modes presented as one control. Children stay
      // buttons so the selected mode remains explicit in the authored model.
      readonly element: "SegmentedControl";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "AppShell";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Sidebar";
      readonly brand?: string;
      readonly mode?: string;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "AppContent";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "TopBar";
      readonly title?: string;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      // Phone tab strip across the bottom of a screen. Desktop shells use
      // Sidebar instead; putting a bottom bar on desktop reads as mobile UI
      // drawn on a wide artboard.
      readonly element: "BottomBar";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "PageHeader";
      readonly title: string;
      readonly description?: string;
      readonly badge?: string;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Nav";
      readonly label?: string;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "NavItem";
      readonly label: string;
      readonly active: boolean;
      readonly navigateTo?: string;
    }
  | {
      readonly element: "Metric";
      readonly label: string;
      readonly value: string;
      readonly note?: string;
    }
  | {
      readonly element: "Progress";
      readonly label?: string;
      // Percent complete. The bar always has a readable value beside it, but
      // an author may replace the abstract percentage with a tangible phrase.
      readonly value: number;
      readonly valueLabel?: string;
      readonly detail?: string;
    }
  | {
      readonly element: "Badge";
      readonly label: string;
      readonly tone: WireframeTone;
    }
  | { readonly element: "Divider"; readonly label?: string }
  | {
      readonly element: "ImagePlaceholder";
      readonly label: string;
      readonly shape: WireframeMediaShape;
    }
  | {
      readonly element: "List";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      // A small consequential decision owns the surface instead of borrowing
      // record-list or master-detail semantics.
      readonly element: "ChoiceGroup";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "ChoiceCard";
      readonly icon: string;
      readonly title: string;
      readonly description: string;
      readonly selected: boolean;
      readonly navigateTo?: string;
    }
  | {
      readonly element: "ListItem";
      readonly label: string;
      readonly meta?: string;
      readonly value?: string;
      // Where this one row stands. Rows carrying a status read as a checklist
      // rather than as a queue.
      readonly status?: WireframeStatus;
      // Selected row in a master queue. Wireframe language only - not interactive.
      readonly selected: boolean;
      // Whole-row navigation (mobile lists open a record without a separate CTA).
      readonly navigateTo?: string;
    }
  | {
      // One message in a conversation timeline (not a table row).
      readonly element: "Message";
      readonly author: string;
      readonly time: string;
      readonly text: string;
      readonly kind: "customer" | "agent" | "internal";
    }
  | {
      readonly element: "TextField";
      readonly label: string;
      readonly kind: WireframeFieldKind;
      readonly placeholder?: string;
      readonly value?: string;
      readonly hint?: string;
      readonly disabled: boolean;
    }
  | {
      readonly element: "TextArea";
      readonly label: string;
      readonly placeholder?: string;
      readonly value?: string;
      readonly hint?: string;
      readonly disabled: boolean;
    }
  | {
      readonly element: "Select";
      readonly label: string;
      // What the control currently reads as. A wireframe shows the chosen
      // option, not the whole menu.
      readonly value: string;
      readonly hint?: string;
      readonly disabled: boolean;
    }
  | {
      readonly element: "Checkbox";
      readonly label: string;
      readonly checked: boolean;
      readonly hint?: string;
    }
  | {
      readonly element: "Switch";
      readonly label: string;
      readonly on: boolean;
      readonly hint?: string;
    }
  | {
      readonly element: "Stepper";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Step";
      readonly label: string;
      readonly state: WireframeStepState;
    }
  | {
      readonly element: "Connector";
      readonly direction: WireframeDirection;
      readonly label?: string;
    }
  | {
      readonly element: "Rail";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Center";
      readonly measure: WireframeMeasure;
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Breadcrumbs";
      readonly children: ReadonlyArray<WireframeNode>;
    }
  | {
      readonly element: "Crumb";
      readonly label: string;
      readonly navigateTo?: string;
    }
  | {
      readonly element: "Table";
      readonly headers: ReadonlyArray<string>;
      readonly rows: ReadonlyArray<ReadonlyArray<WireframeTableCell>>;
      // Which columns hold figures. Numbers line up on the right so a reader
      // can compare them down the column; text lines up on the left.
      readonly numeric: ReadonlyArray<boolean>;
      // Which row the screen is showing the detail for, counting rows from
      // one. A list beside a detail pane has to say which row it is showing.
      readonly selected?: number;
    };

export type WireframeElementName = WireframeNode["element"];

/** One named artboard within a wireframe. */
export type WireframeScreen = {
  readonly id: string;
  readonly name: string;
  readonly device: WireframeDevice;
  readonly pattern?: WireframePattern;
  // The address shown in the browser frame. It says which route of the
  // product this screen is, which a reviewer otherwise has to infer.
  readonly url?: string;
  readonly children: ReadonlyArray<WireframeNode>;
};

/** One validated wireframe: a static screen or a multi-screen prototype. */
export type CompiledWireframe = {
  readonly id: string;
  readonly title?: string;
  // The screen a reader sees first. Always one of `screens`, or an empty
  // string when the wireframe failed validation and has no screens to show.
  readonly initialScreenId: string;
  readonly screens: ReadonlyArray<WireframeScreen>;
};
