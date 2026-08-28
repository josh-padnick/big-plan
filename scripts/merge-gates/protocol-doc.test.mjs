// Proves the protocol CONTRIBUTING.md teaches is the protocol the gates accept.
//
// CONTRIBUTING.md is the agent-facing contract for these two checks: an agent
// reads the marker formats there and pastes them into a pull request. Nothing
// else ties those printed formats to the evaluator, so a rename in gates.mjs
// could leave the documentation instructing agents to post a line no gate
// honours - and the failure mode is a green-looking protocol that never goes
// green. These tests take the documented text as input and run the real
// evaluator over it, so the documentation and the rules cannot drift apart.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHECK_NAMES,
  evaluateReviewTriage,
  evaluateValidationAttestation,
} from "./gates.mjs";

const HEAD = "abc1234def5678901234567890abcdef12345678";

const contributing = readFileSync(
  fileURLToPath(new URL("../../CONTRIBUTING.md", import.meta.url)),
  "utf8",
);

/** The part of the guide that owns this protocol, so no other section can answer for it. */
const mergeGatesSection = () => {
  const start = contributing.indexOf("\n## Merge gates\n");
  assert.notEqual(start, -1, "CONTRIBUTING.md has no Merge gates section");
  const rest = contributing.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  return end === -1 ? rest : rest.slice(0, end);
};

const SECTION = mergeGatesSection();

/** Every ```text block the section prints for an agent to copy. */
const copyBlocks = () => {
  const blocks = [];
  const pattern = /^```text\n([\s\S]*?)^```$/gm;
  let match;
  while ((match = pattern.exec(SECTION)) !== null) {
    blocks.push(match[1].trimEnd().split("\n"));
  }
  assert.ok(blocks.length >= 2, "the section prints no copyable formats");
  return blocks;
};

const BLOCKS = copyBlocks();

/** The one documented line that starts with the given marker keyword. */
const documentedLine = (prefix) => {
  const lines = BLOCKS.flat().filter((line) => line.startsWith(prefix));
  assert.equal(
    lines.length,
    1,
    `expected exactly one documented line starting "${prefix}", found ${lines.length}`,
  );
  return lines[0];
};

const fillHead = (line) => line.replace("<head-sha>", HEAD);

const snapshot = (overrides) => ({
  number: 42,
  headSha: HEAD,
  isDraft: false,
  url: "https://github.com/o/r/pull/42",
  commitShas: [HEAD],
  issueComments: [],
  reviews: [],
  reviewThreads: [],
  ...overrides,
});

const comment = (body) => ({
  author: "some-agent",
  body,
  url: "https://github.com/o/r/pull/42#issuecomment-1",
});

/** One CodeRabbit finding with a written reply, so only the sign-off is in question. */
const triagedBotReview = {
  reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
  reviewThreads: [
    {
      isResolved: false,
      isOutdated: false,
      path: "scripts/merge-gates/gates.mjs",
      line: 7,
      url: "https://github.com/o/r/pull/42#discussion_r1",
      comments: [
        {
          author: "coderabbitai[bot]",
          body: "Fail closed when the page limit is hit.",
          isMinimized: false,
          url: "https://github.com/o/r/pull/42#discussion_r1",
        },
        {
          author: "some-agent",
          body: "Fixed in 3fea0ff8.",
          isMinimized: false,
          url: "https://github.com/o/r/pull/42#discussion_r2",
        },
      ],
    },
  ],
};

test("the documented sign-off line signs off", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      ...triagedBotReview,
      issueComments: [
        comment(fillHead(documentedLine("review-triage: complete"))),
      ],
    }),
  );
  assert.equal(verdict.conclusion, "success", verdict.details.join("\n"));
  assert.equal(verdict.name, CHECK_NAMES.reviewTriage);
});

test("the documented summary retraction line retracts the named reviewer", () => {
  const line = documentedLine("review-triage: retract")
    .replace("<reviewer>", "coderabbit")
    .replace("<reason>", "duplicate bot review");
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        comment(fillHead(documentedLine("review-triage: complete"))),
        comment(line),
      ],
      reviews: [
        { author: "coderabbitai[bot]", state: "COMMENTED", body: "summary" },
        { author: "greptile-apps[bot]", state: "COMMENTED", body: "summary" },
      ],
    }),
  );
  assert.equal(verdict.conclusion, "success", verdict.details.join("\n"));
  assert.match(verdict.details.join("\n"), /Reviewer: Greptile/);
});

test("the documented pass attestation attests", () => {
  const line = fillHead(documentedLine("no-mistakes: passed")).replace(
    "<run-id>",
    "18342119275",
  );
  const verdict = evaluateValidationAttestation(
    snapshot({ issueComments: [comment(line)] }),
  );
  assert.equal(verdict.conclusion, "success", verdict.details.join("\n"));
  assert.equal(verdict.name, CHECK_NAMES.validationAttestation);
});

test("the documented override line overrides, and says so", () => {
  const line = documentedLine("no-mistakes: overridden").replace(
    "<reason>",
    "documentation-only branch, nothing for the pipeline to run",
  );
  const verdict = evaluateValidationAttestation(
    snapshot({ issueComments: [comment(line)] }),
  );
  assert.equal(verdict.conclusion, "success", verdict.details.join("\n"));
  assert.match(verdict.title, /OVERRIDDEN/);
});

test("the documented attestation template stands in for a bot review", () => {
  const template = BLOCKS.find((block) =>
    block[0].startsWith("adversarial-review:"),
  );
  assert.ok(template, "the section prints no adversarial-review template");
  const dispositions = template.filter((line) => /^\d+\./.test(line));
  assert.ok(dispositions.length >= 1, "the template lists no disposition line");
  const attestation = [
    fillHead(template[0]).replace("<agent>", "claude-opus-5"),
    documentedLine("findings:").replace("<n>", String(dispositions.length)),
    ...dispositions.map((line, index) =>
      line
        .replace("<finding>", `Finding ${index + 1}`)
        .replace("fixed|declined|deferred", "fixed")
        .replace("<how, or why not>", "fixed in 3fea0ff8"),
    ),
  ].join("\n");

  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        comment(attestation),
        comment(fillHead(documentedLine("review-triage: complete"))),
      ],
    }),
  );
  assert.equal(verdict.conclusion, "success", verdict.details.join("\n"));
});

test("the check names the guide tells a maintainer to require are the published ones", () => {
  const rows = SECTION.split("\n").filter((line) => line.startsWith("| `"));
  const documented = rows.map((row) =>
    row.split("|")[1].trim().replace(/`/g, ""),
  );
  assert.deepEqual(
    [...documented].sort(),
    Object.values(CHECK_NAMES).sort(),
    "the documented required checks are not the checks the gate publishes",
  );
});
