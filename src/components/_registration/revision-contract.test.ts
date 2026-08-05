// Proves the closed typed-component revision contract over real authored MDX:
// registry coverage, inert compiler views, and semantic-only diagram changes.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Element, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";
import { renderDocument } from "../../render/render-document.js";
import { buildRevisionChangeSet } from "../../review/revision-change-set.js";
import type { RevisionSnapshot } from "../../review/revision-diff.js";
import { COMPONENT_REGISTRY } from "./registry.js";

const FLOW_BEFORE = `# Retry plan

## Retry state machine

The worker treats \`blocking\` as the durable state while a retry waits for its next eligibility time.

<FlowDiagram>

<Stage title="Await next attempt">
<Node id="waiting" label="blocking" tone="source">

Eligible when \`next_attempt_at\` arrives

</Node>
</Stage>

<Stage title="Claim and capture">
<Node id="claim" label="Claim and capture" />
</Stage>

<Stage title="Outcome">
<Node id="success" label="succeeds" tone="destination" />
<Node id="reschedule" label="reschedules" tone="destination" />
<Node id="cap" label="reaches cap" tone="destination" />
</Stage>

<Edge from="waiting" to="claim" label="claims" />
<Edge from="claim" to="success" />
<Edge from="claim" to="reschedule" />
<Edge from="claim" to="cap" />

The state machine keeps waiting and terminal outcomes explicit.

</FlowDiagram>
`;

const renderBlocks = (markdown: string) =>
  renderDocument({ markdown, fallbackTitle: "fixture", identity: {} }).blocks;

const componentSnapshots = (markdown: string) =>
  renderBlocks(markdown).flatMap((block): ReadonlyArray<RevisionSnapshot> =>
    block.snapshot.type === "component" ? [block.snapshot] : [],
  );

const isElement = (node: RootContent): node is Element =>
  node.type === "element";

const assertInertSnapshot = (snapshot: RevisionSnapshot): void => {
  if (snapshot.type !== "component") {
    throw new Error("Expected a component revision snapshot");
  }
  const parsed = fromHtml(snapshot.html, { fragment: true });
  const roots = parsed.children.filter(isElement);
  expect(roots).toHaveLength(1);
  const root = roots[0];
  if (root === undefined) throw new Error("Expected one inert root");
  expect(snapshot.html).toContain(
    `data-review-component-snapshot="${snapshot.component}"`,
  );
  expect(snapshot.html).toContain("data-review-snapshot-inert");
  expect(snapshot.html).not.toMatch(
    /<(?:script|iframe|object|embed|form|input|textarea|select|button)\b/i,
  );
  expect(snapshot.html).not.toMatch(
    /\s(?:id|tabindex|contenteditable|on[a-z]+|data-component|data-component-instance|data-[a-z-]*(?:controls|maximize|zoom|proposal)[a-z-]*)=/i,
  );
};

describe("component revision contract", () => {
  it("should cover the exact component registry with real inert fixtures", () => {
    const fixtureNames = new Set<string>();
    for (const filename of readdirSync("examples").filter((entry) =>
      entry.endsWith(".mdx"),
    )) {
      const markdown = readFileSync(join("examples", filename), "utf8");
      for (const snapshot of componentSnapshots(markdown)) {
        if (snapshot.type !== "component") continue;
        fixtureNames.add(snapshot.component);
        expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
        assertInertSnapshot(snapshot);
      }
    }
    expect([...fixtureNames].sort()).toEqual(
      Object.keys(COMPONENT_REGISTRY).sort(),
    );
  });

  it("should own the blocking-to-activiating prose and diagram changes", () => {
    const after = FLOW_BEFORE.replaceAll("blocking", "activiating");
    const changeSet = buildRevisionChangeSet({
      pair: { fromRevision: "before", toRevision: "after" },
      before: renderBlocks(FLOW_BEFORE),
      after: renderBlocks(after),
    });
    const locations = changeSet.places.flatMap((place) => place.locations);
    expect(
      locations.map((location) => ({
        kind: location.kind,
        snapshot: location.newSnapshot?.type,
        component:
          location.newSnapshot?.type === "component"
            ? location.newSnapshot.component
            : undefined,
      })),
    ).toEqual([
      { kind: "paragraph", snapshot: "markdown", component: undefined },
      {
        kind: "flow-diagram",
        snapshot: "component",
        component: "FlowDiagram",
      },
    ]);
    const diagram = locations.find(
      (location) => location.newSnapshot?.type === "component",
    );
    expect(diagram?.oldSnapshot?.type).toBe("component");
    expect(diagram?.newSnapshot?.type).toBe("component");
    expect(diagram?.oldSnapshot?.html).toContain(">blocking<");
    expect(diagram?.newSnapshot?.html).toContain(">activiating<");
    expect(diagram?.newSnapshot?.html).toContain(
      'data-flow-edge-from="waiting"',
    );
    expect(diagram?.newSnapshot?.html).toContain('data-flow-edge-to="claim"');
  });

  it("should include a tone-only diagram change with unchanged semantic text", () => {
    const before = FLOW_BEFORE.replaceAll("blocking", "activiating");
    const after = before.replace('tone="source"', 'tone="neutral"');
    const changeSet = buildRevisionChangeSet({
      pair: { fromRevision: "before", toRevision: "after" },
      before: renderBlocks(before),
      after: renderBlocks(after),
    });
    const locations = changeSet.places.flatMap((place) => place.locations);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      kind: "flow-diagram",
      oldText: expect.any(String),
      newText: expect.any(String),
      oldSnapshot: {
        type: "component",
        component: "FlowDiagram",
      },
      newSnapshot: {
        type: "component",
        component: "FlowDiagram",
      },
    });
    expect(locations[0]?.oldText).toBe(locations[0]?.newText);
    expect(locations[0]?.oldSnapshot?.semanticHash).not.toBe(
      locations[0]?.newSnapshot?.semanticHash,
    );
  });

  it("should suppress an unchanged diagram beside a heading rename", () => {
    const after = FLOW_BEFORE.replace(
      "## Retry state machine",
      "## Retry lifecycle",
    );
    const changeSet = buildRevisionChangeSet({
      pair: { fromRevision: "before", toRevision: "after" },
      before: renderBlocks(FLOW_BEFORE),
      after: renderBlocks(after),
    });
    const diagrams = changeSet.places
      .flatMap((place) => place.locations)
      .filter((location) => location.kind === "flow-diagram");
    expect(diagrams).toEqual([]);
  });
});
