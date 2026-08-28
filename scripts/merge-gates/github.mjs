// The one place the merge gates touch GitHub: it reads a pull request into the
// plain snapshot gates.mjs judges, and it publishes each verdict as a check run.
//
// Two details here carry the whole design.
//
// First, the head sha always comes from the API, never from the event payload.
// A comment event carries no head sha, and a stale one would sign off the wrong
// commit - the precise failure the sign-off rule exists to prevent.
//
// Second, verdicts are published as check runs against that head sha rather than
// left as the job's own conclusion. A workflow triggered by issue_comment runs
// against the default branch, so its job conclusion never reaches the pull
// request; a check run named for the gate does. That is what lets a new comment
// turn a gate green with no push, and it is why the names in CHECK_NAMES are the
// exact strings branch protection has to require.
//
// Inline threads come from GraphQL because REST cannot say whether a comment
// was minimized, and gates.mjs refuses to let a hidden reply resolve a finding.
//
// Reads retry a transient failure a bounded number of times; publishing never
// does. See the retry policy below for why the two differ.

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

/** The API refused, and the gate must not guess what it would have said. */
export class GitHubFailure extends Error {}

const token = () => {
  const value = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!value) {
    throw new GitHubFailure(
      "no GITHUB_TOKEN or GH_TOKEN in the environment, so the gate cannot read the pull request",
    );
  }
  return value;
};

/**
 * Failures worth trying again, and how long to wait.
 *
 * Failing closed is right, but it is expensive here: one flaky response turns
 * both required checks red on a pull request that satisfies them, and nothing
 * republishes a verdict until somebody pushes, comments, or dispatches the
 * workflow by hand. A bounded retry removes the commonest way that happens.
 *
 * Only a read is retried. A repeated check-run POST would publish duplicate
 * verdicts, so a mutation gets exactly one attempt. A 403 is retried only when
 * the body names the secondary rate limit, because every other 403 is a
 * permissions answer that will not change however many times it is asked.
 */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 2;
const RETRY_DELAYS_MS = [500, 2000];
const RETRY_AFTER_CAP_MS = 10000;

const isTransient = (status, text) =>
  TRANSIENT_STATUSES.has(status) ||
  (status === 403 && /secondary rate limit/i.test(text));

/** GitHub states how long to wait on a rate limit; otherwise back off. */
const retryDelay = (attempt, retryAfter) => {
  const stated =
    retryAfter === null || retryAfter === undefined || retryAfter.trim() === ""
      ? null
      : Number(retryAfter);
  if (stated !== null && Number.isFinite(stated) && stated >= 0) {
    return Math.min(stated * 1000, RETRY_AFTER_CAP_MS);
  }
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One REST call, with the failure text the API actually returned.
 *
 * A GET retries a transient failure; anything that writes does not, and a
 * caller whose write is really a read - the GraphQL query - says so explicitly.
 */
const rest = async (
  path,
  init = {},
  retries = (init.method ?? "GET") === "GET" ? RETRY_ATTEMPTS : 0,
) => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(
      path.startsWith("http") ? path : `${API}${path}`,
      {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token()}`,
          "x-github-api-version": "2022-11-28",
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...init.headers,
        },
      },
    );
    const text = await response.text();
    if (response.ok) {
      return text === "" ? null : JSON.parse(text);
    }
    if (attempt < retries && isTransient(response.status, text)) {
      await sleep(retryDelay(attempt, response.headers.get("retry-after")));
      continue;
    }
    const tried = attempt === 0 ? "" : ` after ${attempt + 1} attempts`;
    throw new GitHubFailure(
      `${init.method ?? "GET"} ${path} returned ${response.status}${tried}: ${text.slice(0, 400)}`,
    );
  }
};

// Every paging bound below fails closed rather than returning what it has. A
// truncated snapshot loses comments, commits, or replies, and each loss points
// the same way: an unresolved finding or an absent attestation that the gate
// then cannot see. A gate that passes on partial data is worse than one that
// refuses to judge.
const PAGE_LIMIT = 20;

/** Walks every page of a REST list endpoint. */
const restAll = async (path) => {
  const items = [];
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await rest(`${path}${separator}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) {
      return items;
    }
  }
  throw new GitHubFailure(
    `${path} has more than ${PAGE_LIMIT * 100} entries, so the gate would judge a truncated pull request`,
  );
};

/**
 * One GraphQL call. GraphQL reports errors with HTTP 200, so check the body.
 * The query only reads, so it retries a transient failure the way a GET does,
 * even though it travels as a POST.
 */
const graphql = async (query, variables) => {
  const body = await rest(
    "/graphql",
    {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    },
    RETRY_ATTEMPTS,
  );
  if (body.errors) {
    throw new GitHubFailure(
      `GraphQL: ${body.errors.map((one) => one.message).join("; ")}`,
    );
  }
  return body.data;
};

