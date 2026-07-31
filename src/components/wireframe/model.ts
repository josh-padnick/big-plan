// Owns Wireframe's framework-free vocabulary: the constrained design tokens a
// plan author may write, the viewport presets that shape an artboard, and the
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

/**
 * The frame drawn around a screen.
 *
 * A wireframe of a web product that floats on the page reads as a tablet app
 * no matter what is inside it. The frame is what tells a reviewer which kind
 * of product they are looking at, before they read a single label.
 */
export type WireframeChrome = "none" | "browser" | "phone";

export const WIREFRAME_CHROMES: ReadonlyArray<WireframeChrome> = [
  "none",
  "browser",
  "phone",
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

/** One cell of a table: its text, and a chip tone when it reports state. */
export type WireframeTableCell = {
  readonly text: string;
  readonly tone?: WireframeTone;
};

export type WireframeTextRole = "body" | "helper" | "muted";

export const WIREFRAME_TEXT_ROLES: ReadonlyArray<WireframeTextRole> = [
  "body",
  "helper",
  "muted",
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

export type WireframeViewport =
  | "mobile-portrait"
  | "mobile-landscape"
  | "tablet-portrait"
  | "tablet-landscape"
  | "desktop";

export const WIREFRAME_VIEWPORTS: ReadonlyArray<WireframeViewport> = [
  "mobile-portrait",
  "mobile-landscape",
  "tablet-portrait",
  "tablet-landscape",
  "desktop",
];

/**
 * One viewport preset's logical dimensions and reader-facing name.
 *
 * The dimensions describe the device an author is designing for; they are not
 * the size the artboard renders at. A wireframe block fills the width it is
 * given up to the preset's logical width and reflows, so labels stay at
 * reading size from a 320px phone to a wide desktop review surface.
 */
export type WireframeViewportPreset = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
};

export const WIREFRAME_VIEWPORT_PRESETS: Readonly<
  Record<WireframeViewport, WireframeViewportPreset>
> = {
  "mobile-portrait": { label: "Phone", width: 390, height: 844 },
  "mobile-landscape": { label: "Phone, landscape", width: 844, height: 390 },
  "tablet-portrait": { label: "Tablet", width: 834, height: 1112 },
  "tablet-landscape": { label: "Tablet, landscape", width: 1112, height: 834 },
  desktop: { label: "Desktop", width: 1440, height: 900 },
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
      // Percent complete. A wireframe draws the bar and always writes the
      // number beside it, so the state survives without the drawing.
      readonly value: number;
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
      readonly element: "ListItem";
      readonly label: string;
      readonly meta?: string;
      readonly value?: string;
    }
  | {
      readonly element: "TextField";
      readonly label: string;
      readonly kind: WireframeFieldKind;
      readonly placeholder?: string;
      readonly value?: string;
      readonly hint?: string;
    }
  | {
      readonly element: "TextArea";
      readonly label: string;
      readonly placeholder?: string;
      readonly value?: string;
      readonly hint?: string;
    }
  | {
      readonly element: "Select";
      readonly label: string;
      // What the control currently reads as. A wireframe shows the chosen
      // option, not the whole menu.
      readonly value: string;
      readonly hint?: string;
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
  readonly viewport: WireframeViewport;
  readonly chrome: WireframeChrome;
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
