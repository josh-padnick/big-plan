// Decides the two merge gates the captain ratified on 2026-08-18 (BIG-164),
// after PR #163 merged with seven reviewer findings that nobody had answered.
// The lesson of that incident is that a convention nobody can forget to follow
// is worth more than a convention everybody agrees with: both gates are
// therefore statements a machine can check, not manners.
//
// Gate 1, review-triage, passes when all three hold:
//   a. Exactly one accepted third-party review exists on the pull request.
//      Accepted means one of the reviewer bots below, or one structured
//      adversarial-review attestation from our own agent when reviewer credits
//      are gone. Exactly one, because BIG-143 buys one review per pull request;
//      two reviews mean one of them was never paid for or never triaged.
//   b. Every inline finding that reviewer raised has a written reply from
//      somebody else. A reply, not a resolved checkbox: silently resolving a
//      thread is the exact shape of the incident this gate exists to stop.
//   c. A sign-off comment names the CURRENT head. Any push moves the head and
//      invalidates the sign-off, including a push that only fixes lint, because
//      a reviewer's findings were raised against code that no longer exists.
//
// Gate 2, validation-attestation, passes when the pull request carries either a
// no-mistakes pass naming the current head, or an explicit override with a
// reason. The pipeline runs on a laptop, so CI cannot rerun it; it can only
// insist that completion or non-completion is stated out loud and attributable.
//
// This module is pure: it takes a snapshot of the pull request and returns a
// verdict. github.mjs fetches the snapshot and publishes the verdict, and
// check.mjs joins the two. Keeping the judgment pure is what lets gates.test.mjs
// cover the failure shapes without a network or a repository.
//
// Every failure names the next action, because the reader of a red gate is
// usually an agent with no other source of instruction. A gate that only says
// "failed" makes that agent guess, and guessing is how the incident happened.
//
// CONTRIBUTING.md owns the contributor-facing protocol and the comment formats.

/**
 * Third-party reviewers whose review satisfies gate 1(a).
 *
 * Logins are matched case-insensitively, and each reviewer lists its aliases
 * because a GitHub App's bot login is not stable across installations. Adding a
 * reviewer is a one-line change here; the gate is deliberately reviewer-agnostic
 * so BIG-143's credit-based picker can choose between them without touching it.
 */
export const REVIEW_BOTS = [
  {
    id: "coderabbit",
    label: "CodeRabbit",
    logins: ["coderabbitai[bot]", "coderabbitai"],
  },
  {
    id: "greptile",
    label: "Greptile",
    logins: ["greptile-apps[bot]", "greptileai[bot]", "greptile[bot]"],
  },
  {
    id: "devin",
    label: "Devin",
    logins: ["devin-ai-integration[bot]", "devin[bot]"],
  },
];

/** The identity an adversarial-review attestation reviews under. */
export const ADVERSARIAL_REVIEWER = {
  id: "adversarial",
  label: "adversarial review (our own agent)",
};

/** The marker lines an agent posts. CONTRIBUTING.md documents each one. */
export const MARKERS = {
  signOff: "review-triage: complete <head-sha>",
  adversarial: "adversarial-review: complete <head-sha> by <agent>",
  validationPassed: "no-mistakes: passed run <run-id> head <head-sha>",
  validationOverride: "no-mistakes: overridden - <reason>",
};

/** Names of the two check runs. Branch protection requires these exact strings. */
export const CHECK_NAMES = {
  reviewTriage: "review-triage",
  validationAttestation: "validation-attestation",
};

const SHORT_SHA = 8;

/** An override reason shorter than this is not a reason, it is a shrug. */
const MIN_OVERRIDE_REASON = 8;

const short = (sha) => (sha ?? "").slice(0, SHORT_SHA);

const lower = (value) => (value ?? "").toLowerCase();

/**
 * True when an authored sha names the given commit. Authors write short shas by
 * hand, so a prefix of seven or more hex digits counts, which is the length git
 * itself considers unambiguous.
 */
export const shaNames = (authored, commit) => {
  const candidate = lower(authored);
  if (!/^[0-9a-f]{7,40}$/.test(candidate)) {
    return false;
  }
  return lower(commit).startsWith(candidate);
};

