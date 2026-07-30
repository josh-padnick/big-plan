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
    };

export type WireframeElementName = WireframeNode["element"];

/** One named artboard within a wireframe. */
export type WireframeScreen = {
  readonly id: string;
  readonly name: string;
  readonly viewport: WireframeViewport;
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
