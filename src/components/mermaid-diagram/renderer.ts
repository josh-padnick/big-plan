// Owns the compile-time browser bridge for Mermaid. The caller sends every
// Mermaid source in one batch so one Big Plan invocation launches one browser,
// while the delivered document receives only sanitized SVG strings.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import type { Element, ElementContent, RootContent } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import { find, svg } from "property-information";
import { mermaidStaticItemAnchor } from "./anchors.js";
import {
  MERMAID_FONT_CSS,
  MERMAID_FONT_FAMILY,
  MERMAID_FONT_PROBES,
} from "./font.generated.js";
import { parseMermaidSource } from "./parse.js";

export const MERMAID_VERSION = "11.16.0";
export const MERMAID_BROWSER_VERSION = "1.61.1";
export { MERMAID_FONT_CSS, MERMAID_FONT_FAMILY } from "./font.generated.js";
export const MERMAID_THEME_TOKENS = {
  light: {
    background: "#f7f5f0",
    mainBkg: "#efece3",
    nodeBorder: "#c9c1ae",
    nodeTextColor: "#211e1a",
    textColor: "#211e1a",
    lineColor: "#6f695c",
    primaryColor: "#efece3",
    primaryTextColor: "#211e1a",
    primaryBorderColor: "#c9c1ae",
    secondaryColor: "#edf2f3",
    secondaryTextColor: "#211e1a",
    secondaryBorderColor: "#426b82",
    tertiaryColor: "#eef2e9",
    tertiaryTextColor: "#211e1a",
    tertiaryBorderColor: "#527047",
    edgeLabelBackground: "#f7f5f0",
    clusterBkg: "#efece3",
    clusterBorder: "#c9c1ae",
  },
  dark: {
    background: "#1b1916",
    mainBkg: "#242119",
    nodeBorder: "#4f4a3f",
    nodeTextColor: "#ebe6da",
    textColor: "#ebe6da",
    lineColor: "#a49c8b",
    primaryColor: "#242119",
    primaryTextColor: "#ebe6da",
    primaryBorderColor: "#4f4a3f",
    secondaryColor: "#202a2d",
    secondaryTextColor: "#ebe6da",
    secondaryBorderColor: "#87b5ca",
    tertiaryColor: "#242b20",
    tertiaryTextColor: "#ebe6da",
    tertiaryBorderColor: "#9abd89",
    edgeLabelBackground: "#1b1916",
    clusterBkg: "#242119",
    clusterBorder: "#4f4a3f",
  },
} as const;

// Mermaid bakes its colours into the SVG at compile time, which would freeze a
// diagram in the palette that rendered it. Every token above whose value IS a
// role is therefore rewritten back to that role in the delivered SVG, so one
// compiled diagram follows whichever colour theme the reviewer later picks.
//
// The four secondary and tertiary tints have no role of their own and stay
// literal; they appear only on the alternate node classes some diagram types
// use, and giving them a role would move pixels in the default palette.
export const MERMAID_ROLE_TOKENS = {
  background: "--bg",
  edgeLabelBackground: "--bg",
  mainBkg: "--surface-c",
  primaryColor: "--surface-c",
  clusterBkg: "--surface-c",
  nodeBorder: "--edge-strong-c",
  primaryBorderColor: "--edge-strong-c",
  clusterBorder: "--edge-strong-c",
  nodeTextColor: "--ink-c",
  textColor: "--ink-c",
  primaryTextColor: "--ink-c",
  secondaryTextColor: "--ink-c",
  tertiaryTextColor: "--ink-c",
  lineColor: "--subtle-c",
} as const satisfies Partial<
  Record<keyof (typeof MERMAID_THEME_TOKENS)["light"], string>
>;

type MermaidThemeVariant = keyof typeof MERMAID_THEME_TOKENS;

type MermaidThemeTable = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;
type MermaidRoleTable = Readonly<Record<string, string>>;

/**
 * Maps one variant's baked colours to the roles they were taken from. Both
 * tables are injectable so a test can drive the collision and missing-literal
 * guards against a throwaway pair, which the delivered mapping never contains.
 */
export const roleSubstitutions = ({
  variant,
  themeTokens = MERMAID_THEME_TOKENS,
  roleTokens = MERMAID_ROLE_TOKENS,
}: {
  readonly variant: MermaidThemeVariant;
  readonly themeTokens?: MermaidThemeTable;
  readonly roleTokens?: MermaidRoleTable;
}): ReadonlyMap<string, string> => {
  const substitutions = new Map<string, string>();
  const variantTokens = themeTokens[variant];
  if (variantTokens === undefined) {
    throw new Error(`Mermaid theme has no "${variant}" variant`);
  }
  for (const [token, role] of Object.entries(roleTokens)) {
    const literal = variantTokens[token];
    if (literal === undefined) {
      throw new Error(
        `Mermaid role token "${token}" has no ${variant} literal to replace`,
      );
    }
    const existing = substitutions.get(literal.toLowerCase());
    if (existing !== undefined && existing !== `var(${role})`) {
      throw new Error(
        `Mermaid theme token "${token}" shares ${literal} with a different role`,
      );
    }
    substitutions.set(literal.toLowerCase(), `var(${role})`);
  }
  return substitutions;
};

