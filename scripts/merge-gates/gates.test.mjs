// Proves the merge gates fail the exact shape of the PR #163 incident - a
// reviewer's inline findings sitting unresolved while the pull request merges -
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

test("an unresolved finding fails the gate and names where it is", () => {
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
  assert.match(report(verdict), /1 finding\(s\) are unresolved/);
  assert.match(report(verdict), /src\/review\/live-target\.browser\.ts:42/);
  assert.match(report(verdict), /Reject non-integer revisions/);
  assert.match(report(verdict), /discussion_r1/);
  assert.match(report(verdict), /Next action: reply in each thread/);
});

test("the reviewer replying to itself does not resolve a finding", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding(), reply("coderabbitai[bot]")])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /unresolved: 1/);
});

test("ticking GitHub's resolve checkbox does not resolve a finding", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding()], { isResolved: true })],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /Ticking GitHub's resolve/);
});

test("hiding a finding does not withdraw it", () => {
  // Anyone with write access can minimize any comment, the author's own agent
  // included, and GitHub does not record who did. A hidden finding therefore
  // still needs the written reply every other finding needs.
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([{ ...finding(), isMinimized: true }])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /Reviewer findings are unresolved/);
  assert.match(report(verdict), /1 finding\(s\) are unresolved/);
});

test("hiding the reply does not resolve the finding either", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
      reviewThreads: [thread([finding(), { ...reply(), isMinimized: true }])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(report(verdict), /unresolved: 1/);
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
  // Both recoveries have to be printed, because dismissing the bot review is
  // only half of dropping a reviewer that left findings.
  assert.match(report(verdict), /CodeRabbit: reply in every thread it opened/);
  assert.match(report(verdict), /then dismiss its review/);
  assert.match(
    report(verdict),
    /keeps counting while any of its inline threads is unresolved/,
  );
  assert.match(
    report(verdict),
    /by claude-opus-5: delete that\n\s+attestation comment/,
  );
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

test("an override with no real reason is refused out loud, not ignored", () => {
  const verdict = evaluateValidationAttestation(
    snapshot({ issueComments: [comment("no-mistakes: overridden - n/a")] }),
  );
  assert.equal(verdict.conclusion, "failure");
  // The agent that posted it has to learn the gate saw it and refused it.
  assert.match(report(verdict), /1 override\(s\) were refused/);
  assert.match(report(verdict), /refused "n\/a" \(3 character\(s\)\)/);
  assert.match(report(verdict), /at least 8 characters/);
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
  const draft = snapshot({ isDraft: true });
  const verdict = evaluateValidationAttestation(draft);
  assert.equal(verdict.conclusion, "failure");
  assert.match(
    formatVerdict(verdict, draft),
    /This pull request is a draft\. A red gate is expected here mid-flow/,
  );

  const ready = snapshot();
  assert.doesNotMatch(
    formatVerdict(evaluateValidationAttestation(ready), ready),
    /is a draft/,
  );

  const passing = snapshot({
    isDraft: true,
    issueComments: [comment(`no-mistakes: passed run 918a82 head ${HEAD}`)],
  });
  assert.doesNotMatch(
    formatVerdict(evaluateValidationAttestation(passing), passing),
    /is a draft/,
  );
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

test("a dismissed review with no findings left behind is not a review", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "DISMISSED", body: "" }],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /No accepted review/);
});

test("dismissing a review does not drop findings that are still unresolved", () => {
  // The recovery printed for two accepted reviews is "resolve, then dismiss".
  // Dismissing first must therefore leave the reviewer counted, or the gate
  // would forget findings nobody resolved - the PR #163 shape exactly.
  const dismissed = {
    issueComments: [signOff],
    reviews: [{ author: "coderabbitai[bot]", state: "DISMISSED", body: "" }],
  };
  const unresolved = evaluateReviewTriage(
    snapshot({ ...dismissed, reviewThreads: [thread([finding()])] }),
  );
  assert.equal(unresolved.conclusion, "failure");
  assert.match(unresolved.title, /Reviewer findings are unresolved/);
  assert.match(report(unresolved), /Reviewer: CodeRabbit/);

  const resolved = evaluateReviewTriage(
    snapshot({ ...dismissed, reviewThreads: [thread([finding(), reply()])] }),
  );
  assert.equal(resolved.conclusion, "failure");
  assert.match(resolved.title, /No accepted review/);
});

