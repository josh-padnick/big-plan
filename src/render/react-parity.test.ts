// Pins the React render target's parity contract: a document rendered with
// renderer "react" is byte-identical to the vanilla output for ported
// components, and components without a React port fall back to the vanilla
// renderer unchanged.

import { describe, expect, it } from "vitest";
import { renderDocument } from "./render-document.js";

const CALLOUT_PLAN = `# Plan

## Context

<Callout type="tip" title="Try it">

Body with **strong**, \`code\`, and [a link](https://example.com).

</Callout>

<Callout type="danger">

Escaping cases: a < b & "quoted" text with an apostrophe's edge.

</Callout>
`;

const UNPORTED_PLAN = `# Plan

## Question

<SmallDecisionSet title="Open questions">

<SmallDecision question="Ship?">

<Option title="Yes" recommended />

<Option title="No" />

</SmallDecision>

</SmallDecisionSet>
`;

describe("react renderer parity", () => {
  it("should render a byte-identical document when the ported Callout renders through React", () => {
    const vanilla = renderDocument({
      markdown: CALLOUT_PLAN,
      fallbackTitle: "x",
    });
    const react = renderDocument({
      markdown: CALLOUT_PLAN,
      fallbackTitle: "x",
      renderer: "react",
    });
    expect(react.html).toContain('data-callout="tip"');
    expect(react.html).toBe(vanilla.html);
  });

  it("should fall back to the vanilla renderer for components without a React port", () => {
    const vanilla = renderDocument({
      markdown: UNPORTED_PLAN,
      fallbackTitle: "x",
    });
    const react = renderDocument({
      markdown: UNPORTED_PLAN,
      fallbackTitle: "x",
      renderer: "react",
    });
    expect(react.html).toBe(vanilla.html);
  });
});
