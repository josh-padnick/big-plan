// Proves the one thing about publishing a verdict that fails silently when it
// is wrong: a check run named `review-triage` on this commit is not necessarily
// ours. Only the app that created a check run may update it, so patching
// another app's run answers 403, and the failure handler republishes through
// this same call - so one foreign run of that name would take down both gates
// and leave the pull request with no verdict at all.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GITHUB_TOKEN = "test-token";

const { fetchSnapshot, publishCheckRun, GitHubFailure } = await import(
  "./github.mjs"
);

/**
 * Runs `body` with fetch stubbed, and hands it the calls that were made.
 *
 * `respond` may return a payload, or `{ status, payload, headers }` to answer
 * with a failure. `calls` records every attempt, so a test can prove a request
 * was retried, or that it was not.
 */
const withStubbedApi = async (respond, body) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body === undefined ? null : JSON.parse(init.body),
    };
    calls.push(call);
    const answer = respond(call, calls.length);
    const failure =
      answer !== null &&
      typeof answer === "object" &&
      typeof answer.status === "number";
    return new Response(
      typeof answer === "string"
        ? answer
        : JSON.stringify(failure ? (answer.payload ?? {}) : answer),
      {
        status: failure ? answer.status : 200,
        headers: {
          "content-type": "application/json",
          ...(failure ? (answer.headers ?? {}) : {}),
        },
      },
    );
  };
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
};

const publish = () =>
  publishCheckRun({
    owner: "josh-padnick",
    repo: "big-plan",
    headSha: "abc1234def5678901234567890abcdef12345678",
    name: "review-triage",
    conclusion: "failure",
    title: "Reviewer findings are unresolved",
    report: "one finding is unresolved",
  });

const listing = (...runs) => ({ total_count: runs.length, check_runs: runs });

