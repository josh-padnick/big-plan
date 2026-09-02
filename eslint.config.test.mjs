// Proves the grid-track fence fires on each shape it governs and stays quiet
// on the regimes it deliberately leaves alone. ESLint is the consumer: each
// case is a fixture linted at a path the glob would actually see.

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import test from "node:test";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

const GRID_TRACK_MESSAGE = /must declare its column track/;
const IDENTITY_MESSAGE = /live-target\.browser\.ts/;

const lint = async ({ filePath, code }) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages ?? [];
};

const gridTrackMessages = (messages) =>
  messages.filter((message) => GRID_TRACK_MESSAGE.test(message.message));

const identityMessages = (messages) =>
  messages.filter((message) => IDENTITY_MESSAGE.test(message.message));

test("should report an implicit track when a review-browser module hands over a class string", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/review/browser/scratch.ts",
      code: 'export const classes = "grid gap-2";\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should report an implicit track when a review-browser view sets className", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/review/browser/scratch.tsx",
      code: 'export const View = () => <div className="grid gap-2" />;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should report an implicit track when a shell module returns an HTML class string", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="mt-4 grid min-w-0 wide:mt-0"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should accept a shell HTML class string that names the column track", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] wide:mt-0"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should report a prefixed shell grid that leaves its track implicit", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="mt-4 wide:grid gap-6"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should accept a prefixed shell grid that names the matching track", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="mt-4 wide:grid wide:grid-cols-[12rem_1fr] gap-6"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should report an implicit track when a shell view sets className", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.tsx",
      code: 'export const View = () => <div className="grid gap-2" />;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should report the implicit sibling when one template also renders a declared track", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] gap-4"></div>\\n<div class="mt-4 grid gap-2"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should report the implicit sibling regardless of which one a template renders first", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="mt-4 grid gap-2"></div>\\n<div class="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] gap-4"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should accept a template whose siblings each name their own track", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] gap-4"></div>\\n<div class="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should report a shell grid written as the first token of its class value", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="grid gap-2"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should report a shell grid written as the last token of its class value", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div class="mt-4 gap-2 grid"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should not let a track in a neighbouring attribute answer for a class value", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<div data-track="grid-cols-[minmax(0,1fr)]" class="mt-4 grid gap-2"></div>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should not report a returned sentence that mentions a grid", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => {\n  return "Choose how the diagram grid renders.";\n};\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should not report a sentence a helper hands over as its whole body", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const label = (): string => "Choose how the diagram grid renders.";\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should not report copy passed to a call inside a returned template", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string =>\n  `<div>${panel({ description: "Choose how the diagram grid renders." })}</div>`;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should not report the text a template renders beside a class attribute", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<p class="mt-4">The diagram grid renders here.</p>`;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should still report a class attribute on the element that renders prose", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/scratch.ts",
      code: 'export const render = (): string => `<p class="mt-4 grid gap-2">The diagram grid renders here.</p>`;\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should still report a class fragment an interpolated conditional hands over", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/review/browser/scratch.tsx",
      code: 'export const View = ({ wide }: { wide: boolean }) => (\n  <div className={`mt-2 ${wide ? "grid gap-2" : "flex"}`} />\n);\n',
    }),
  );
  assert.equal(messages.length, 1);
});

test("should not report an implicit track in a plan-component view", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/components/_shared/decision-card/view.tsx",
      code: 'export const View = () => <div className="grid gap-2" />;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should not report a grid identifier in an embedded shell script as a missing track", async () => {
  const messages = gridTrackMessages(
    await lint({
      filePath: "src/render/shell/viewer-script.ts",
      code: 'export const VIEWER_SCRIPT = `const grid = figure.querySelector(".table-schema-grid")`;\n',
    }),
  );
  assert.equal(messages.length, 0);
});

test("should still fence a plan-identity selector in an embedded shell script", async () => {
  const messages = identityMessages(
    await lint({
      filePath: "src/render/shell/viewer-script.ts",
      code: "export const VIEWER_SCRIPT = `document.querySelector('[data-block-id=\"x\"]')`;\n",
    }),
  );
  assert.equal(messages.length, 1);
});

test("should fence a baseline plan-identity selector in an embedded shell script", async () => {
  const messages = identityMessages(
    await lint({
      filePath: "src/render/shell/viewer-script.ts",
      code: "export const VIEWER_SCRIPT = `document.querySelector('[data-baseline-block-id=\"x\"]')`;\n",
    }),
  );
  assert.equal(messages.length, 1);
});
