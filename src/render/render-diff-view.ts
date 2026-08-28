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
import {
  compileMarkdown,
  type CompiledMarkdown,
} from "./markdown/compile-markdown.js";
import { reactToHast } from "./markdown/component-pipeline/react-hast-adapter.js";
import { isolateBaselineSide } from "./markdown/side-isolation.js";

export type RenderedComponentDiff = {
  readonly model: unknown;
  readonly view: string;
};

export type CompiledDiffDocuments = {
  readonly baseline: CompiledMarkdown;
  readonly proposed: CompiledMarkdown;
};

export type DiffDocumentCompiler = (input: {
  readonly markdown: string;
}) => CompiledMarkdown;

/** Compiles each snapshot once so every location can reuse the document pair. */
export const compileDiffDocuments = ({
  baselineMarkdown,
  proposedMarkdown,
  compileDocument = compileMarkdown,
}: {
  readonly baselineMarkdown: string;
  readonly proposedMarkdown: string;
  /** Explicit seam for the timing-free one-compile-per-side contract test. */
  readonly compileDocument?: DiffDocumentCompiler;
}): CompiledDiffDocuments => ({
  baseline: compileDocument({ markdown: baselineMarkdown }),
  proposed: compileDocument({ markdown: proposedMarkdown }),
});

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

/**
 * Renders one engine-owned block as inert evidence for a diff side.
 *
 * A picture is the only block left on this path: it carries no words, so the
 * lens can evidence its change only by replaying the compiled picture itself.
 * Both replayed sides go through the side-isolation module because the lens
 * hides the plan's own block while it shows them, so neither replay is the
 * plan - which is exactly what that module means by a baseline side, and what
 * supersedes the route's own scrub and id-namespacing pass.
 */
export const renderIsolatedBlockView = ({
  document,
  blockId,
  key,
}: {
  readonly document: CompiledMarkdown;
  readonly blockId: string | undefined;
  readonly key: string;
}): string | undefined => {
  if (blockId === undefined) return undefined;
  const block = elementByBlockId({ node: document.root, blockId });
  if (block === null) return undefined;
  const isolated = structuredClone(block);
  isolateBaselineSide({ subtree: isolated, key });
  return toHtml(isolated, { allowDangerousHtml: false });
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

// A bespoke diff view renders the component's declared subtargets after the
// document identity pass has already completed. Reattach the exact addresses
// the proposed document minted by structural ownership and declaration, so a
// field remains the same comment target when the diff replaces its card.
const inheritProposedSubtargetIdentity = ({
  diffRoot,
  proposedRoot,
  proposed,
  blocks,
}: {
  readonly diffRoot: Element;
  readonly proposedRoot: Element | null;
  readonly proposed: BlockDescriptor | undefined;
  readonly blocks: ReadonlyArray<BlockDescriptor>;
}): void => {
  if (proposedRoot === null || proposed === undefined) return;
  const proposedSide = elementByDataValue({
    node: diffRoot,
    attribute: "data-component-diff-side",
    value: "proposed",
  });
  if (proposedSide === null) return;
  const available = blocks.filter((block) => block.ownerId === proposed.id);
  const claimed = new Set<string>();
  const visit = (node: Element): void => {
    const kind = node.properties["data-commentable-kind"];
    const label = node.properties["data-commentable-label"];
    if (typeof kind === "string" && typeof label === "string") {
      const target = available.find(
        (block) =>
          !claimed.has(block.id) &&
          block.kind === kind &&
          block.label === label.replaceAll("`", ""),
      );
      if (target !== undefined) {
        claimed.add(target.id);
        node.properties["data-block-id"] = target.id;
        node.properties["data-block-kind"] = target.kind;
        node.properties["data-block-label"] = target.label;
        node.properties["data-block-section"] = target.section;
      }
    }
    for (const child of node.children) {
      if (isElement(child)) visit(child);
    }
  };
  visit(proposedSide);
};

/** Compiles and renders one component-root location through its diff contract. */
export const renderDiffView = ({
  baselineDocument,
  proposedDocument,
  baselineBlockId,
  proposedBlockId,
  status,
  runs,
}: {
  readonly baselineDocument: CompiledMarkdown;
  readonly proposedDocument: CompiledMarkdown;
  readonly baselineBlockId: string | undefined;
  readonly proposedBlockId: string | undefined;
  readonly status: "added" | "removed" | "changed";
  readonly runs: ComponentDiffInput<unknown>["runs"];
}): RenderedComponentDiff | null => {
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
  const diffRoot = reactToHast(
    compiled.presentation(
      `${baselineBlockId ?? "removed"}:${proposedBlockId ?? "historical"}`,
      {
        baseline: baselineDocument.outline,
        proposed: proposedDocument.outline,
      },
    ),
  );
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
  inheritProposedSubtargetIdentity({
    diffRoot,
    proposedRoot:
      proposedBlockId === undefined
        ? null
        : elementByBlockId({
            node: proposedDocument.root,
            blockId: proposedBlockId,
          }),
    proposed,
    blocks: proposedDocument.blocks,
  });
  return {
    model: compiled.model,
    view: toHtml(diffRoot, { allowDangerousHtml: false }),
  };
};