/**
 * Strips the parts of a comment that quote rather than assert: fenced code
 * blocks and blockquoted lines. Documentation of a marker, a reply quoting an
 * earlier comment, and an agent pasting an example must not satisfy a gate, so
 * only a plain top-level line counts as a statement the author is making.
 */
export const assertedLines = (body) => {
  const lines = (body ?? "").split(/\r?\n/);
  const asserted = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*>/.test(line)) {
      continue;
    }
    asserted.push(line);
  }
  return asserted;
};

/** Finds every asserted line in a comment that matches a marker pattern. */
const matchMarker = (comment, pattern) =>
  assertedLines(comment.body)
    .map((line) => pattern.exec(line))
    .filter((match) => match !== null);

// Marker patterns. Each anchors at the start of an asserted line so a marker
// mentioned mid-sentence does not count, and each tolerates the unicode dashes
// an editor may substitute for a plain hyphen.
const SIGN_OFF = /^\s*review-triage:\s*complete\s+([0-9a-f]{7,40})\s*$/i;
const ADVERSARIAL =
  /^\s*adversarial-review:\s*complete\s+([0-9a-f]{7,40})\s+by\s+(\S.*?)\s*$/i;
const FINDINGS_COUNT = /^\s*findings:\s*(\d+)\s*$/i;
const DISPOSITION = /\bresolved:\s*(fixed|declined|deferred)\b/i;
const VALIDATION_PASSED =
  /^\s*no-mistakes:\s*passed\s+run\s+(\S+)\s+head\s+([0-9a-f]{7,40})\s*$/i;
const VALIDATION_OVERRIDE =
  /^\s*no-mistakes:\s*overridden\s*[-–—]\s*(\S.*?)\s*$/i;
const OVERRIDE_HEAD = /\s+head\s+([0-9a-f]{7,40})\s*$/i;

/** Resolves a login to the accepted reviewer it belongs to, or null. */
const botFor = (login) =>
  REVIEW_BOTS.find((bot) =>
    bot.logins.some((alias) => lower(alias) === lower(login)),
  ) ?? null;

/**
 * Collects the adversarial-review attestations the pull request carries, newest
 * last, each with the reason it is or is not usable.
 *
 * An attestation stands in for a bot review, so it has to carry what a bot
 * review carries: the commit it read, who read it, and what it found. The sha
 * must belong to this pull request - not necessarily the head, because a bot
 * review is not re-run on every push either - and every finding it counts must
 * carry a disposition, so a reader can see that the findings were resolved
 * rather than merely listed.
 */
export const collectAttestations = (snapshot) => {
  const attestations = [];
  for (const comment of snapshot.issueComments) {
    for (const match of matchMarker(comment, ADVERSARIAL)) {
      const [, sha, agent] = match;
      const lines = assertedLines(comment.body);
      const countLine = lines
        .map((line) => FINDINGS_COUNT.exec(line))
        .find(Boolean);
      const dispositions = lines.filter((line) =>
        DISPOSITION.test(line),
      ).length;
      const reviewedCommit =
        snapshot.commitShas.find((commit) => shaNames(sha, commit)) ?? null;
      const problems = [];
      if (reviewedCommit === null) {
        problems.push(
          `it names commit ${sha}, which is not a commit on this pull request`,
        );
      }
      if (countLine === undefined) {
        problems.push(`it has no "findings: <n>" line`);
      } else if (dispositions < Number(countLine[1])) {
        problems.push(
          `it claims ${countLine[1]} finding(s) but carries ${dispositions} line(s) with "resolved: fixed|declined|deferred"`,
        );
      }
      attestations.push({
        agent,
        sha,
        reviewedCommit,
        findings: countLine === undefined ? null : Number(countLine[1]),
        url: comment.url,
        author: comment.author,
        problems,
      });
    }
  }
  return attestations;
};

/**
 * Identifies which accepted reviews exist. A bot counts once it has either
 * submitted a review or opened an inline thread; an attestation counts once it
 * is well-formed. All attestations collapse into one identity because they all
 * stand for the same thing, our own agent reviewing in a bot's place.
 */
