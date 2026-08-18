// Proves the merge gates fail the exact shape of the PR #163 incident - a
// reviewer's inline findings sitting unanswered while the pull request merges -
// and that the ways an agent might accidentally look compliant do not work: a
// reviewer replying to itself, a thread resolved without a word, a sign-off left
// behind by a later push, a marker pasted inside a code fence. The passing cases
// hold the other side: an ordinary triaged pull request must go green on a
// comment alone, with no push.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertedLines,
  evaluateReviewTriage,
  evaluateValidationAttestation,
  formatVerdict,
  shaNames,
} from "./gates.mjs";

const HEAD = "abc1234def5678901234567890abcdef12345678";
const OLD = "0000111122223333444455556666777788889999";

/** A snapshot with nothing on it, which every case narrows. */
const snapshot = (overrides = {}) => ({
  number: 42,
  headSha: HEAD,
  isDraft: false,
  url: "https://github.com/o/r/pull/42",
  commitShas: [OLD, HEAD],
  issueComments: [],
  reviews: [],
  reviewThreads: [],
  ...overrides,
});

const comment = (body, author = "josh-padnick") => ({
  author,
  body,
  url: "https://github.com/o/r/pull/42#issuecomment-1",
});

const thread = (comments, extra = {}) => ({
  isResolved: false,
  isOutdated: false,
  path: "src/review/live-target.browser.ts",
  line: 42,
  url: "https://github.com/o/r/pull/42#discussion_r1",
  comments,
  ...extra,
});

const finding = (
  body = "Guard the refusal path so a failed read cannot pass.",
) => ({
  author: "coderabbitai[bot]",
  body,
  isMinimized: false,
  url: "https://github.com/o/r/pull/42#discussion_r1",
});

const reply = (author = "josh-padnick") => ({
  author,
  body: "Fixed in 3fea0ff8.",
  isMinimized: false,
  url: "https://github.com/o/r/pull/42#discussion_r2",
});

const signOff = comment(`review-triage: complete ${HEAD}`);

const report = (verdict) => verdict.details.join("\n");

test("a pull request with no review names the two ways to get one", () => {
  const verdict = evaluateReviewTriage(snapshot({ issueComments: [signOff] }));
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /No accepted review/);
  assert.match(report(verdict), /CodeRabbit, Greptile, Devin/);
  assert.match(report(verdict), /adversarial-review: complete/);
});

test("a triaged review with a matching sign-off passes", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding(), reply()])],
    }),
  );
  assert.equal(verdict.conclusion, "success");
  assert.match(verdict.title, /signed off/);
});

test("an unanswered finding fails the gate and names where it is", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [
        thread([finding(), reply()]),
        thread([finding("Reject non-integer revisions.")]),
      ],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /1 finding\(s\) have no response/);
  assert.match(report(verdict), /src\/review\/live-target\.browser\.ts:42/);
  assert.match(report(verdict), /Reject non-integer revisions/);
  assert.match(report(verdict), /discussion_r1/);
  assert.match(report(verdict), /Next action: reply in each thread/);
});

test("the reviewer answering itself is not a response", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding(), reply("coderabbitai[bot]")])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /unanswered: 1/);
});

test("resolving a thread without replying is not a response", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding()], { isResolved: true })],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /Resolving a thread without a/);
});

test("a finding the reviewer withdrew does not gate", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([{ ...finding(), isMinimized: true }])],
    }),
  );
  assert.equal(verdict.conclusion, "success");
});

test("a push invalidates the sign-off until it is written again", () => {
  const triaged = {
    reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
    reviewThreads: [thread([finding(), reply()])],
  };
  const stale = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [comment(`review-triage: complete ${OLD}`)],
    }),
  );
  assert.equal(stale.conclusion, "failure");
  assert.match(stale.title, /Sign-off missing/);
  assert.match(report(stale), new RegExp(`review-triage: complete ${HEAD}`));

  const resigned = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [comment(`review-triage: complete ${HEAD.slice(0, 9)}`)],
    }),
  );
  assert.equal(resigned.conclusion, "success");
});

test("a sign-off inside a code fence or a quote does not count", () => {
  const quoted = `Post this when you are done:\n\n\`\`\`\nreview-triage: complete ${HEAD}\n\`\`\`\n\n> review-triage: complete ${HEAD}\n`;
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [comment(quoted)],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding(), reply()])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /Sign-off missing/);
});

test("two accepted reviews fail, because the budget is one", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        signOff,
        comment(
          `adversarial-review: complete ${HEAD} by claude-opus-5\nfindings: 1\n1. Race on replay - resolved: fixed - guarded in ${HEAD.slice(0, 8)}`,
        ),
      ],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding(), reply()])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /2 accepted reviews/);
  assert.match(report(verdict), /Delete the adversarial-review/);
});