test("a dismissed reviewer that only replied to itself still counts", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [signOff],
      reviews: [{ author: "coderabbitai[bot]", state: "DISMISSED", body: "" }],
      reviewThreads: [thread([finding(), reply("coderabbitai[bot]")])],
    }),
  );
  assert.equal(verdict.conclusion, "failure");
  assert.match(verdict.title, /Reviewer findings are unresolved/);
});

test("unresolved threads from other authors are reported under an attestation too", () => {
  const verdict = evaluateReviewTriage(
    snapshot({
      issueComments: [
        comment(
          `adversarial-review: complete ${OLD} by claude-opus-5\nfindings: 1\n1. Race on replay - resolved: fixed - guarded`,
        ),
        signOff,
      ],
      reviewThreads: [
        thread([{ ...finding("Widen the lock."), author: "a-human" }]),
      ],
    }),
  );
  // Informational only: the gate still passes, but the threads are named.
  assert.equal(verdict.conclusion, "success");
  assert.match(
    report(verdict),
    /For information only, not gating: 1 unresolved inline thread\(s\) from other authors/,
  );
  assert.match(report(verdict), /by a-human/);
});

test("a marker hidden in an HTML comment satisfies nothing", () => {
  // Shaped like a real reviewer comment: visible prose, then a hidden
  // bookkeeping block that quotes context from an earlier comment. A human
  // reading the pull request sees no sign-off and no attestation here.
  const bookkeeping = [
    "Looks good to me.",
    "",
    "<!-- coderabbitai-context",
    `review-triage: complete ${HEAD}`,
    `no-mistakes: passed run 918a82 head ${HEAD}`,
    "-->",
    "",
    `<!-- adversarial-review: complete ${HEAD} by claude-opus-5 -->`,
    "<!-- findings: 0 -->",
  ].join("\n");
  const hidden = {
    issueComments: [comment(bookkeeping)],
    reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
    reviewThreads: [thread([finding(), reply()])],
  };
  const triage = evaluateReviewTriage(snapshot(hidden));
  assert.equal(triage.conclusion, "failure");
  assert.match(triage.title, /Sign-off missing/);
  assert.equal(
    evaluateValidationAttestation(snapshot(hidden)).conclusion,
    "failure",
  );

  // The same lines, posted where a reader can see them, do satisfy the gates.
  const visible = {
    ...hidden,
    issueComments: [
      comment(
        `Looks good to me.\n\nreview-triage: complete ${HEAD}\nno-mistakes: passed run 918a82 head ${HEAD}`,
      ),
    ],
  };
  assert.equal(evaluateReviewTriage(snapshot(visible)).conclusion, "success");
  assert.equal(
    evaluateValidationAttestation(snapshot(visible)).conclusion,
    "success",
  );
});

test("a marker Markdown pulls into the quote above it asserts nothing", () => {
  // CommonMark continues a blockquote lazily: a plain line directly under a
  // quoted one belongs to that quote, and GitHub renders it inside the quote
  // box. A sign-off a reader sees quoted is not a sign-off.
  const triaged = {
    reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
    reviewThreads: [thread([finding(), reply()])],
  };
  const lazily = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [
        comment(`> Are we done?\nreview-triage: complete ${HEAD}`),
      ],
    }),
  );
  assert.equal(lazily.conclusion, "failure");
  assert.match(lazily.title, /Sign-off missing/);

  // A blank line ends the quote, so the same marker below one does assert.
  const separated = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [
        comment(`> Are we done?\n\nreview-triage: complete ${HEAD}`),
      ],
    }),
  );
  assert.equal(separated.conclusion, "success");

  assert.deepEqual(assertedLines("> quoted\nlazy\n\nplain"), ["plain"]);
});