const COLOUR_BEARING_ATTRIBUTES = ["fill", "stroke", "style"];

export const substituteColours = ({
  value,
  substitutions,
}: {
  readonly value: string;
  readonly substitutions: ReadonlyMap<string, string>;
}): string =>
  value.replace(
    /#[0-9a-fA-F]{6}\b/gu,
    (literal) => substitutions.get(literal.toLowerCase()) ?? literal,
  );

const require = createRequire(import.meta.url);
const MERMAID_SCRIPT_PATH = require.resolve("mermaid/dist/mermaid.min.js");
const PLAYWRIGHT_PATH = require.resolve("@playwright/test");

export type MermaidRawRender = {
  readonly light: string;
  readonly dark: string;
};

export type MermaidSvgNodeTarget = {
  readonly id: string;
  readonly label: string;
  readonly anchor: string;
};

export type MermaidSvgEdgeTarget = {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly anchor: string;
};

export type MermaidRenderFailure = {
  readonly error: string;
};

export type MermaidRenderResult = MermaidRawRender | MermaidRenderFailure;

export const isMermaidRenderFailure = (
  result: unknown,
): result is MermaidRenderFailure =>
  typeof result === "object" &&
  result !== null &&
  "error" in result &&
  typeof result.error === "string" &&
  !("light" in result) &&
  !("dark" in result);

type MermaidRenderInput = ReadonlyArray<{ readonly source: string }>;

type MermaidRenderOutput = ReadonlyArray<MermaidRenderResult>;

const isMermaidRawRender = (result: unknown): result is MermaidRawRender =>
  typeof result === "object" &&
  result !== null &&
  "light" in result &&
  typeof result.light === "string" &&
  "dark" in result &&
  typeof result.dark === "string" &&
  !("error" in result);

/** Decodes the untrusted renderer-process response into its typed boundary. */
export const parseMermaidRenderOutput = ({
  output,
  expectedCount,
}: {
  readonly output: string;
  readonly expectedCount: number;
}): MermaidRenderOutput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error: unknown) {
    throw new Error("Mermaid browser rendering returned invalid JSON", {
      cause: error,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Mermaid browser rendering returned invalid output");
  }
  if (parsed.length !== expectedCount) {
    throw new Error(
      "Mermaid browser rendering returned the wrong number of diagrams",
    );
  }
  const results: Array<MermaidRenderResult> = [];
  for (const result of parsed) {
    if (isMermaidRawRender(result) || isMermaidRenderFailure(result)) {
      results.push(result);
      continue;
    }
    throw new Error("Mermaid browser rendering returned an invalid diagram");
  }
  return results;
};

const RENDER_SCRIPT = String.raw`
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const { chromium } = (await import(input.playwrightPath)).default;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.addStyleTag({ content: input.fontCss });
  await page.evaluate(async ({ fontProbes }) => {
    await Promise.all(
      fontProbes.map(({ family, weight, text }) =>
        document.fonts.load(weight + ' 16px "' + family + '"', text),
      ),
    );
    await document.fonts.ready;
    if (!fontProbes.every(({ family, weight, text }) =>
      document.fonts.check(weight + ' 16px "' + family + '"', text),
    )) {
      throw new Error("The bundled Mermaid font did not load");
    }
  }, { fontProbes: input.fontProbes });
  await page.addScriptTag({ path: input.mermaidScriptPath });
  const output = await page.evaluate(async ({ sources, fontFamily, themeTokens }) => {
    const renderVariant = async (source, theme, index) => {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        handDrawnSeed: 1,
        theme,
        fontFamily,
        themeVariables: theme === "dark" ? themeTokens.dark : themeTokens.light,
        flowchart: { htmlLabels: false, useMaxWidth: false },
      });
      const rendered = await window.mermaid.render("big_plan_mermaid_" + theme + "_" + index, source);
      return rendered.svg;
    };
    const result = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      try {
        result.push({
          light: await renderVariant(source, "base", index),
          dark: await renderVariant(source, "dark", index),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.push({ error: message.trim() || "Mermaid could not render this diagram" });
      }
    }
    return result;
  }, { sources: input.sources, fontFamily: input.fontFamily, themeTokens: input.themeTokens });
  process.stdout.write(JSON.stringify(output));
} finally {
  await browser.close();
}
`;

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

const SAFE_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "marker",
  "switch",
  "defs",
  "style",
  "title",
  "desc",
]);

