// Owns one-pass component revision snapshot materialization: exact instance
// association, semantic hashing, and the compiler-owned inert HTML projection.

import { createHash } from "node:crypto";
import type { Element, ElementContent, Root } from "hast";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import type { DocumentOutline } from "../../../components/_model/document-outline/document-outline.js";
import type { ComponentRevisionMaterial } from "../../../components/_registration/define-component.js";
import type { ReactHastAdapter } from "./react-hast-adapter.js";

export const COMPONENT_INSTANCE_ATTRIBUTE = "data-component-instance";

export type ComponentRevisionSnapshot = {
  readonly type: "component";
  readonly component: string;
  readonly semanticHash: string;
  readonly html: string;
};

export type PendingComponentRevision = {
  readonly component: string;
  readonly materialize: (outline: DocumentOutline) => ComponentRevisionMaterial;
};

export type MaterializedComponentRevision = {
  readonly snapshot: ComponentRevisionSnapshot;
  readonly text: string;
};

const REMOVED_TAGS = new Set([
  "button",
  "dialog",
  "embed",
  "form",
  "iframe",
  "input",
  "object",
  "script",
  "select",
  "textarea",
]);

const REPLACED_TAGS: Readonly<Record<string, string>> = {
  a: "span",
  details: "div",
  summary: "div",
};

const isBehaviorProperty = (name: string): boolean => {
  const normalized = name.toLocaleLowerCase();
  return (
    normalized === "id" ||
    normalized === "href" ||
    normalized === "target" ||
    normalized === "download" ||
    normalized === "contenteditable" ||
    normalized === "tabindex" ||
    normalized === "autofocus" ||
    normalized.startsWith("on") ||
    normalized === "data-component" ||
    normalized === COMPONENT_INSTANCE_ATTRIBUTE ||
    normalized.includes("controls") ||
    normalized.includes("maximize") ||
    normalized.includes("zoom") ||
    normalized.includes("show-original") ||
    normalized.includes("revert-all") ||
    normalized.includes("proposal")
  );
};

const ownsBehaviorSubtree = (node: Element): boolean =>
  Object.keys(node.properties).some((name) => {
    const normalized = name.toLocaleLowerCase();
    return (
      normalized.includes("controls") ||
      normalized.includes("proposal-group") ||
      normalized.includes("maximize")
    );
  });

/** Projects a normal compiler-owned view into inert, read-only HAST. */
const inertNode = (node: ElementContent): ElementContent | undefined => {
  if (node.type !== "element") return node;
  if (REMOVED_TAGS.has(node.tagName) || ownsBehaviorSubtree(node)) {
    return undefined;
  }
  const properties = Object.fromEntries(
    Object.entries(node.properties).filter(
      ([name]) => !isBehaviorProperty(name),
    ),
  );
  const children = node.children.flatMap((child) => {
    const inert = inertNode(child);
    return inert === undefined ? [] : [inert];
  });
  return {
    ...node,
    tagName: REPLACED_TAGS[node.tagName] ?? node.tagName,
    properties,
    children,
  };
};

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
};

const semanticHash = (semantic: unknown): string =>
  createHash("sha256").update(stableJson(semantic)).digest("hex");

const serializeElement = (element: Element): string => {
  const root: Root = { type: "root", children: [element] };
  return unified().use(rehypeStringify).stringify(root);
};

/** Materializes every retained component instance after outline completion. */
export const materializeComponentRevisionSnapshots = ({
  pending,
  outline,
  adapt,
}: {
  readonly pending: ReadonlyMap<string, PendingComponentRevision>;
  readonly outline: DocumentOutline;
  readonly adapt: ReactHastAdapter;
}): ReadonlyMap<string, MaterializedComponentRevision> => {
  const snapshots = new Map<string, MaterializedComponentRevision>();
  for (const [instanceId, component] of pending) {
    const material = component.materialize(outline);
    const rendered = adapt(material.presentation);
    if (rendered === undefined) {
      throw new Error(
        `Internal error: revision view for "${component.component}" produced no element`,
      );
    }
    const inert = inertNode(rendered);
    if (inert === undefined || inert.type !== "element") {
      throw new Error(
        `Internal error: revision view for "${component.component}" has no inert root`,
      );
    }
    inert.properties["data-review-component-snapshot"] = component.component;
    inert.properties["data-review-snapshot-inert"] = "";
    snapshots.set(instanceId, {
      text: material.text,
      snapshot: {
        type: "component",
        component: component.component,
        semanticHash: semanticHash(material.semantic),
        html: serializeElement(inert),
      },
    });
  }
  return snapshots;
};
