// Proves the registry records identity and only identity, keeps entries after
// the session that created them ends, and treats what is already on disk as
// untrusted input.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isServicePlanId,
  listServiceRegistryEntries,
  pruneMissingPlans,
  readServiceRegistryEntry,
  rememberPlan,
  validateServiceRegistryEntry,
} from "./registry.js";
import { servicePaths } from "./paths.js";

const planId = "1111111111111111";
const otherPlanId = "2222222222222222";

let stateDirectory: string;
let previousStateDirectory: string | undefined;

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-registry-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
});

afterEach(async () => {
  if (previousStateDirectory === undefined) {
    delete process.env["BIG_PLAN_STATE_DIR"];
  } else {
    process.env["BIG_PLAN_STATE_DIR"] = previousStateDirectory;
  }
  await rm(stateDirectory, { recursive: true, force: true });
});

describe("service registry", () => {
  it("should accept only the review store's own plan id shape", () => {
    expect(isServicePlanId(planId)).toBe(true);
    for (const candidate of [
      "",
      "111",
      "1111111111111111a",
      "../../etc/passwd",
      "1111111111111111/..",
      "ABCDEF0123456789",
    ]) {
      expect(isServicePlanId(candidate)).toBe(false);
    }
  });

  it("should reject an entry carrying anything that looks like liveness", () => {
    // The one place liveness lives is the plan's own heartbeat. An entry that
    // claimed to know whether a session is running would drift from it, and
    // the drift would surface as a page describing a session that is alive.
    const entry = {
      version: 1,
      planId,
      planPath: "/tmp/plan.mdx",
      firstSeenAt: "2026-08-17T12:00:00.000Z",
      lastStartedAt: "2026-08-17T12:00:00.000Z",
    };
    expect(validateServiceRegistryEntry(entry)).toEqual(entry);
    // Unknown fields are dropped rather than carried, so a liveness field
    // written by anything cannot survive a read.
    expect(validateServiceRegistryEntry({ ...entry, running: true })).toEqual(
      entry,
    );
    expect(
      Object.keys(
        validateServiceRegistryEntry({ ...entry, running: true }) ?? {},
      ),
    ).not.toContain("running");
  });

  it("should refuse an entry with a bad version, id, path, or timestamp", () => {
    const entry = {
      version: 1,
      planId,
      planPath: "/tmp/plan.mdx",
      firstSeenAt: "2026-08-17T12:00:00.000Z",
      lastStartedAt: "2026-08-17T12:00:00.000Z",
    };
    for (const broken of [
      { ...entry, version: 2 },
      { ...entry, planId: "nope" },
      { ...entry, planPath: "" },
      { ...entry, firstSeenAt: "not a date" },
      { ...entry, lastStartedAt: 17 },
    ]) {
      expect(validateServiceRegistryEntry(broken)).toBe(undefined);
    }
    expect(validateServiceRegistryEntry(undefined)).toBe(undefined);
    expect(validateServiceRegistryEntry([entry])).toBe(undefined);
  });

  it("should keep the first sighting and advance the last start", async () => {
    const first = await rememberPlan({
      planId,
      planPath: "/tmp/plan.mdx",
      now: new Date("2026-08-17T09:00:00.000Z"),
    });
    const second = await rememberPlan({
      planId,
      planPath: "/tmp/plan.mdx",
      now: new Date("2026-08-17T11:00:00.000Z"),
    });
    expect(second.firstSeenAt).toBe(first.firstSeenAt);
    expect(second.lastStartedAt).toBe("2026-08-17T11:00:00.000Z");
    expect(await readServiceRegistryEntry({ planId })).toEqual(second);
  });

  it("should read a missing or corrupt entry as absent rather than throwing", async () => {
    expect(await readServiceRegistryEntry({ planId })).toBe(undefined);
    await rememberPlan({ planId, planPath: "/tmp/plan.mdx" });
    await writeFile(
      join(servicePaths().registryDirectory, `${planId}.json`),
      "{ this is not json",
      "utf8",
    );
    expect(await readServiceRegistryEntry({ planId })).toBe(undefined);
  });

  it("should refuse to read an entry through a plan id that is not one", async () => {
    expect(await readServiceRegistryEntry({ planId: "../token" })).toBe(
      undefined,
    );
    await expect(
      rememberPlan({ planId: "../token", planPath: "/tmp/plan.mdx" }),
    ).rejects.toThrow(/Refusing a registry entry/u);
  });

  it("should list every readable entry in plan-id order", async () => {
    await rememberPlan({ planId: otherPlanId, planPath: "/tmp/b.mdx" });
    await rememberPlan({ planId, planPath: "/tmp/a.mdx" });
    expect(
      (await listServiceRegistryEntries()).map((entry) => entry.planId),
    ).toEqual([planId, otherPlanId]);
  });

  it("should prune only entries whose plan file is gone", async () => {
    await rememberPlan({ planId, planPath: "/tmp/present.mdx" });
    await rememberPlan({ planId: otherPlanId, planPath: "/tmp/absent.mdx" });
    const dropped = await pruneMissingPlans({
      exists: async (planPath) => planPath === "/tmp/present.mdx",
    });
    expect(dropped).toBe(1);
    expect(
      (await listServiceRegistryEntries()).map((entry) => entry.planId),
    ).toEqual([planId]);
  });

  it("should write entries the service can read without a partial state", async () => {
    await rememberPlan({ planId, planPath: "/tmp/plan.mdx" });
    const raw = await readFile(
      join(servicePaths().registryDirectory, `${planId}.json`),
      "utf8",
    );
    // Written through a temporary name and renamed, so a reader either sees
    // the whole entry or no entry at all.
    expect(JSON.parse(raw)).toMatchObject({ version: 1, planId });
    expect(await listServiceRegistryEntries()).toHaveLength(1);
  });
});