export const identifyReviews = (snapshot) => {
  const byBot = new Map();
  for (const review of snapshot.reviews) {
    const bot = botFor(review.author);
    if (bot !== null) {
      byBot.set(bot.id, bot);
    }
  }
  for (const thread of snapshot.reviewThreads) {
    const bot = botFor(thread.comments[0]?.author);
    if (bot !== null) {
      byBot.set(bot.id, bot);
    }
  }
  const attestations = collectAttestations(snapshot);
  const usable = attestations.filter((one) => one.problems.length === 0);
  const accepted = [...byBot.values()].map((bot) => ({ kind: "bot", bot }));
  if (usable.length > 0) {
    accepted.push({
      kind: "adversarial",
      bot: ADVERSARIAL_REVIEWER,
      attestation: usable[usable.length - 1],
    });
  }
  return {
    accepted,
    attestations,
    rejected: attestations.filter((one) => one.problems.length > 0),
  };
};

/**
 * Splits a bot reviewer's inline threads into triaged and untriaged.
 *
 * A thread is triaged when somebody other than the reviewer replied in it. The
 * reviewer answering itself is not triage, and GitHub's resolved flag is not
 * triage either: resolving without replying leaves no record of what was done,
 * which is what made the PR #163 findings invisible. Threads the reviewer
 * minimized are skipped, because a hidden comment is one the reviewer withdrew.
 */
export const triageThreads = (snapshot, reviewerLogins) => {
  const isReviewer = (login) =>
    reviewerLogins.some((alias) => lower(alias) === lower(login));
  const own = snapshot.reviewThreads.filter((thread) => {
    const root = thread.comments[0];
    return (
      root !== undefined && isReviewer(root.author) && root.isMinimized !== true
    );
  });
  const answered = [];
  const unanswered = [];
  for (const thread of own) {
    const reply = thread.comments
      .slice(1)
      .find(
        (comment) =>
          !isReviewer(comment.author) && comment.isMinimized !== true,
      );
    (reply === undefined ? unanswered : answered).push({ ...thread, reply });
  }
  const foreign = snapshot.reviewThreads.filter(
    (thread) =>
      thread.comments[0] !== undefined &&
      !isReviewer(thread.comments[0].author) &&
      thread.comments.length === 1 &&
      thread.isResolved !== true,
  );
  return { threads: own, answered, unanswered, foreign };
};

/** Where an inline thread sits, for a reader who has to go answer it. */
const locate = (thread) => {
  const line = thread.line ?? thread.originalLine;
  return line === null || line === undefined
    ? thread.path
    : `${thread.path}:${line}`;
};