test("an adversarial attestation stands in for a bot review", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        comment(
          `adversarial-review: complete ${OLD} by claude-opus-5\nfindings: 2\n1. Race on replay - resolved: fixed - guarded\n2. Naming - resolved: declined - the name matches the module`,
        ),
        signOff,
      ],
    }),
  );
  assert.equal(verdict.conclusion, "success");
  assert.match(report(verdict), /adversarial review/);
});

test("an attestation over a commit that is not on this pull request is ignored", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        comment(
          `adversarial-review: complete deadbeefdeadbeef by claude-opus-5\nfindings: 0`,
        ),
        signOff,
      ],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /not a commit on this pull request/);
});

test("an attestation that lists fewer dispositions than findings is ignored", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        comment(
          `adversarial-review: complete ${HEAD} by claude-opus-5\nfindings: 3\n1. One - resolved: fixed - done`,
        ),
        signOff,
      ],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /claims 3 finding\(s\) but carries 1 line/);
});

test("validation passes only when the attestation names this head", () => {
  const passing = evaluateValidationAttestation(
    snapshot({
      issueComments: [comment(`no-mistakes: passed run 918a82 head ${HEAD}`)],
    }),
  );
  assert.equal(passing.conclusion, "success");
  assert.match(passing.title, /passed on abc1234d/);

  const stale = evaluateValidationAttestation(
    snapshot({
      issueComments: [comment(`no-mistakes: passed run 918a82 head ${OLD}`)],
    }),
  );
  assert.equal(stale.conclusion, "failure");
  assert.match(report(stale), /a push has left them behind/);
  assert.match(report(stale), /names 00001111/);
});

test("a missing attestation prints both formats to post", () => {
  const verdict = evaluateValidationAttestation(snapshot());
  assert.equal(verdict.conclusion, "failure");
  assert.match(
    report(verdict),
    new RegExp(`no-mistakes: passed run <run-id> head ${HEAD}`),
  );
  assert.match(report(verdict), /no-mistakes: overridden - <reason>/);
});

test("an override passes, and says so loudly", () => {
  const verdict = evaluateValidationAttestation(
    snapshot({
      issueComments: [
        comment(
          "no-mistakes: overridden - docs-only change, no code path runs",
        ),
      ],
    }),
  );
  assert.equal(verdict.conclusion, "success");
  assert.match(verdict.title, /OVERRIDDEN/);
  assert.match(report(verdict), /docs-only change/);
});

test("an override with no real reason does not pass", () => {
  const verdict = evaluateValidationAttestation(
    snapshot({ issueComments: [comment("no-mistakes: overridden - n/a")] }),
  );
  assert.equal(verdict.conclusion, "failure");
});

test("an override scoped to an older head does not carry to this one", () => {
  const verdict = evaluateValidationAttestation(
    snapshot({
      issueComments: [
        comment(`no-mistakes: overridden - generated assets only head ${OLD}`),
      ],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /names 00001111/);
});

test("a draft pull request still gets judged, with the mid-flow red explained", () => {
  const verdict = evaluateValidationAttestation(snapshot({ isDraft: true }));
  assert.equal(verdict.conclusion, "failure");
});

test("pasting a failure report back does not satisfy the gate that printed it", () => {
  // The reports indent the markers to post by four spaces, with the real head
  // sha already filled in. Pasting one back as a comment must change nothing.
  const triaged = {
    reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
    reviewThreads: [thread([finding(), reply()])],
  };
  const printed = [
    formatVerdict(evaluateReviewTriage(snapshot(triaged)), snapshot(triaged)),
    formatVerdict(evaluateValidationAttestation(snapshot()), snapshot()),
  ].join("\n\n");
  const pasted = { issueComments: [comment(printed)] };
  assert.equal(
    evaluateReviewTriage(snapshot({ ...triaged, ...pasted })).conclusion,
    "failure",
  );
  assert.equal(
    evaluateValidationAttestation(snapshot(pasted)).conclusion,
    "failure",
  );
});

test("a dismissed review is not a review", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "DISMISSED", body: "" }],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /No accepted review/);
});

test("shaNames accepts an unambiguous prefix and rejects a wrong one", () => {
  assert.equal(shaNames(HEAD.slice(0, 7), HEAD), true);
  assert.equal(shaNames(HEAD.toUpperCase(), HEAD), true);
  assert.equal(shaNames(HEAD.slice(0, 6), HEAD), false);
  assert.equal(shaNames(OLD, HEAD), false);
  assert.equal(shaNames("not-a-sha", HEAD), false);
});

test("assertedLines drops fenced, quoted, and indented text", () => {
  assert.deepEqual(
    assertedLines(
      "keep\n```\nfenced\n```\n> quoted\n    indented\n\ttabbed\nkeep2",
    ),
    ["keep", "keep2"],
  );
});
