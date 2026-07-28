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

const SNIPPET_PLAN = `# Plan

## The change

<CodeSnippet file="src/cache/read.ts" startLine="18" showLineNumbers>

\`\`\`ts
const cached = await cache.get(key);
if (cached !== null && cached.ageSeconds <= 60) {
  return cached.value;
}
return readOrigin(key);
\`\`\`

<Annotation lines="19-21">

The fresh window serves directly; everything else falls through.

</Annotation>

<Annotation lines="22">

Origin reads stay *unmetered* for now.

</Annotation>

</CodeSnippet>

<CodeSnippet showLineNumbers>

\`\`\`sh
bun run build
\`\`\`

</CodeSnippet>
`;

const TREE_PLAN = `# Plan

## Layout

<FileTree title="Repository layout">

\`\`\`tree
src/
  model/ - The framework-free contract.
    compile-callout.ts
  react/
    callout/
      callout.tsx
  empty-dir/
README.md - The entry point.
\`\`\`

</FileTree>

<FileTree>

\`\`\`tree
docs/
  cli.md
\`\`\`

</FileTree>
`;

const TREE_DIFF_PLAN = `# Plan

## Changes

<FileTreeDiff title="Planned changes">

\`\`\`tree
src/
  catalog/
    refresh-worker.ts [modified] - Move refresh work behind the queue.
    refresh-queue.ts [added] - Deduplicate refresh jobs by cache key.
  metrics/ [removed] - The legacy module retires.
    legacy-counter.ts [removed]
ops/ -> deploy/ [renamed] - Match the platform team's naming.
  runbook.md
README.md [modified]
\`\`\`

</FileTreeDiff>

<FileTreeDiff hideDiff>

\`\`\`tree
docs/
  cli.md [modified]
\`\`\`

</FileTreeDiff>
`;

const SCHEMA_PLAN = `# Plan

## Storage

<DatabaseTableSchema name="billing.subscriptions">

\`\`\`dbml
id           bigint      [pk, increment]
customer_id  bigint      [not null, ref: > billing.customers.id, delete: cascade, update: restrict]
seats        integer     [not null, default: 1, check: 'seats > 0', note: 'Licensed seats.']
canceled_at  timestamptz

indexes {
  customer_id [name: 'subscriptions_customer_idx', note: 'Backs the dashboard.']
  customer_id [unique, name: 'subscriptions_live_idx', where: 'canceled_at IS NULL']
  (customer_id, canceled_at) [name: 'subscriptions_lifecycle_idx']
}

Note: 'One row per subscription.'
\`\`\`

<Ddl title="PostgreSQL">

\`\`\`sql
CREATE TABLE billing.subscriptions (id bigint PRIMARY KEY);
\`\`\`

</Ddl>

</DatabaseTableSchema>
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

  it("should render a byte-identical document for annotated, numbered, and bare CodeSnippets", () => {
    const vanilla = renderDocument({
      markdown: SNIPPET_PLAN,
      fallbackTitle: "x",
    });
    const react = renderDocument({
      markdown: SNIPPET_PLAN,
      fallbackTitle: "x",
      renderer: "react",
    });
    expect(react.html).toContain("data-snippet-annotation=");
    expect(react.html).toBe(vanilla.html);
  });

  it("should render a byte-identical document for titled and bare FileTrees", () => {
    const vanilla = renderDocument({
      markdown: TREE_PLAN,
      fallbackTitle: "x",
    });
    const react = renderDocument({
      markdown: TREE_PLAN,
      fallbackTitle: "x",
      renderer: "react",
    });
    expect(react.html).toContain("data-file-tree=");
    expect(react.html).toBe(vanilla.html);
  });

  it("should render a byte-identical document for titled and untitled FileTreeDiffs", () => {
    const vanilla = renderDocument({
      markdown: TREE_DIFF_PLAN,
      fallbackTitle: "x",
    });
    const react = renderDocument({
      markdown: TREE_DIFF_PLAN,
      fallbackTitle: "x",
      renderer: "react",
    });
    expect(react.html).toContain("data-file-tree-diff=");
    expect(react.html).toBe(vanilla.html);
  });

  it("should render a byte-identical document for a DatabaseTableSchema with indexes and DDL", () => {
    const vanilla = renderDocument({
      markdown: SCHEMA_PLAN,
      fallbackTitle: "x",
    });
    const react = renderDocument({
      markdown: SCHEMA_PLAN,
      fallbackTitle: "x",
      renderer: "react",
    });
    expect(react.html).toContain("data-database-table-schema=");
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