const THREADS_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            isOutdated
            path
            line
            originalLine
            comments(first: 100) {
              pageInfo { hasNextPage }
              nodes {
                url
                body
                isMinimized
                createdAt
                author { login }
                pullRequestReview { databaseId }
              }
            }
          }
        }
      }
    }
  }
`;

/** Every inline review thread on the pull request, oldest first. */
const fetchReviewThreads = async (owner, name, number) => {
  const threads = [];
  let cursor = null;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const data = await graphql(THREADS_QUERY, { owner, name, number, cursor });
    const connection = data.repository.pullRequest.reviewThreads;
    for (const node of connection.nodes) {
      if (node.comments.pageInfo.hasNextPage) {
        throw new GitHubFailure(
          `the thread on ${node.path} has more than 100 comments, so the gate cannot see whether it was resolved`,
        );
      }
      threads.push({
        reviewId:
          node.comments.nodes[0]?.pullRequestReview?.databaseId ?? null,
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        path: node.path,
        line: node.line ?? node.originalLine,
        url: node.comments.nodes[0]?.url ?? null,
        comments: node.comments.nodes.map((comment) => ({
          author: comment.author?.login ?? "(deleted account)",
          body: comment.body,
          createdAt: comment.createdAt,
          isMinimized: comment.isMinimized,
          url: comment.url,
        })),
      });
    }
    if (!connection.pageInfo.hasNextPage) {
      return threads;
    }
    cursor = connection.pageInfo.endCursor;
  }
  throw new GitHubFailure(
    `pull request ${number} has more than ${PAGE_LIMIT * 100} review threads, so the gate would judge a truncated review`,
  );
};

/**
 * Reads one pull request into the snapshot the gates judge.
 *
 * Issue comments are the pull request conversation, where every marker lives.
 * Reviews and inline threads identify the reviewer and its findings. The commit
 * list lets an adversarial attestation prove it read code that belongs here.
 */
export const fetchSnapshot = async ({ owner, repo, number }) => {
  const base = `/repos/${owner}/${repo}`;
  const [pull, issueComments, reviews, commits, reviewThreads] =
    await Promise.all([
      rest(`${base}/pulls/${number}`),
      restAll(`${base}/issues/${number}/comments`),
      restAll(`${base}/pulls/${number}/reviews`),
      // GitHub itself caps this list at 250 commits, which no pull request here
      // approaches. A longer one would narrow what an attestation may name, not
      // widen it, so it errs in the safe direction.
      restAll(`${base}/pulls/${number}/commits`),
      fetchReviewThreads(owner, repo, number),
    ]);
  return {
    number,
    headSha: pull.head.sha,
    isDraft: pull.draft === true,
    url: pull.html_url,
    commitShas: commits.map((commit) => commit.sha),
    issueComments: issueComments.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? "(deleted account)",
      body: comment.body ?? "",
      createdAt: comment.created_at,
      url: comment.html_url,
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      author: review.user?.login ?? "(deleted account)",
      state: review.state,
      body: review.body ?? "",
      submittedAt: review.submitted_at,
    })),
    reviewThreads,
  };
};

/**
 * The app whose check runs this publisher may update.
 *
 * A check name is not an ownership proof: any app installed on the repository
 * may publish a check run called `review-triage` on the same commit, and
 * patching that one answers 403 instead of publishing a verdict - which would
 * take down both gates at once, since the failure handler republishes through
 * this same call. In Actions the gate publishes under GITHUB_TOKEN, whose check
 * runs belong to the `github-actions` app; another installation can name its
 * own app through the environment.
 */
const PUBLISHER_APP_SLUG = process.env.MERGE_GATES_APP_SLUG ?? "github-actions";

/** A check run body caps at 65535 characters; keep the head of the report. */
const cap = (text, limit) =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit - 40)}\n... report truncated ...`;

/**
 * Publishes one verdict as a check run on the head commit, updating this app's
 * own run of the same name when one already exists so a gate keeps a single row
 * in the pull request's checks list instead of a new row per comment. A run of
 * that name belonging to another app is left alone and a fresh one is created,
 * because only the app that created a check run may update it.
 */
export const publishCheckRun = async ({
  owner,
  repo,
  headSha,
  name,
  conclusion,
  title,
  report,
  detailsUrl,
}) => {
  const body = {
    name,
    head_sha: headSha,
    status: "completed",
    conclusion,
    completed_at: new Date().toISOString(),
    ...(detailsUrl ? { details_url: detailsUrl } : {}),
    output: {
      title: cap(title, 255),
      summary: cap(`\`\`\`text\n${report}\n\`\`\``, 60000),
    },
  };
  const existing = await rest(
    `/repos/${owner}/${repo}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`,
  );
  const mine = (existing.check_runs ?? []).find(
    (run) =>
      (run.app?.slug ?? "").toLowerCase() === PUBLISHER_APP_SLUG.toLowerCase(),
  );
  if (mine === undefined) {
    return rest(`/repos/${owner}/${repo}/check-runs`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  return rest(`/repos/${owner}/${repo}/check-runs/${mine.id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
};