const SAFE_ATTRIBUTES = new Set([
  "id",
  "class",
  "xmlns",
  "xmlns:xlink",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "dx",
  "dy",
  "rx",
  "ry",
  "r",
  "points",
  "d",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "marker-start",
  "marker-mid",
  "marker-end",
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "orient",
  "transform",
  "style",
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-hidden",
  "focusable",
  "tabindex",
]);

const SAFE_STYLE =
  /^(?:\s*(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|font-family|font-size|font-weight|opacity|color|stop-color|stop-opacity)\s*:\s*(?![^;]*(?:url|expression|javascript|behavior))[^;]*;?\s*)+$/iu;
const SAFE_MARKER_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const SAFE_MARKER_ORIENT =
  /^(?:auto|auto-start-reverse|-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:deg|grad|rad|turn)?)$/iu;
const MARKER_GEOMETRY_ATTRIBUTES = new Set([
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "orient",
]);

const isSafeMarkerGeometry = ({
  attribute,
  value,
}: {
  readonly attribute: string;
  readonly value: unknown;
}): boolean => {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const normalized = String(value);
  if (attribute === "markerUnits") {
    return normalized === "strokeWidth" || normalized === "userSpaceOnUse";
  }
  if (attribute === "orient") return SAFE_MARKER_ORIENT.test(normalized);
  if (!SAFE_MARKER_NUMBER.test(normalized)) return false;
  return (
    (attribute !== "markerWidth" && attribute !== "markerHeight") ||
    Number(normalized) > 0
  );
};

const sanitizeNode = (node: Element): void => {
  node.children = node.children.filter((child) => {
    if (!isElement(child)) return true;
    if (!SAFE_TAGS.has(child.tagName)) return false;
    sanitizeNode(child);
    return true;
  });
  for (const name of Object.keys(node.properties)) {
    const attribute = find(svg, name).attribute;
    const value = node.properties[name];
    if (
      !SAFE_ATTRIBUTES.has(attribute) ||
      attribute.toLowerCase().startsWith("on")
    ) {
      delete node.properties[name];
      continue;
    }
    if (
      attribute === "style" &&
      (typeof value !== "string" || !SAFE_STYLE.test(value))
    ) {
      delete node.properties[name];
      continue;
    }
    if (
      MARKER_GEOMETRY_ATTRIBUTES.has(attribute) &&
      (node.tagName !== "marker" || !isSafeMarkerGeometry({ attribute, value }))
    ) {
      delete node.properties[name];
      continue;
    }
    if (
      (attribute === "href" || attribute === "xlink:href") &&
      typeof value === "string" &&
      !value.startsWith("#")
    ) {
      delete node.properties[name];
    }
  }
};

/** Rewrites every baked role colour, in attributes and in the SVG's own CSS. */
const applyRoleColours = ({
  node,
  substitutions,
}: {
  readonly node: Element;
  readonly substitutions: ReadonlyMap<string, string>;
}): void => {
  for (const attribute of COLOUR_BEARING_ATTRIBUTES) {
    const value = node.properties[attribute];
    if (typeof value === "string") {
      node.properties[attribute] = substituteColours({ value, substitutions });
    }
  }
  for (const child of node.children) {
    if (isElement(child)) {
      applyRoleColours({ node: child, substitutions });
      continue;
    }
    // Only the SVG's own stylesheet, never a plan-authored label: a diagram
    // caption that happened to spell a hex must not become a colour reference.
    if (child.type === "text" && node.tagName === "style") {
      child.value = substituteColours({ value: child.value, substitutions });
    }
  }
};

const sanitizeSvg = ({
  svg,
  variant,
}: {
  readonly svg: string;
  readonly variant: MermaidThemeVariant;
}): string => {
  const root = fromHtml(svg, { fragment: true }).children.filter(isElement);
  if (root.length !== 1 || root[0]?.tagName !== "svg") {
    throw new Error("Mermaid returned a document without one SVG root");
  }
  const element = root[0];
  sanitizeNode(element);
  applyRoleColours({
    node: element,
    substitutions: roleSubstitutions({ variant }),
  });
  if (element.properties["viewBox"] === undefined) {
    throw new Error("Mermaid returned an SVG without a viewBox");
  }
  return toHtml(element, { allowDangerousHtml: false });
};

const replaceReferences = ({
  value,
  references,
  pattern,
}: {
  readonly value: unknown;
  readonly references: ReadonlyMap<string, string>;
  readonly pattern: RegExp | null;
}): unknown => {
  if (typeof value !== "string" || pattern === null) return value;
  return value.replace(
    pattern,
    (reference, id: string) => `#${references.get(id) ?? reference.slice(1)}`,
  );
};