/** The first sentence of a finding, so the report identifies it without quoting it whole. */
const gist = (thread) => {
  const body = thread.comments[0]?.body ?? "";
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

/** Builds one gate verdict. `details` is written to both the log and the check run. */
const verdict = (name, conclusion, title, details) => ({
  name,
  conclusion,
  title,
  details,
});

/**
 * Gate 1. Requires exactly one accepted review, a written response to each of
 * its inline findings, and a sign-off naming the current head.
 */
export const evaluateReviewTriage = (snapshot) => {
  const head = short(snapshot.headSha);
  const { accepted, rejected } = identifyReviews(snapshot);
  const notes = rejected.map(
    (one) =>
      `Ignored an adversarial-review attestation by ${one.agent} (${one.url}): ${one.problems.join("; ")}.`,
  );

  if (accepted.length === 0) {
    return verdict(
      CHECK_NAMES.reviewTriage,
      "failure",
      "No accepted review on this pull request",
      [
        "No accepted third-party review was found.",
        "",
        `Looked for a review by ${REVIEW_BOTS.map((bot) => bot.label).join(", ")}, and for an adversarial-review attestation comment.`,
        ...notes,
        "",
        "Next action: get one review. Either request one of the reviewers above,",
        "or, when reviewer credits are gone, run the adversarial review yourself and",
        "post one comment on the pull request in this exact shape:",
        "",
        `    ${MARKERS.adversarial}`,
        "    findings: <n>",
        "    1. <finding> - resolved: fixed|declined|deferred - <how, or why not>",
        "",
        "The sha must be a commit on this pull request, and every counted finding",
        "needs its own disposition line.",
      ],
    );
  }

  if (accepted.length > 1) {
    return verdict(
      CHECK_NAMES.reviewTriage,
      "failure",
      `${accepted.length} accepted reviews; exactly one is allowed`,
      [
        `This pull request carries ${accepted.length} accepted reviews:`,
        ...accepted.map((one) => `  - ${one.bot.label}`),
        "",
        "One review per pull request is the budget (BIG-143), and two reviews mean",
        "one of them was never triaged.",
        "",
        "Next action: keep one and retract the other. Delete the adversarial-review",
        "attestation comment if the bot already reviewed, or dismiss the surplus bot",
        "review. This check re-runs on its own when the comment goes away.",
        ...notes,
      ],
    );
  }

  const [review] = accepted;
  const signOff = snapshot.issueComments
    .flatMap((comment) =>
      matchMarker(comment, SIGN_OFF).map((match) => ({
        comment,
        sha: match[1],
      })),
    )
    .find((one) => shaNames(one.sha, snapshot.headSha));

  const findingLines = [];
  let findingsOk = true;

  if (review.kind === "bot") {
    const { threads, answered, unanswered, foreign } = triageThreads(
      snapshot,
      review.bot.logins,
    );
    findingLines.push(
      `Reviewer: ${review.bot.label}. Inline findings: ${threads.length}, answered: ${answered.length}, unanswered: ${unanswered.length}.`,
    );
    if (unanswered.length > 0) {
      findingsOk = false;
      findingLines.push(
        "",
        `${unanswered.length} finding(s) have no response:`,
      );
      for (const thread of unanswered) {
        findingLines.push(`  - ${locate(thread)}`);
        findingLines.push(`      ${gist(thread)}`);
        findingLines.push(`      ${thread.url}`);
      }
      findingLines.push(
        "",
        "Next action: reply in each thread above saying what you did - the commit",
        "that fixes it, or the reason you decline it. Resolving a thread without a",
        "reply does not count; the written response is the record.",
      );
    }
    if (foreign.length > 0) {
      findingLines.push(
        "",
        `For information only, not gating: ${foreign.length} unanswered inline thread(s) from other authors.`,
        ...foreign.map(
          (thread) =>
            `  - ${locate(thread)} by ${thread.comments[0].author}: ${thread.url}`,
        ),
      );
    }
  } else {
    const { attestation } = review;
    findingLines.push(
      `Reviewer: ${ADVERSARIAL_REVIEWER.label} by ${attestation.agent}, over commit ${short(attestation.reviewedCommit)}.`,
      `Findings declared: ${attestation.findings}, each with a disposition. ${attestation.url}`,
    );
  }

  if (findingsOk && signOff !== undefined) {
    return verdict(
      CHECK_NAMES.reviewTriage,
      "success",
      `Triage signed off for ${head}`,
      [
        ...findingLines,
        "",
        `Sign-off: ${signOff.comment.author} signed off on head ${head}. ${signOff.comment.url}`,
        ...notes,
      ],
    );
  }

  const missingSignOff = [
    "",
    `Sign-off: missing for head ${head}.`,
    "",
    "Next action: once every finding has a response, post this as a plain line in a",
    "new comment on the pull request (not inside a code fence, not quoted):",
    "",
    `    review-triage: complete ${snapshot.headSha}`,
    "",
    "Any later push moves the head and invalidates the sign-off, so sign off last.",
  ];

  return verdict(
    CHECK_NAMES.reviewTriage,
    "failure",
    findingsOk
      ? `Sign-off missing for head ${head}`
      : "Reviewer findings have no response",
    [
      ...findingLines,
      ...(signOff === undefined
        ? missingSignOff
        : ["", `Sign-off: present for head ${head}.`]),
      ...notes,
    ],
  );
};

/**
 * Gate 2. Requires the pull request to state, out loud, either that the
 * no-mistakes pipeline passed on this head or that it was deliberately skipped.
 *
 * A pass is head-scoped by construction: the attestation names the commit that
 * was validated, so a later push leaves it behind. An override is not, because
 * the ratified format carries no sha; a scoped override may add a trailing
 * `head <sha>`, and then the gate holds it to that head.
 */
export const evaluateValidationAttestation = (snapshot) => {
  const head = short(snapshot.headSha);
  const passes = [];
  const overrides = [];
  const staleShas = [];
  for (const comment of snapshot.issueComments) {
    for (const [, runId, sha] of matchMarker(comment, VALIDATION_PASSED)) {
      if (shaNames(sha, snapshot.headSha)) {
        passes.push({ comment, runId });
      } else {
        staleShas.push({ comment, runId, sha });
      }
    }
    for (const [, rest] of matchMarker(comment, VALIDATION_OVERRIDE)) {
      const scoped = OVERRIDE_HEAD.exec(rest);
      const reason =
        scoped === null ? rest : rest.slice(0, scoped.index).trim();
      if (scoped !== null && !shaNames(scoped[1], snapshot.headSha)) {
        staleShas.push({ comment, runId: "override", sha: scoped[1] });
        continue;
      }
      if (reason.length >= MIN_OVERRIDE_REASON) {
        overrides.push({ comment, reason });
      }
    }
  }

  if (passes.length > 0) {
    const pass = passes[passes.length - 1];
    return verdict(
      CHECK_NAMES.validationAttestation,
      "success",
      `no-mistakes passed on ${head}`,
      [
        `no-mistakes run ${pass.runId} is attested against head ${head}.`,
        `Attested by ${pass.comment.author}. ${pass.comment.url}`,
        "",
        "CI checks that the attestation exists and names this head. The pipeline runs",
        "locally, so this is a statement on the record, not a re-run.",
      ],
    );
  }

  if (overrides.length > 0) {
    const override = overrides[overrides.length - 1];
    return verdict(
      CHECK_NAMES.validationAttestation,
      "success",
      "OVERRIDDEN - validation was deliberately skipped",
      [
        "This pull request did not run the no-mistakes pipeline. The omission is",
        "declared, not silent:",
        "",
        `  reason:      ${override.reason}`,
        `  declared by: ${override.comment.author}`,
        `  comment:     ${override.comment.url}`,
        "",
        "An override without a head stays in force for the whole pull request. Add a",
        `trailing "head ${snapshot.headSha}" to scope it to this commit instead.`,
      ],
    );
  }

  return verdict(
    CHECK_NAMES.validationAttestation,
    "failure",
    `No validation attestation for head ${head}`,
    [
      `Nothing on this pull request attests validation of head ${head}.`,
      ...(staleShas.length > 0
        ? [
            "",
            `${staleShas.length} attestation(s) name a different commit, so a push has left them behind:`,
            ...staleShas.map(
              (one) =>
                `  - names ${short(one.sha)}, head is ${head}: ${one.comment.url}`,
            ),
          ]
        : []),
      "",
      "Next action: run the pipeline, then post its result as a plain line in a new",
      "comment on the pull request:",
      "",
      `    no-mistakes: passed run <run-id> head ${snapshot.headSha}`,
      "",
      "If the pipeline legitimately does not apply to this pull request, say so",
      "instead, with a reason a reader can weigh:",
      "",
      `    ${MARKERS.validationOverride}`,
    ],
  );
};

/** Runs both gates over one snapshot. */
export const evaluateMergeGates = (snapshot) => [
  evaluateReviewTriage(snapshot),
  evaluateValidationAttestation(snapshot),
];

/** Renders one gate verdict for the workflow log and for the check run body. */
export const formatVerdict = (verdictToFormat, snapshot) => {
  const status = verdictToFormat.conclusion === "success" ? "PASSED" : "FAILED";
  const lines = [
    `${verdictToFormat.name}: ${status} - ${verdictToFormat.title}`,
    `pull request #${snapshot.number}, head ${snapshot.headSha}`,
    "",
    ...verdictToFormat.details,
  ];
  if (snapshot.isDraft && verdictToFormat.conclusion === "failure") {
    lines.push(
      "",
      "This pull request is a draft. A red gate is expected here mid-flow; the gate",
      "binds when the pull request is ready and branch protection blocks the merge.",
    );
  }
  return lines.join("\n");
};
