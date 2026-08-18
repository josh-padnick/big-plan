// Proves the one thing about publishing a verdict that fails silently when it
// is wrong: a check run named `review-triage` on this commit is not necessarily
// ours. Only the app that created a check run may update it, so patching
// another app's run answers 403, and the failure handler republishes through
// this same call - so one foreign run of that name would take down both gates
// and leave the pull request with no verdict at all.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GITHUB_TOKEN = "test-token";

const { publishCheckRun } = await import("./github.mjs");

/** Runs `body` with fetch stubbed, and hands it the calls that were made. */
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
    return new Response(JSON.stringify(respond(call)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
