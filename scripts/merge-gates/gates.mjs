// Decides the two merge gates the captain ratified on 2026-08-18 (BIG-164),
// after PR #163 merged with seven reviewer findings that nobody had resolved.
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
//      A reviewer counts while it has either a review it has not taken back or
//      an unresolved inline thread, so dismissing a review drops it from the
//      count only once every finding it left is resolved.
//   b. Every inline finding that reviewer raised is resolved, which here means
//      a written reply from somebody other than the reviewer. Resolved is this
//      gate's word, not GitHub's: ticking GitHub's resolve checkbox resolves
//      nothing, and neither does the reviewer replying to itself. Silently
//      resolving a thread is the exact shape of the incident this gate exists
//      to stop, so the written reply is the record.
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

/** One marker with the real head sha filled in, for a report a reader copies. */
const withHead = (marker, headSha) => marker.replace("<head-sha>", headSha);

/** Names of the two check runs. Branch protection requires these exact strings. */
export const CHECK_NAMES = {
  reviewTriage: "review-triage",
  validationAttestation: "validation-attestation",
};

const SHORT_SHA = 8;

/**
 * An override reason shorter than this is not a reason, it is a shrug. A marker
 * rejected for this is reported as rejected rather than dropped, because an
 * agent that posted one and read "nothing attests this head" would have no way
 * to tell that the gate saw its comment and refused it.
 */
export const MIN_OVERRIDE_REASON = 8;

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
 * Removes the `<!-- ... -->` spans from one line, given whether an earlier line
 * left a span open, and reports whether this line leaves one open. A span may
 * open and close on one line, several times, or run across many lines.
 */
const withoutHiddenSpans = (line, wasHidden) => {
  let visible = "";
  let rest = line;
  let hidden = wasHidden;
  while (rest !== "") {
    if (hidden) {
      const close = rest.indexOf("-->");
      if (close === -1) {
        return { visible, hidden: true };
      }
      rest = rest.slice(close + 3);
      hidden = false;
      continue;
    }
    const open = rest.indexOf("<!--");
    if (open === -1) {
      return { visible: visible + rest, hidden: false };
    }
    visible += rest.slice(0, open);
    rest = rest.slice(open + 4);
    hidden = true;
  }
  return { visible, hidden };
};

/**
 * Strips the parts of a comment that quote rather than assert: fenced code
 * blocks, blockquoted lines, indented code blocks, and HTML comments.
 * Documentation of a marker, a reply quoting an earlier comment, and an agent
 * pasting an example must not satisfy a gate, so only a plain top-level line
 * counts as a statement the author is making.
 *
 * Two of these rules are load-bearing rather than tidy.
 *
 * The indent rule: these gates print the markers to post indented by four
 * spaces, with the real head sha already filled in, so an agent that pasted a
 * failure report back as a comment would otherwise satisfy the very gate that
 * printed it.
 *
 * The HTML-comment rule: a marker inside `<!-- ... -->` turns a gate green
 * while a human reading the pull request sees nothing at all, which is a
 * stronger form of not asserting than an indent is. It is also reached without
 * malice, because reviewer bots wrap their bookkeeping - including quoted
 * context from earlier comments - in exactly those spans.
 *
 * Which text each rule reads is the contract here, and getting it backwards
 * fails open rather than loudly.
 *
 * Blockquote and indent are properties of the RAW line, because Markdown reads
 * a line's block context from the prefix it actually starts with. A span that
 * closes at the start of a line would otherwise eat that line's `>` or its
 * indentation and promote quoted text to an assertion, so both rules consult
 * the raw line first; they also consult what survives the span, which can only
 * suppress more, never assert more.
 *
 * A fence is a property of what SURVIVES, because a ``` sitting inside a
 * comment span is not a fence at all, and reading the raw line there would
 * suppress everything after a fence that only appears to open.
 *
 * A closing fence follows CommonMark, which is what GitHub renders: the same
 * marker character as the fence that opened, at least as long, and nothing
 * after it but spaces. Anything less leaves the fence open and every later
 * line suppressed.
 *
 * A blockquote continues LAZILY, again as CommonMark and GitHub do: a plain
 * line following a quoted one, with no blank line between them, is part of
 * that quote and renders inside the quote box, so it asserts nothing. The
 * quote runs until a blank line, a fence, or a line that renders as nothing
 * ends the paragraph.
 *
 * This function is the whole boundary between what a comment quotes and what
 * it asserts, and four separate holes have been found in it. Every rule here
 * therefore errs one way: when this function and GitHub's renderer disagree,
 * this function must be the one treating MORE text as quoted, because the
 * reader trusts what GitHub renders and a gate may only be stricter than that.
 * Where a case is genuinely ambiguous, suppress rather than assert. A change
 * to any rule below needs a test proving the new shape cannot promote
 * rendered-as-code or rendered-as-quoted text into an assertion.
 */
