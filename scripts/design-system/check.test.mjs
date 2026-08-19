// Proves the design-system check rejects an off-scale value and accepts the
// one relative size the scales deliberately still allow.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDesignSystem } from "./check.mjs";

/** Runs the check against a throwaway source tree and returns its report. */
const runAgainst = async (files, { artboardStylesheet } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-design-system-"));
  try {
    const source = join(root, "src", "components", "sample");
    await mkdir(source, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(source, name), content, "utf8");
    }
    if (artboardStylesheet !== undefined) {
      const wireframe = join(root, "src", "components", "wireframe");
      await mkdir(wireframe, { recursive: true });
      await writeFile(
        join(wireframe, "styles.css"),
        artboardStylesheet,
        "utf8",
      );
    }
    const failures = await checkDesignSystem({ sourceRoot: join(root, "src") });
    return {
      failed: failures.length > 0,
      output:
        failures.length === 0 ? "design system: passed" : failures.join("\n"),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("accepts values drawn from the scales", async () => {
  const result = await runAgainst({
    "view.tsx":
      'export const V = () => <p className="px-6 rounded-xl shadow-raised text-sm tracking-caps" />;\n',
  });
  assert.equal(result.failed, false);
  assert.match(result.output, /design system: passed/);
});

test("rejects a spacing step that is not on the scale", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <p className="px-5" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /off-scale spacing "px-5"/);
});

test("rejects a clipping container that also tightens its leading", async () => {
  const result = await runAgainst({
    "view.tsx":
      'export const V = () => <p className="truncate text-sm leading-none" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /clipped leading/);
});

test("accepts a clipping container that keeps its type step's leading", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <p className="truncate text-sm" />;\n',
  });
  assert.equal(result.failed, false);
});

test("accepts a comment that names the clipping pair it warns against", async () => {
  const result = await runAgainst({
    "view.tsx":
      '// The title uses truncate, so never add leading-none - it slices the descenders.\nexport const V = () => <p className="truncate text-sm" />;\n',
  });
  assert.equal(result.failed, false);
});

test("rejects a clipped leading even under an approved-metric marker", async () => {
  const result = await runAgainst({
    "view.tsx":
      '// approved-metric: the bar height the captain signed off on.\nexport const V = () => <p className="truncate text-sm leading-none" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /clipped leading/);
});

test("keeps the approved-metric marker's licence over the value scales", async () => {
  const result = await runAgainst({
    "view.tsx":
      '// approved-metric: the bar height the captain signed off on.\nexport const V = () => <p className="px-5" />;\n',
  });
  assert.equal(result.failed, false);
});

test("rejects an invented shadow and radius", async () => {
  const result = await runAgainst({
    "view.tsx":
      'export const V = () => <p className="rounded-[0.3rem] shadow-lg" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /off-scale radius "rounded-\[0\.3rem\]"/);
  assert.match(result.output, /off-scale shadow "shadow-lg"/);
});

test("allows an em type size because it names a ratio, not a step", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <code className="text-[0.875em]" />;\n',
  });
  assert.equal(result.failed, false);
});

test("rejects a rem type size because a step comes from the scale", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <p className="text-[0.8125rem]" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /off-scale type size "text-\[0\.8125rem\]"/);
});

const artboardStylesheet = ({ desktopTitle, effectiveOverride = "" }) =>
  [
    "@layer components {",
    "  .wireframe {",
    "    --wf-text-meta: 0.75rem;",
    "    --wf-text-small: 0.8125rem;",
    "    --wf-text-body: 0.875rem;",
    "    --wf-text-title: 1.25rem;",
    "    --wf-text-heading: 1.625rem;",
    "  }",
    '  .wireframe-screen[data-wireframe-device="desktop"] {',
    "    --wf-text-meta: 1.0625rem;",
    "    --wf-text-small: 1.1875rem;",
    "    --wf-text-body: 1.25rem;",
    `    --wf-text-title: ${desktopTitle};`,
    "    --wf-text-heading: 2.125rem;",
    "  }",
    '  .wireframe-screen[data-wireframe-device="tablet"] {',
    "    --wf-text-meta: 0.9375rem;",
    "    --wf-text-small: 1rem;",
    "    --wf-text-body: 1.0625rem;",
    "    --wf-text-title: 1.375rem;",
    "    --wf-text-heading: 1.75rem;",
    "  }",
    "  .wireframe-artboard { font-size: var(--wf-text-body); }",
    "  .wireframe-panel-title { font-size: var(--wf-text-title); }",
    "  .wireframe-heading { font-size: var(--wf-text-heading); }",
    "  .wireframe-eyebrow { font-size: var(--wf-text-meta); }",
    effectiveOverride,
    "}",
    "",
  ].join("\n");

test("accepts an artboard ramp whose roles are a visible step apart", async () => {
  const result = await runAgainst(
    {},
    { artboardStylesheet: artboardStylesheet({ desktopTitle: "1.625rem" }) },
  );
  assert.equal(result.failed, false);
  assert.match(result.output, /design system: passed/);
});

test("rejects an artboard title too close to the content beneath it", async () => {
  const result = await runAgainst(
    {},
    { artboardStylesheet: artboardStylesheet({ desktopTitle: "1.3125rem" }) },
  );
  assert.equal(result.failed, true);
  assert.match(
    result.output,
    /desktop title \(1\.3125rem\) is only 1\.05x body/,
  );
});

test("rejects an effective device override that flattens the ramp", async () => {
  const result = await runAgainst(
    {},
    {
      artboardStylesheet: artboardStylesheet({
        desktopTitle: "1.625rem",
        effectiveOverride:
          '  .wireframe-artboard[data-wireframe-device="phone"] .wireframe-heading { font-size: 1.375rem; }',
      }),
    },
  );
  assert.equal(result.failed, true);
  assert.match(
    result.output,
    /phone heading \(1\.375rem\) is only 1\.10x title/,
  );
});

test("rejects a device artboard ramp override that flattens the ramp", async () => {
  const result = await runAgainst(
    {},
    {
      artboardStylesheet: artboardStylesheet({
        desktopTitle: "1.625rem",
        effectiveOverride:
          '  .wireframe-artboard[data-wireframe-device="phone"] { --wf-text-title: 1rem; }',
      }),
    },
  );
  assert.equal(result.failed, true);
  assert.match(result.output, /phone title \(1rem\) is only 1\.14x body/);
});
