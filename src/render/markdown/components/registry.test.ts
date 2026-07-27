// Tests recursive scoped dispatch, direct-parent name boundaries, and scoped
// Markdown body policies without coupling the capability to a product component.

import type { Root } from "hast";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
  serializeMarkdown,
} from "../convert.js";
import type {
  ComponentDefinition,
  ComponentRenderer,
} from "../../../model/component-contract.js";
import { createDiagnosticCollector } from "../../../model/diagnostics.js";
import type { ComponentDiagnostic } from "../../../model/diagnostics.js";
import {
  rehypeRenderComponents,
  remarkValidateComponents,
} from "./registry.js";
import type { ComponentRegistry } from "./registry.js";

const renderNestedFixture: ComponentRenderer = ({ scopedChildren }) => {
  const branch = scopedChildren[0];
  const leaf = branch?.scopedChildren?.[0];
  return {
    type: "element",
    tagName: "section",
    properties: {
      ...(branch?.attributes["id"] === undefined
        ? {}
        : { "data-branch-id": branch.attributes["id"] }),
      ...(leaf?.attributes["label"] === undefined
        ? {}
        : { "data-leaf-label": leaf.attributes["label"] }),
    },
    children: leaf === undefined ? [] : [...leaf.children],
  };
};

const NESTED_COMPONENT_DEFINITION = {
  render: renderNestedFixture,
  scopedChildren: {
    Branch: {
      kind: "scoped-child",
      markdownBody: {
        prohibited: {
          heading: "Branch bodies cannot contain headings",
          registeredComponent: "Branch bodies cannot contain typed components",
        },
      },
      scopedChildren: {
        Leaf: {
          kind: "scoped-child",
          markdownBody: {
            prohibited: {
              heading: "Leaf bodies cannot contain headings",
            },
          },
        },
      },
    },
  },
} satisfies ComponentDefinition;

const NESTED_REGISTRY = {
  NestedFixture: NESTED_COMPONENT_DEFINITION,
} satisfies ComponentRegistry;

// Runs the production remark and rehype transforms against an isolated
// synthetic registry so capability tests cannot alter shipped definitions.
const compileWithRegistry = ({
  markdown,
  registry,
}: {
  readonly markdown: string;
  readonly registry: ComponentRegistry;
}): {
  readonly root: Root;
  readonly diagnostics: ReadonlyArray<ComponentDiagnostic>;
} => {
  const diagnostics = createDiagnosticCollector();
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkValidateComponents, { diagnostics, registry })
    .use(remarkRehype, {
      passThrough: [
        "mdxjsEsm",
        "mdxFlowExpression",
        "mdxTextExpression",
        "mdxJsxFlowElement",
        "mdxJsxTextElement",
      ],
    })
    .use(rehypeRenderComponents, { diagnostics, registry });
  const root: Root = processor.runSync(processor.parse(markdown));
  return { root, diagnostics: diagnostics.diagnostics };
};

// Extracts typed author diagnostics while preserving renderer defects.
const diagnosticsFor = (markdown: string) => {
  try {
    compileMarkdown({ markdown });
  } catch (error: unknown) {
    if (error instanceof MarkdownDiagnosticsError) {
      return error.diagnostics;
    }
    throw error;
  }
  throw new Error("Expected markdown compilation to fail");
};

describe("scoped child dispatch", () => {
  it("should leave a top-level scoped name unknown", () => {
    expect(
      diagnosticsFor('<Annotation lines="1">\nReview.\n</Annotation>\n'),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Unknown component "Annotation"',
      },
    ]);
  });

  it("should dispatch a grandchild through its direct scoped parent", () => {
    const { root, diagnostics } = compileWithRegistry({
      markdown:
        '<NestedFixture>\n<Branch id="decision">\n<Leaf label="keep">\nLeaf with **formatting**.\n</Leaf>\n</Branch>\n</NestedFixture>\n',
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([]);
    expect(serializeMarkdown({ root })).toBe(
      '<section data-branch-id="decision" data-leaf-label="keep"><p>Leaf with <strong>formatting</strong>.</p></section>',
    );
  });

  it("should leave an undeclared name unknown within a nested scope", () => {
    const { diagnostics } = compileWithRegistry({
      markdown:
        "<NestedFixture>\n<Branch>\n<Undeclared>\nText.\n</Undeclared>\n</Branch>\n</NestedFixture>\n",
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown component "Undeclared"',
      },
    ]);
  });

  it("should leave a grandchild name unknown when it skips its parent", () => {
    const { diagnostics } = compileWithRegistry({
      markdown: "<NestedFixture>\n<Leaf>\nText.\n</Leaf>\n</NestedFixture>\n",
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([
      {
        line: 2,
        column: 1,
        message: 'Unknown component "Leaf"',
      },
    ]);
  });

  it("should enforce a nested scoped child's Markdown body policy", () => {
    const { diagnostics } = compileWithRegistry({
      markdown:
        "<NestedFixture>\n<Branch>\n<Leaf>\n# Nested heading\n</Leaf>\n</Branch>\n</NestedFixture>\n",
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([
      {
        line: 4,
        column: 1,
        message: "Leaf bodies cannot contain headings",
      },
    ]);
  });

  it("should report a prohibited registered component exactly once", () => {
    const { diagnostics } = compileWithRegistry({
      markdown:
        "<NestedFixture>\n<Branch>\n<NestedFixture>\nInner.\n</NestedFixture>\n</Branch>\n</NestedFixture>\n",
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "Branch bodies cannot contain typed components",
      },
    ]);
  });

  it("should apply a parent body policy only outside its nested scoped children", () => {
    const { diagnostics } = compileWithRegistry({
      markdown:
        "<NestedFixture>\n<Branch>\n# Branch heading\n<Leaf>\nClean leaf.\n</Leaf>\n</Branch>\n</NestedFixture>\n",
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "Branch bodies cannot contain headings",
      },
    ]);
  });

  it("should reset parent suppression at a declared child boundary", () => {
    const { diagnostics } = compileWithRegistry({
      markdown:
        "<NestedFixture>\n<Branch>\n<Leaf>\n<NestedFixture>\n<Branch>\n# Nested component heading\n</Branch>\n</NestedFixture>\n</Leaf>\n</Branch>\n</NestedFixture>\n",
      registry: NESTED_REGISTRY,
    });

    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: "Branch bodies cannot contain headings",
      },
    ]);
  });

  it("should dispatch a direct child through its declaring parent", () => {
    const { root } = compileMarkdown({
      markdown:
        '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Annotation lines="1">\nUse **bounded** retries.\n</Annotation>\n</CodeDiff>\n',
    });
    const html = serializeMarkdown({ root });
    expect(html).toContain('data-annotation-lines="1"');
    expect(html).toContain("Use <strong>bounded</strong> retries.");
  });

  it("should not dispatch a scoped name nested below a direct child", () => {
    const diagnostics = diagnosticsFor(
      '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Callout type="note">\n<Annotation lines="1">\nReview.\n</Annotation>\n</Callout>\n</CodeDiff>\n',
    );
    expect(diagnostics).toContainEqual({
      line: 9,
      column: 1,
      message: 'Unknown component "Annotation"',
    });
  });

  it("should centrally validate attribute forms on a dispatched scoped child", () => {
    const diagnostics = diagnosticsFor(
      '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Annotation lines="1" lines="2" side={side} {...props}>\nReview.\n</Annotation>\n</CodeDiff>\n',
    );
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Duplicate attribute "lines"',
      'Expression-valued attribute "side" is not supported',
      "Spread attributes are not supported",
    ]);
  });
});