export const assertedLines = (body) => {
  const lines = (body ?? "").split(/\r?\n/);
  const opensFence = /^\s*(`{3,}|~{3,})/;
  const closesFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
  const isQuoted = (text) => /^\s*>/.test(text);
  const isIndented = (text) => /^(\s{4,}|\t)/.test(text);
  const asserted = [];
  let fence = null;
  let hidden = false;
  let quoting = false;
  for (const line of lines) {
    if (fence !== null) {
      const close = closesFence.exec(line);
      if (
        close !== null &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    const span = withoutHiddenSpans(line, hidden);
    hidden = span.hidden;
    if (span.visible.trim() === "") {
      quoting = false;
      continue;
    }
    if (isQuoted(line) || isQuoted(span.visible)) {
      quoting = true;
      continue;
    }
    if (isIndented(line) || isIndented(span.visible)) {
      continue;
    }
    const open = opensFence.exec(span.visible);
    if (open !== null) {
      quoting = false;
      fence = { marker: open[1][0], length: open[1].length };
      continue;
    }
    if (quoting) {
      continue;
    }
    asserted.push(span.visible);
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

/**
 * Review states that count as a review having happened. A dismissed review has
 * been taken back, so it stops counting on its own; its reviewer keeps counting
 * only while one of its inline findings is still unresolved, because findings
 * outlive the review that carried them. A pending review was never submitted.
 */
const COUNTED_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

/** Resolves a login to the accepted reviewer it belongs to, or null. */
const botFor = (login) =>
  REVIEW_BOTS.find((bot) =>
    bot.logins.some((alias) => lower(alias) === lower(login)),
  ) ?? null;

/** True when a login belongs to the reviewer whose threads are being judged. */
const wrote = (logins, login) =>
  logins.some((alias) => lower(alias) === lower(login));

/**
 * How this gate reads GitHub's minimized flag, which is the one place hiding a
 * comment could otherwise change a verdict. Anyone with write access may hide
 * any comment, the author's own agent included, and the API does not say who
 * did it - so hiding is never taken as the reviewer withdrawing anything.
 *
 * A minimized root still gates: a finding the reviewer really did withdraw
 * costs one honest reply saying so, and the reply is the record.
 * A minimized reply does not resolve: a hidden disposition is not a written
 * one, which is the same reason GitHub's resolve checkbox does not count.
 */
const isReviewerThread = (thread, reviewerLogins) => {
  const root = thread.comments[0];
  return root !== undefined && wrote(reviewerLogins, root.author);
};

/**
 * The reply that resolves a thread, or undefined while it is unresolved.
 *
 * Resolved is this gate's word: a live comment from somebody other than the
 * thread's author. The author replying to itself resolves nothing, and neither
 * does GitHub's resolve checkbox, because resolving without replying leaves no
 * record of what was done - which is what made the PR #163 findings invisible.
 */
const resolvingReply = (thread, authorLogins) =>
  thread.comments
    .slice(1)
    .find(
      (comment) =>
        !wrote(authorLogins, comment.author) && comment.isMinimized !== true,
    );

const isResolved = (thread, authorLogins) =>
  resolvingReply(thread, authorLogins) !== undefined;

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
 * Identifies which accepted reviews exist. A bot counts while it holds either a
 * review it has not taken back or an unresolved inline thread; an attestation
 * counts once it is well-formed. All attestations collapse into one identity
 * because they all stand for the same thing, our own agent reviewing in a bot's
 * place.
 *
 * The unresolved-thread half is what makes the two-review recovery honest.
 * Dismissing a review that left findings would otherwise drop the reviewer from
 * the count while its findings sat unread, which is the incident this gate
 * exists to stop; a dismissal clears the reviewer only once every thread it
 * opened carries a reply from somebody else.
 */
export const identifyReviews = (snapshot) => {
  const byBot = new Map();
  for (const review of snapshot.reviews) {
    if (!COUNTED_REVIEW_STATES.has((review.state ?? "").toUpperCase())) {
      continue;
    }
    const bot = botFor(review.author);
    if (bot !== null) {
      byBot.set(bot.id, bot);
    }
  }
  for (const thread of snapshot.reviewThreads) {
    const bot = botFor(thread.comments[0]?.author);
    if (bot === null || byBot.has(bot.id)) {
      continue;
    }
    if (!isResolved(thread, bot.logins)) {
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
 * Splits a reviewer's inline threads into resolved and unresolved, and lists
 * the unresolved threads other authors left.
 *
 * Only the accepted reviewer's threads gate the merge; the foreign list is
 * reported for information, and is judged by the same definition of resolved so
 * the word means one thing everywhere the gate prints it. Pass an empty list of
 * reviewer logins to collect the foreign list alone.
 */
export const triageThreads = (snapshot, reviewerLogins) => {
  const own = snapshot.reviewThreads.filter((thread) =>
    isReviewerThread(thread, reviewerLogins),
  );
  const resolved = [];
  const unresolved = [];
  for (const thread of own) {
    const reply = resolvingReply(thread, reviewerLogins);
    (reply === undefined ? unresolved : resolved).push({ ...thread, reply });
  }
  const foreign = snapshot.reviewThreads.filter((thread) => {
    const root = thread.comments[0];
    return (
      root !== undefined &&
      !wrote(reviewerLogins, root.author) &&
      !isResolved(thread, [root.author])
    );
  });
  return { threads: own, resolved, unresolved, foreign };
};

/** Where an inline thread sits, for a reader who has to go resolve it. */
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
 * Gate 1. Requires exactly one accepted review, a written reply resolving each
 * of its inline findings, and a sign-off naming the current head.
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
    const retractions = accepted.flatMap((one) =>
      one.kind === "bot"
        ? [
            `  - ${one.bot.label}: reply in every thread it opened, saying what you`,
            "    did, and then dismiss its review. Dismissing alone is not enough - a",
            "    reviewer keeps counting while any of its inline threads is unresolved.",
          ]
        : [
            `  - ${ADVERSARIAL_REVIEWER.label} by ${one.attestation.agent}: delete that`,
            `    attestation comment. ${one.attestation.url}`,
          ],
    );
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
        "Next action: keep one and retract the other.",
        ...retractions,
        "",
        "This check re-runs on its own when the comment or the review changes.",
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

  // An attestation has no inline threads of its own, so it passes no reviewer
  // logins; the foreign listing below is then every unresolved thread, and it
  // is printed for both reviewer kinds rather than only for a bot.
  const { threads, resolved, unresolved, foreign } = triageThreads(
    snapshot,
    review.kind === "bot" ? review.bot.logins : [],
  );

  if (review.kind === "bot") {
    findingLines.push(
      `Reviewer: ${review.bot.label}. Inline findings: ${threads.length}, resolved: ${resolved.length}, unresolved: ${unresolved.length}.`,
    );
    if (unresolved.length > 0) {
      findingsOk = false;
      findingLines.push("", `${unresolved.length} finding(s) are unresolved:`);
      for (const thread of unresolved) {
        findingLines.push(`  - ${locate(thread)}`);
        findingLines.push(`      ${gist(thread)}`);
        findingLines.push(`      ${thread.url}`);
      }
      findingLines.push(
        "",
        "Next action: reply in each thread above saying what you did - the commit",
        "that fixes it, or the reason you decline it. Ticking GitHub's resolve",
        "checkbox does not resolve a thread here; the written reply is the record.",
      );
    }
  } else {
    const { attestation } = review;
    findingLines.push(
      `Reviewer: ${ADVERSARIAL_REVIEWER.label} by ${attestation.agent}, over commit ${short(attestation.reviewedCommit)}.`,
      `Findings declared: ${attestation.findings}, each with a disposition. ${attestation.url}`,
    );
  }

  if (foreign.length > 0) {
    findingLines.push(
      "",
      `For information only, not gating: ${foreign.length} unresolved inline thread(s) from other authors.`,
      ...foreign.map(
        (thread) =>
          `  - ${locate(thread)} by ${thread.comments[0].author}: ${thread.url}`,
      ),
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
    "Next action: once every finding is resolved, post this as a plain line in a",
    "new comment on the pull request (not inside a code fence, not quoted):",
    "",
    `    ${withHead(MARKERS.signOff, snapshot.headSha)}`,
    "",
    "Any later push moves the head and invalidates the sign-off, so sign off last.",
  ];

  return verdict(
    CHECK_NAMES.reviewTriage,
    "failure",
    findingsOk
      ? `Sign-off missing for head ${head}`
      : "Reviewer findings are unresolved",
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
  const shrugs = [];
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
      } else {
        shrugs.push({ comment, reason });
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
      ...(shrugs.length > 0
        ? [
            "",
            `${shrugs.length} override(s) were refused because the reason is shorter than ${MIN_OVERRIDE_REASON} characters, which is a shrug rather than a reason a reader can weigh:`,
            ...shrugs.map(
              (one) =>
                `  - refused "${one.reason}" (${one.reason.length} character(s)) by ${one.comment.author}: ${one.comment.url}`,
            ),
          ]
        : []),
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
      `    ${withHead(MARKERS.validationPassed, snapshot.headSha)}`,
      "",
      "If the pipeline legitimately does not apply to this pull request, say so",
      "instead, with a reason a reader can weigh:",
      "",
      `    ${MARKERS.validationOverride}`,
      "",
      `The reason has to be at least ${MIN_OVERRIDE_REASON} characters, because a reader has to be`,
      "able to judge the decision from it.",
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
