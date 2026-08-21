// Owns the renderer entry point that pairs two compiled component models and
// returns the component-owned inert diff view consumed by the review runtime.

import { toHtml } from "hast-util-to-html";
import type { Element, Root, RootContent } from "hast";
import type { ComponentDiffInput } from "../components/_model/component-diff/contract.js";
import {
  COMPONENT_REGISTRY,
  definitionFor,
} from "../components/_registration/registry.js";
import type { BlockDescriptor } from "./markdown/block-identity.js";
import { compileMarkdown } from "./markdown/compile-markdown.js";
import { reactToHast } from "./markdown/component-pipeline/react-hast-adapter.js";
import { isolateBaselineSide } from "./markdown/side-isolation.js";

export type RenderedComponentDiff = {
  readonly model: unknown;
  readonly view: string;
};

const isElement = (node: RootContent): node is Element =>
  node.type === "element";

/** Finds one rendered element by the stable block address the compiler gave it. */
const elementByBlockId = ({
  node,
  blockId,
}: {
  readonly node: Root | Element;
  readonly blockId: string;
}): Element | null => {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.properties["data-block-id"] === blockId) return child;
    const nested = elementByBlockId({ node: child, blockId });
    if (nested !== null) return nested;
  }
  return null;
};

/** Finds a descendant carrying one exact string-valued data attribute. */
const elementByDataValue = ({
  node,
  attribute,
  value,
}: {
  readonly node: Element;
  readonly attribute: string;
  readonly value: string;
}): Element | null => {
  if (node.properties[attribute] === value) return node;
  for (const child of node.children) {
    if (!isElement(child)) continue;
    const nested = elementByDataValue({
      node: child,
      attribute,
      value,
    });
    if (nested !== null) return nested;
  }
  return null;
};

const blockById = ({
  blocks,
  blockId,
}: {
  readonly blocks: ReadonlyArray<BlockDescriptor>;
  readonly blockId: string | undefined;
}): BlockDescriptor | undefined =>
  blockId === undefined
    ? undefined
    : blocks.find((block) => block.id === blockId);

const inputFor = ({
  status,
  baseline,
  proposed,
  runs,
}: {
  readonly status: "added" | "removed" | "changed";
  readonly baseline: BlockDescriptor | undefined;
  readonly proposed: BlockDescriptor | undefined;
  readonly runs: ComponentDiffInput<unknown>["runs"];
}): ComponentDiffInput<unknown> | null => {
  if (status === "added") {
    return proposed?.model === undefined
      ? null
      : { status, proposed: proposed.model, runs };
  }
  if (status === "removed") {
    return baseline?.model === undefined
      ? null
      : { status, baseline: baseline.model, runs };
  }
  return baseline?.model === undefined || proposed?.model === undefined
    ? null
    : {
        status,
        baseline: baseline.model,
        proposed: proposed.model,
        runs,
      };
};

// The diff root replaces the proposed component root, so it inherits only the
// renderer-owned address and component descriptors. Component-private markup
// stays on the real side renderings inside it.
const inheritProposedRootIdentity = ({
  diffRoot,
  proposedRoot,
}: {
  readonly diffRoot: Element;
  readonly proposedRoot: Element | null;
}): void => {
  if (proposedRoot === null) return;
  for (const [property, value] of Object.entries(proposedRoot.properties)) {
    if (property === "data-component" || property.startsWith("data-block-")) {
      diffRoot.properties[property] = value;
    }
  }
};

/** Compiles and renders one component-root location through its diff contract. */
export const renderDiffView = ({
  baselineMarkdown,
  proposedMarkdown,
  baselineBlockId,
  proposedBlockId,
  status,
  runs,
}: {
  readonly baselineMarkdown: string;
  readonly proposedMarkdown: string;
  readonly baselineBlockId: string | undefined;
  readonly proposedBlockId: string | undefined;
  readonly status: "added" | "removed" | "changed";
  readonly runs: ComponentDiffInput<unknown>["runs"];
}): RenderedComponentDiff | null => {
  const baselineDocument = compileMarkdown({ markdown: baselineMarkdown });
  const proposedDocument = compileMarkdown({ markdown: proposedMarkdown });
  const baseline = blockById({
    blocks: baselineDocument.blocks,
    blockId: baselineBlockId,
  });
  const proposed = blockById({
    blocks: proposedDocument.blocks,
    blockId: proposedBlockId,
  });
  const component = proposed?.component ?? baseline?.component;
  const definition = definitionFor({
    name: component ?? null,
    registry: COMPONENT_REGISTRY,
  });
  const input = inputFor({ status, baseline, proposed, runs });
  if (definition === undefined || input === null) return null;

  const compiled = definition.compileDiff(input);
  const diffRoot = reactToHast(compiled.presentation());
  if (diffRoot === undefined) return null;
  const baselineSide = elementByDataValue({
    node: diffRoot,
    attribute: "data-component-diff-side",
    value: "baseline",
  });
  if (baselineSide !== null) {
    isolateBaselineSide({
      subtree: baselineSide,
      key: `${baselineBlockId ?? "removed"}:${proposedBlockId ?? "historical"}`,
    });
  }
  inheritProposedRootIdentity({
    diffRoot,
    proposedRoot:
      proposedBlockId === undefined
        ? null
        : elementByBlockId({
            node: proposedDocument.root,
            blockId: proposedBlockId,
          }),
  });
  return {
    model: compiled.model,
    view: toHtml(diffRoot, { allowDangerousHtml: false }),
  };
};