test("the snapshot preserves review identity and chronology", async () => {
  await withStubbedApi(
    (call) => {
      if (call.url.endsWith("/pulls/42")) {
        return {
          head: { sha: "abc1234def5678901234567890abcdef12345678" },
          draft: false,
          html_url: "https://github.com/o/r/pull/42",
        };
      }
      if (call.url.includes("/issues/42/comments?")) {
        return [
          {
            id: 101,
            user: { login: "some-agent" },
            body: "review-triage: retract coderabbit - duplicate review",
            created_at: "2026-08-20T12:01:00Z",
            html_url: "https://github.com/o/r/pull/42#issuecomment-101",
          },
        ];
      }
      if (call.url.includes("/pulls/42/reviews?")) {
        return [
          {
            id: 11,
            user: { login: "coderabbitai[bot]" },
            state: "COMMENTED",
            body: "finding",
            submitted_at: "2026-08-20T12:00:00Z",
          },
        ];
      }
      if (call.url.includes("/pulls/42/commits?")) {
        return [{ sha: "abc1234def5678901234567890abcdef12345678" }];
      }
      if (call.url.endsWith("/graphql")) {
        return {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      isResolved: false,
                      isOutdated: false,
                      path: "src/example.ts",
                      line: 7,
                      originalLine: 7,
                      comments: {
                        pageInfo: { hasNextPage: false },
                        nodes: [
                          {
                            url: "https://github.com/o/r/pull/42#discussion_r1",
                            body: "finding",
                            isMinimized: false,
                            createdAt: "2026-08-20T12:00:00Z",
                            author: { login: "coderabbitai[bot]" },
                            pullRequestReview: { databaseId: 11 },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected request: ${call.url}`);
    },
    async () => {
      const result = await fetchSnapshot({
        owner: "o",
        repo: "r",
        number: 42,
      });
      assert.equal(result.reviews[0].id, 11);
      assert.equal(result.reviews[0].submittedAt, "2026-08-20T12:00:00Z");
      assert.equal(result.issueComments[0].id, 101);
      assert.equal(
        result.issueComments[0].createdAt,
        "2026-08-20T12:01:00Z",
      );
      assert.equal(result.reviewThreads[0].reviewId, 11);
    },
  );
});

test("a check run of the same name owned by another app is left alone", async () => {
  await withStubbedApi(
    (call) =>
      call.method === "GET"
        ? listing({
            id: 99,
            name: "review-triage",
            app: { slug: "some-other-app" },
          })
        : { id: 1234 },
    async (calls) => {
      await publish();
      const written = calls.filter((call) => call.method !== "GET");
      assert.equal(written.length, 1);
      assert.equal(written[0].method, "POST");
      assert.match(written[0].url, /\/check-runs$/);
      assert.equal(
        calls.some((call) => call.url.includes("/check-runs/99")),
        false,
      );
    },
  );
});

test("this app's own check run is updated in place", async () => {
  await withStubbedApi(
    (call) =>
      call.method === "GET"
        ? listing(
            { id: 99, name: "review-triage", app: { slug: "some-other-app" } },
            { id: 100, name: "review-triage", app: { slug: "github-actions" } },
          )
        : { id: 100 },
    async (calls) => {
      await publish();
      const written = calls.filter((call) => call.method !== "GET");
      assert.equal(written.length, 1);
      assert.equal(written[0].method, "PATCH");
      assert.match(written[0].url, /\/check-runs\/100$/);
      assert.equal(written[0].body.conclusion, "failure");
    },
  );
});

test("the first verdict on a commit creates the check run", async () => {
  await withStubbedApi(
    (call) => (call.method === "GET" ? listing() : { id: 1 }),
    async (calls) => {
      await publish();
      const written = calls.filter((call) => call.method !== "GET");
      assert.equal(written.length, 1);
      assert.equal(written[0].method, "POST");
      assert.equal(written[0].body.name, "review-triage");
      assert.equal(written[0].body.head_sha.startsWith("abc1234"), true);
    },
  );
});

test("a transient failure on a read is retried rather than failing the gate", async () => {
  await withStubbedApi(
    (call, attempt) => {
      if (call.method !== "GET") {
        return { id: 1 };
      }
      return attempt === 1
        ? {
            status: 502,
            payload: { message: "Bad gateway" },
            headers: { "retry-after": "0" },
          }
        : listing();
    },
    async (calls) => {
      await publish();
      const reads = calls.filter((call) => call.method === "GET");
      assert.equal(reads.length, 2);
      assert.equal(calls.at(-1).method, "POST");
    },
  );
});

test("exhausted retries fail closed and name the status", async () => {
  await withStubbedApi(
    () => ({
      status: 503,
      payload: { message: "Service unavailable" },
      headers: { "retry-after": "0" },
    }),
    async (calls) => {
      await assert.rejects(publish(), (error) => {
        assert.equal(error instanceof GitHubFailure, true);
        assert.match(error.message, /returned 503 after 3 attempts/);
        return true;
      });
      assert.equal(calls.length, 3);
    },
  );
});

test("a permissions refusal is answered at once, not retried", async () => {
  await withStubbedApi(
    () => ({
      status: 403,
      payload: { message: "Resource not accessible by integration" },
    }),
    async (calls) => {
      await assert.rejects(publish(), (error) => {
        assert.match(error.message, /returned 403/);
        assert.doesNotMatch(error.message, /attempts/);
        return true;
      });
      assert.equal(calls.length, 1);
    },
  );
});

test("the secondary rate limit is transient even though it answers 403", async () => {
  await withStubbedApi(
    (call, attempt) => {
      if (call.method !== "GET") {
        return { id: 1 };
      }
      return attempt === 1
        ? {
            status: 403,
            payload: { message: "You have exceeded a secondary rate limit" },
            headers: { "retry-after": "0" },
          }
        : listing();
    },
    async (calls) => {
      await publish();
      assert.equal(calls.filter((call) => call.method === "GET").length, 2);
    },
  );
});

test("publishing a verdict is never retried, so no gate is published twice", async () => {
  await withStubbedApi(
    (call) =>
      call.method === "GET"
        ? listing()
        : {
            status: 502,
            payload: { message: "Bad gateway" },
            headers: { "retry-after": "0" },
          },
    async (calls) => {
      await assert.rejects(publish(), /returned 502/);
      assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    },
  );
});