test("a fence GitHub still considers open keeps suppressing markers", () => {
  // CommonMark closes a fence only on the same marker, at least as long, with
  // nothing after it but spaces. A line that fails that leaves the fence open,
  // so GitHub renders everything below it as code and the gate must agree.
  const triaged = {
    reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
    reviewThreads: [thread([finding(), reply()])],
  };
  const trailingText = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [
        comment(`\`\`\`\ncode\n\`\`\` (end)\nreview-triage: complete ${HEAD}`),
      ],
    }),
  );
  assert.equal(trailingText.conclusion, "failure");
  assert.match(trailingText.title, /Sign-off missing/);

  const mismatchedMarker = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [
        comment(`\`\`\`\ncode\n~~~\nreview-triage: complete ${HEAD}`),
      ],
    }),
  );
  assert.equal(mismatchedMarker.conclusion, "failure");
  assert.match(mismatchedMarker.title, /Sign-off missing/);

  // A shorter run does not close a longer fence either.
  assert.deepEqual(assertedLines("````\ncode\n```\nkeep out"), []);
  // The valid closes still work, including a longer run and a tilde fence.
  assert.deepEqual(assertedLines("```\ncode\n```\nkeep"), ["keep"]);
  assert.deepEqual(assertedLines("~~~\ncode\n~~~~\nkeep"), ["keep"]);
  assert.deepEqual(assertedLines("```js\ncode\n```  \nkeep"), ["keep"]);
});

test("an HTML comment cannot un-quote or un-indent the line it closes on", () => {
  // A span that closes at the start of a line must not eat that line's
  // blockquote marker or its indentation: the line is still quoted or still
  // indented, so the marker on it is still not an assertion.
  const triaged = {
    reviews: [{ author: "coderabbitai[bot]", state: "COMMENTED", body: "" }],
    reviewThreads: [thread([finding(), reply()])],
  };
  const quoted = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [
        comment(
          `> <!--\n> quoted metadata\n> --> review-triage: complete ${HEAD}`,
        ),
      ],
    }),
  );
  assert.equal(quoted.conclusion, "failure");
  assert.match(quoted.title, /Sign-off missing/);

  const indented = evaluateReviewTriage(
    snapshot({
      ...triaged,
      issueComments: [
        comment(`<!-- note\n    --> review-triage: complete ${HEAD}`),
      ],
    }),
  );
  assert.equal(indented.conclusion, "failure");
  assert.match(indented.title, /Sign-off missing/);

  assert.deepEqual(
    assertedLines(`> <!--\n> hidden\n> --> review-triage: complete ${HEAD}`),
    [],
  );
});

test("shaNames accepts an unambiguous prefix and rejects a wrong one", () => {
  assert.equal(shaNames(HEAD.slice(0, 7), HEAD), true);
  assert.equal(shaNames(HEAD.toUpperCase(), HEAD), true);
  assert.equal(shaNames(HEAD.slice(0, 6), HEAD), false);
  assert.equal(shaNames(OLD, HEAD), false);
  assert.equal(shaNames("not-a-sha", HEAD), false);
});

test("assertedLines drops fenced, quoted, and indented text", () => {
  // Each suppressed shape is separated by a blank line, because a line that
  // follows a quoted one without one is part of that quote.
  assert.deepEqual(
    assertedLines(
      "keep\n```\nfenced\n```\n> quoted\n\n    indented\n\n\ttabbed\n\nkeep2",
    ),
    ["keep", "keep2"],
  );
});

test("assertedLines keeps only what a reader can see of an HTML comment", () => {
  assert.deepEqual(assertedLines("before <!-- hidden --> after"), [
    "before  after",
  ]);
  assert.deepEqual(
    assertedLines("keep\n<!--\nhidden\nstill hidden\n-->\nkeep2"),
    ["keep", "keep2"],
  );
  assert.deepEqual(assertedLines("<!-- a --> mid <!-- b --> end"), [
    " mid  end",
  ]);
  // An unclosed span hides the rest of the comment, which fails closed.
  assert.deepEqual(assertedLines("keep\n<!-- open\nreview-triage: complete"), [
    "keep",
  ]);
});