/** Rewrites one SVG's ids and every retained fragment or IDREF together. */
const namespaceSvgIds = ({
  elements,
  elementIds,
  references,
}: {
  readonly elements: ReadonlyArray<Element>;
  readonly elementIds: ReadonlyMap<Element, string>;
  readonly references: ReadonlyMap<string, string>;
}): void => {
  const alternatives = [...references.keys()]
    .sort((left, right) => right.length - left.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const pattern =
    alternatives.length === 0
      ? null
      : new RegExp(`#(${alternatives.join("|")})(?![A-Za-z0-9_.:-])`, "gu");
  for (const element of elements) {
    const nextId = elementIds.get(element);
    if (nextId !== undefined) {
      element.properties.id = nextId;
    }
    for (const name of Object.keys(element.properties)) {
      const attribute = find(svg, name).attribute;
      const value = element.properties[name];
      if (attribute === "id") continue;
      if (
        (attribute === "aria-labelledby" || attribute === "aria-describedby") &&
        (typeof value === "string" || Array.isArray(value))
      ) {
        const referencedIds = Array.isArray(value)
          ? value.map(String)
          : value.split(/\s+/u);
        element.properties[name] = referencedIds
          .map((id) => references.get(id) ?? id)
          .join(" ") as never;
        continue;
      }
      element.properties[name] = replaceReferences({
        value,
        references,
        pattern,
      }) as never;
    }
    if (element.tagName === "style") {
      for (const child of element.children) {
        if (child.type === "text") {
          const value = replaceReferences({
            value: child.value,
            references,
            pattern,
          });
          if (typeof value === "string") child.value = value;
        }
      }
    }
  }
};

const isolateEdgeMarkerDefinitions = ({
  element,
  markerNamespace,
  elements,
}: {
  readonly element: Element;
  readonly markerNamespace: string;
  readonly elements: Array<Element>;
}): void => {
  const paint =
    element.tagName === "g"
      ? element.children.find(
          (child) =>
            isElement(child) &&
            ["path", "polyline", "line"].includes(child.tagName),
        )
      : element;
  if (paint === undefined || !isElement(paint)) return;
  for (const property of ["markerStart", "markerMid", "markerEnd"] as const) {
    const reference = paint.properties[property];
    const markerId =
      typeof reference === "string"
        ? /^url\(#([^)]+)\)$/u.exec(reference)?.[1]
        : undefined;
    if (markerId === undefined) continue;
    const marker = elements.find(
      (candidate) =>
        candidate.tagName === "marker" && candidate.properties.id === markerId,
    );
    const parent =
      marker === undefined
        ? undefined
        : elements.find((candidate) => candidate.children.includes(marker));
    if (marker === undefined || parent === undefined) {
      throw new Error(`Mermaid SVG marker target mismatch for "${markerId}"`);
    }
    const clone = structuredClone(marker);
    const cloneElements: Array<Element> = [];
    const collect = (candidate: Element): void => {
      cloneElements.push(candidate);
      for (const child of candidate.children) {
        if (isElement(child)) collect(child);
      }
    };
    collect(clone);
    const cloneElementIds = new Map<Element, string>();
    const cloneReferences = new Map<string, string>();
    for (const [index, candidate] of cloneElements.entries()) {
      const id = candidate.properties.id;
      if (typeof id === "string") {
        const nextId = `${markerNamespace}-${property}-${index + 1}`;
        cloneElementIds.set(candidate, nextId);
        if (!cloneReferences.has(id)) cloneReferences.set(id, nextId);
      }
    }
    namespaceSvgIds({
      elements: cloneElements,
      elementIds: cloneElementIds,
      references: cloneReferences,
    });
    const cloneId = clone.properties.id;
    if (typeof cloneId !== "string") {
      throw new Error(`Mermaid SVG marker target mismatch for "${markerId}"`);
    }
    parent.children.push(clone);
    elements.push(...cloneElements);
    paint.properties[property] = `url(#${cloneId})`;
  }
};

const setTargetAttributes = ({
  element,
  kind,
  anchor,
  name,
  accessibleName,
  nodeId,
  label,
  from,
  to,
}: {
  readonly element: Element;
  readonly kind: "node" | "edge";
  readonly anchor: string;
  readonly name: string;
  readonly accessibleName: string;
  readonly nodeId?: string;
  readonly label?: string;
  readonly from?: string;
  readonly to?: string;
}): void => {
  element.properties["data-flow-element"] = kind;
  element.properties["data-flow-anchor"] = anchor;
  element.properties["data-flow-name"] = name;
  element.properties.role = "group";
  element.properties["aria-label"] = accessibleName;
  element.properties.tabindex = "-1";
  if (nodeId !== undefined) element.properties["data-flow-node"] = nodeId;
  if (label !== undefined) element.properties["data-flow-label"] = label;
  if (from !== undefined) element.properties["data-flow-edge-from"] = from;
  if (to !== undefined) element.properties["data-flow-edge-to"] = to;
};

const classNamesOf = (element: Element): ReadonlyArray<string> => {
  const value = element.properties.className;
  return Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? [value]
      : [];
};

const hasClass = (element: Element, name: string): boolean =>
  classNamesOf(element).includes(name);

const textOf = (element: Element): string =>
  element.children
    .map((child) =>
      child.type === "text"
        ? child.value
        : isElement(child)
          ? textOf(child)
          : "",
    )
    .join(" ")
    .trim()
    .replace(/\s+/gu, " ");

const cloneEdgePaint = (element: Element): Element => ({
  type: "element",
  tagName: element.tagName,
  properties: {
    ...element.properties,
    id: undefined,
    className: ["mermaid-edge-hit"],
    "data-flow-edge-hit": "",
    "data-flow-element": undefined,
    "data-flow-anchor": undefined,
    "data-flow-name": undefined,
    "data-flow-label": undefined,
    role: undefined,
    "aria-label": undefined,
    tabindex: undefined,
    "aria-hidden": "true",
    markerStart: undefined,
    markerMid: undefined,
    markerEnd: undefined,
    stroke: "transparent",
    strokeWidth: "32",
    fill: "none",
  },
  children: [],
});

const addEdgeHitTarget = ({
  element,
  anchor,
  idSuffix,
  parent,
}: {
  readonly element: Element;
  readonly anchor: string;
  readonly idSuffix: string;
  readonly parent?: Element;
}): void => {
  const paint =
    element.tagName === "g"
      ? element.children.find(
          (child) =>
            isElement(child) &&
            ["path", "polyline", "line"].includes(child.tagName),
        )
      : element;
  if (paint === undefined || !isElement(paint)) return;
  const hit = cloneEdgePaint(paint);
  hit.properties.id = anchor + "--hit" + idSuffix;
  hit.properties["data-flow-edge-anchor"] = anchor;
  if (element.tagName === "g") {
    element.children.push(hit);
    return;
  }
  if (parent === undefined) return;
  const index = parent.children.indexOf(element);
  parent.children.splice(index + 1, 0, hit);
};

type StaticTargetCandidate = {
  readonly element: Element;
  readonly kind: "node" | "edge";
  readonly label: string;
  readonly parent?: Element;
  readonly labelElement?: Element;
};

const staticTargetCandidates = (
  root: Element,
): ReadonlyArray<StaticTargetCandidate> => {
  const elements: Array<Element> = [];
  const parents = new Map<Element, Element>();
  const walk = (element: Element): void => {
    elements.push(element);
    for (const child of element.children) {
      if (!isElement(child)) continue;
      parents.set(child, element);
      walk(child);
    }
  };
  walk(root);
  const candidates: Array<StaticTargetCandidate> = [];
  const seen = new Set<Element>();
  const descendantsOf = (element: Element): ReadonlyArray<Element> => {
    const descendants: Array<Element> = [];
    const collect = (parent: Element): void => {
      for (const child of parent.children) {
        if (!isElement(child)) continue;
        descendants.push(child);
        collect(child);
      }
    };
    collect(element);
    return descendants;
  };
  const nodeLabelOf = (element: Element): string => {
    const labelGroup = descendantsOf(element).find((candidate) =>
      hasClass(candidate, "label-group"),
    );
    return textOf(labelGroup ?? element);
  };
  const add = ({
    element,
    kind,
    label,
    labelElement,
  }: {
    readonly element: Element;
    readonly kind: "node" | "edge";
    readonly label: string;
    readonly labelElement?: Element;
  }): void => {
    const normalizedLabel = label.trim().replace(/\s+/gu, " ");
    if (
      normalizedLabel === "" ||
      seen.has(element) ||
      element.tagName === "svg" ||
      hasClass(element, "label")
    )
      return;
    seen.add(element);
    candidates.push({
      element,
      kind,
      label: normalizedLabel,
      parent: parents.get(element),
      ...(labelElement === undefined ? {} : { labelElement }),
    });
  };
  for (const element of elements) {
    if (
      element.tagName === "g" &&
      (hasClass(element, "node") ||
        hasClass(element, "classGroup") ||
        hasClass(element, "mindmap-node") ||
        hasClass(element, "timeline-node"))
    ) {
      add({ element, kind: "node", label: nodeLabelOf(element) });
    }
    if (element.tagName === "rect" && hasClass(element, "task")) {
      const id = element.properties.id;
      const parent = parents.get(element);
      const labelElement =
        typeof id === "string"
          ? elements.find(
              (candidate) => candidate.properties.id === `${id}-text`,
            )
          : parent === undefined
            ? undefined
            : descendantsOf(parent).find(
                (candidate) =>
                  candidate.tagName === "text" && hasClass(candidate, "task"),
              );
      add({
        element,
        kind: "node",
        label: labelElement === undefined ? "" : textOf(labelElement),
      });
    }
    if (element.tagName === "rect" && hasClass(element, "journey-section")) {
      const parent = parents.get(element);
      add({
        element,
        kind: "node",
        label: parent === undefined ? "" : textOf(parent),
      });
    }
    if (
      element.tagName === "g" &&
      element.children.some(
        (child) => isElement(child) && hasClass(child, "actor-top"),
      )
    ) {
      add({ element, kind: "node", label: textOf(element) });
    }
  }

  const pieSlices = elements.filter(
    (element) => element.tagName === "path" && hasClass(element, "pieCircle"),
  );
  const pieLabels = elements.filter((element) => hasClass(element, "legend"));
  const pieValues = elements.filter((element) => hasClass(element, "slice"));
  for (const [index, element] of pieSlices.entries()) {
    const label = pieLabels[index];
    const value = pieValues[index];
    add({
      element,
      kind: "node",
      label:
        label === undefined
          ? ""
          : `${textOf(label)}${value === undefined ? "" : `, ${textOf(value)}`}`,
    });
  }

  const commits = elements.filter(
    (element) => element.tagName === "circle" && hasClass(element, "commit"),
  );
  const commitLabels = elements.filter((element) =>
    hasClass(element, "commit-label"),
  );
  for (const [index, element] of commits.entries()) {
    add({
      element,
      kind: "node",
      label:
        commitLabels[index] === undefined ? "" : textOf(commitLabels[index]),
    });
  }

  const edgePaths = elements.find((element) => hasClass(element, "edgePaths"));
  const edgeLabels = elements.find((element) =>
    hasClass(element, "edgeLabels"),
  );
  const edgeLabelElements = (edgeLabels?.children ?? []).filter(isElement);
  for (const [index, child] of (edgePaths?.children ?? [])
    .filter(isElement)
    .entries()) {
    const labelElement = edgeLabelElements[index];
    add({
      element: child,
      kind: "edge",
      label: labelElement === undefined ? "" : textOf(labelElement),
      labelElement,
    });
  }

  const messageEdges = elements.filter(
    (element) =>
      hasClass(element, "messageLine0") || hasClass(element, "messageLine1"),
  );
  const messageLabels = elements.filter(
    (element) => element.tagName === "text" && hasClass(element, "messageText"),
  );
  for (const [index, element] of messageEdges.entries()) {
    const labelElement = messageLabels[index];
    add({
      element,
      kind: "edge",
      label: labelElement === undefined ? "" : textOf(labelElement),
      labelElement,
    });
  }
  return candidates;
};

const ensureSvgIntrinsicSize = (svgRoot: Element): void => {
  const viewBox = svgRoot.properties.viewBox;
  if (typeof viewBox !== "string") return;
  const values = viewBox
    .trim()
    .split(/[,\s]+/u)
    .map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return;
  }
  const [, , width, height] = values;
  if (
    svgRoot.properties.width === "100%" &&
    svgRoot.properties.height == null
  ) {
    // Mermaid's static renderers leave the SVG at width:100% with no height.
    // In Big Plan's max-content canvas that has no intrinsic size, so preserve
    // the renderer's viewBox dimensions as the layout floor before CSS fits it.
    svgRoot.properties.width = String(width);
    svgRoot.properties.height = String(height);
  }
};

/**
 * Replaces Mermaid's renderer ids on the semantic node/edge targets with
 * Big Plan anchors, and fails if the pinned renderer no longer exposes the
 * target set the compiler extracted from the source.
 */
export const rewriteMermaidSvgTargets = ({
  svg,
  idNamespace,
  nodes,
  edges,
  interactive = true,
  idSuffix = "",
  staticAnchorPrefix,
}: {
  readonly svg: string;
  readonly idNamespace: string;
  readonly nodes: ReadonlyArray<MermaidSvgNodeTarget>;
  readonly edges: ReadonlyArray<MermaidSvgEdgeTarget>;
  readonly interactive?: boolean;
  readonly idSuffix?: string;
  readonly staticAnchorPrefix?: string;
}): string => {
  const root = fromHtml(svg, { fragment: true }).children.filter(isElement);
  if (root.length !== 1 || root[0]?.tagName !== "svg") {
    throw new Error("Mermaid returned a document without one SVG root");
  }
  const svgRoot = root[0];
  const elements: Array<Element> = [];
  const walk = (element: Element): void => {
    elements.push(element);
    for (const child of element.children) {
      if (isElement(child)) walk(child);
    }
  };
  walk(svgRoot);
  const elementIds = new Map<Element, string>();
  const references = new Map<string, string>();
  for (const [index, element] of elements.entries()) {
    const id = element.properties.id;
    if (typeof id === "string") {
      const nextId = `${idNamespace}${idSuffix}--svg-${index + 1}`;
      elementIds.set(element, nextId);
      if (!references.has(id)) references.set(id, nextId);
    }
  }
  if (!interactive) {
    if (staticAnchorPrefix === undefined) {
      namespaceSvgIds({ elements, elementIds, references });
      return toHtml(svgRoot, { allowDangerousHtml: false });
    }
    ensureSvgIntrinsicSize(svgRoot);
    const candidates = staticTargetCandidates(svgRoot);
    const occurrences = new Map<string, number>();
    let staticEdgeOrdinal = 0;
    for (const target of candidates) {
      const key = `${target.kind}\u0000${target.label}`;
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      const anchor = mermaidStaticItemAnchor({
        figure: staticAnchorPrefix,
        kind: target.kind,
        label: target.label,
        occurrence,
      });
      const oldId = target.element.properties.id;
      elementIds.set(target.element, anchor + idSuffix);
      if (typeof oldId === "string") references.set(oldId, anchor + idSuffix);
      if (target.kind === "edge") {
        addEdgeHitTarget({
          element: target.element,
          anchor,
          idSuffix,
          parent: target.parent,
        });
      }
      setTargetAttributes({
        element: target.element,
        kind: target.kind,
        anchor,
        name: `${target.kind} "${target.label}"`,
        accessibleName: target.label,
        nodeId: target.kind === "node" ? target.label : undefined,
        label: target.kind === "edge" ? target.label : undefined,
      });
      target.element.properties.id = anchor + idSuffix;
      if (target.kind === "edge") {
        staticEdgeOrdinal += 1;
        isolateEdgeMarkerDefinitions({
          element: target.element,
          markerNamespace: `${idNamespace}${idSuffix}--static-edge-${staticEdgeOrdinal}`,
          elements,
        });
      }
      if (target.kind === "edge" && target.labelElement !== undefined) {
        target.labelElement.properties["data-flow-edge-label-target"] = "";
        target.labelElement.properties["data-flow-edge-anchor"] = anchor;
        target.labelElement.properties["data-flow-edge-label"] = target.label;
        target.labelElement.properties.role = "button";
        target.labelElement.properties["aria-label"] =
          'Select edge label "' + target.label + '"';
        target.labelElement.properties.tabindex = "-1";
      }
    }
    namespaceSvgIds({ elements, elementIds, references });
    return toHtml(svgRoot, { allowDangerousHtml: false });
  }
  const nodeIdOf = (element: Element): string | undefined => {
    const id = element.properties.id;
    if (typeof id !== "string") return undefined;
    return /(?:^|-)flowchart-(.+)-\d+$/u.exec(id)?.[1];
  };
  const used = new Set<Element>();
  for (const node of nodes) {
    const matches = elements.filter(
      (element) => nodeIdOf(element) === node.id && !used.has(element),
    );
    const element = matches[0];
    if (matches.length !== 1 || element === undefined) {
      throw new Error(
        `Mermaid SVG target mismatch for node "${node.id}"; expected one rendered node`,
      );
    }
    used.add(element);
    const oldId = element.properties.id;
    elementIds.set(element, node.anchor + idSuffix);
    if (typeof oldId === "string") {
      references.set(oldId, node.anchor + idSuffix);
    }
    setTargetAttributes({
      element,
      kind: "node",
      anchor: node.anchor,
      name: `node "${node.label}"`,
      accessibleName: node.label,
      nodeId: node.id,
      label: node.label,
    });
    element.properties.id = node.anchor + idSuffix;
  }
  const edgeGroup = elements.find(
    (element) =>
      element.tagName === "g" &&
      (Array.isArray(element.properties.className)
        ? element.properties.className.includes("edgePaths")
        : element.properties.className === "edgePaths"),
  );
  const edgeElements = (edgeGroup?.children ?? []).filter(isElement);
  if (edgeElements.length !== edges.length) {
    throw new Error(
      `Mermaid SVG target mismatch: the semantic model has ${edges.length} edges but Mermaid rendered ${edgeElements.length}`,
    );
  }
  for (const [index, edge] of edges.entries()) {
    const element = edgeElements[index];
    if (element === undefined) {
      throw new Error(
        `Mermaid SVG target mismatch for edge "${edge.from}" -> "${edge.to}"; expected another rendered edge`,
      );
    }
    used.add(element);
    const oldId = element.properties.id;
    elementIds.set(element, edge.anchor + idSuffix);
    if (typeof oldId === "string") {
      references.set(oldId, edge.anchor + idSuffix);
    }
    const label = edge.label === undefined ? "" : `, labelled "${edge.label}"`;
    setTargetAttributes({
      element,
      kind: "edge",
      anchor: edge.anchor,
      name: `edge ${edge.from} to ${edge.to}`,
      accessibleName: `edge from ${edge.from} to ${edge.to}${label}`,
      from: edge.from,
      to: edge.to,
      label: edge.label,
    });
    element.properties.id = edge.anchor + idSuffix;
    isolateEdgeMarkerDefinitions({
      element,
      markerNamespace: `${idNamespace}${idSuffix}--edge-${index + 1}`,
      elements,
    });
    addEdgeHitTarget({
      element,
      anchor: edge.anchor,
      idSuffix,
      parent: edgeGroup,
    });
  }
  const edgeLabels = elements.filter((element) => {
    const className = element.properties.className;
    return (
      element.tagName === "g" &&
      (Array.isArray(className)
        ? className.includes("edgeLabel")
        : className === "edgeLabel")
    );
  });
  const usedEdgeLabels = new Set<Element>();
  for (const edge of edges) {
    if (edge.label === undefined) continue;
    const label = edgeLabels.find(
      (candidate) =>
        !usedEdgeLabels.has(candidate) &&
        textOf(candidate).trim() === edge.label,
    );
    if (label === undefined) {
      throw new Error(
        'Mermaid SVG target mismatch for edge label "' +
          edge.label +
          '"; expected one rendered label',
      );
    }
    usedEdgeLabels.add(label);
    label.properties["data-flow-edge-label-target"] = "";
    label.properties["data-flow-edge-anchor"] = edge.anchor;
    label.properties["data-flow-edge-label"] = edge.label;
    label.properties.role = "button";
    label.properties["aria-label"] = 'Select edge label "' + edge.label + '"';
    label.properties.tabindex = "-1";
  }
  namespaceSvgIds({ elements, elementIds, references });
  return toHtml(svgRoot, { allowDangerousHtml: false });
};

/** Renders all sources in one pinned browser and sanitizes both theme variants. */
export const renderMermaidSources = (
  sources: MermaidRenderInput,
): ReadonlyArray<MermaidRenderResult> => {
  if (sources.length === 0) return [];
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", RENDER_SCRIPT],
      {
        input: JSON.stringify({
          mermaidScriptPath: MERMAID_SCRIPT_PATH,
          playwrightPath: PLAYWRIGHT_PATH,
          fontCss: MERMAID_FONT_CSS,
          fontFamily: MERMAID_FONT_FAMILY,
          fontProbes: MERMAID_FONT_PROBES,
          themeTokens: MERMAID_THEME_TOKENS,
          sources: sources.map(({ source }) => source),
        }),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Mermaid compile-time rendering needs Chromium (Playwright ${MERMAID_BROWSER_VERSION}); install the pinned browser with "bunx playwright install chromium". ${detail}`,
      { cause: error },
    );
  }
  const rendered = parseMermaidRenderOutput({
    output,
    expectedCount: sources.length,
  });
  return rendered.map((result) =>
    isMermaidRenderFailure(result)
      ? result
      : {
          light: sanitizeSvg({ svg: result.light, variant: "light" }),
          dark: sanitizeSvg({ svg: result.dark, variant: "dark" }),
        },
  );
};

const markdownChildren = (
  node: MarkdownRoot | MarkdownNode,
): ReadonlyArray<MarkdownNode> => ("children" in node ? node.children : []);

const mermaidSourcesInTree = (tree: MarkdownRoot): ReadonlyArray<string> => {
  const sources: Array<string> = [];
  const visit = (node: MarkdownRoot | MarkdownNode): void => {
    if (node.type === "mdxJsxFlowElement" && node.name === "MermaidDiagram") {
      for (const child of node.children) {
        if (
          child.type === "code" &&
          child.lang === "mermaid" &&
          (child.meta ?? "").trim() === ""
        ) {
          sources.push(child.value.trim());
        }
      }
      return;
    }
    for (const child of markdownChildren(node)) visit(child);
  };
  visit(tree);
  return sources;
};

export const prepareMermaidArtifacts = (
  tree: MarkdownRoot,
): ReadonlyMap<string, MermaidRenderResult> => {
  const sources: Array<string> = [];
  const seen = new Set<string>();
  for (const source of mermaidSourcesInTree(tree)) {
    if (
      source !== "" &&
      !seen.has(source) &&
      parseMermaidSource(source).diagnostics.length === 0
    ) {
      seen.add(source);
      sources.push(source);
    }
  }
  const rendered = renderMermaidSources(sources.map((source) => ({ source })));
  return new Map(
    sources.map((source, index) => [
      source,
      rendered[index] as MermaidRenderResult,
    ]),
  );
};
