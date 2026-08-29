// Exercises the passive notice policy at the CLI boundary: install-method and
// version gates, stale-cache refresh, and silent failure behavior.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareUpdateNotice } from "./update-notice.js";

const NOW = 2_000_000_000_000;
const GLOBAL_ENTRY = "/usr/local/lib/node_modules/big-plan/bin/big-plan.mjs";
const NPX_ENTRY = "/tmp/.npm/_npx/abc/node_modules/big-plan/bin/big-plan.mjs";

let stateDirectory = "";

beforeEach(async () => {
  stateDirectory = join(
    tmpdir(),
    `big-plan-update-${process.pid}-${Date.now()}`,
  );
  await mkdir(stateDirectory, { recursive: true });
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
});

afterEach(async () => {
  delete process.env["BIG_PLAN_STATE_DIR"];
  await rm(stateDirectory, { recursive: true, force: true });
});

const writeMarker = async (value: unknown): Promise<void> => {
  await writeFile(
    join(stateDirectory, "update-check.json"),
    JSON.stringify(value),
    "utf8",
  );
};

describe("prepareUpdateNotice", () => {
  it("should show one update line when a non-npx install has a newer version", async () => {
    await writeMarker({ checkedAtMs: NOW, latest: "1.2.0" });

    await expect(
      prepareUpdateNotice({
        currentVersion: "1.1.0",
        invokedAs: GLOBAL_ENTRY,
        now: NOW,
        resolveEntry: async (path) => path,
      }),
    ).resolves.toEqual({
      line: "Update available: Big Plan 1.2.0 (running 1.1.0); update with your package manager (https://big-plan.ai/intro/installation/).",
    });
  });

  it("should stay silent and skip refresh for an npx install", async () => {
    await writeMarker({ checkedAtMs: NOW, latest: "1.2.0" });
    const launchRefresh = vi.fn();

    const prepared = await prepareUpdateNotice({
      currentVersion: "1.1.0",
      invokedAs: NPX_ENTRY,
      now: NOW,
      resolveEntry: async (path) => path,
      launchRefresh,
    });

    expect(prepared).toEqual({});
    expect(launchRefresh).not.toHaveBeenCalled();
  });

  it.each(["1.1.0", "1.0.9"])(
    "should stay silent when the published version is %s",
    async (latest) => {
      await writeMarker({ checkedAtMs: NOW, latest });

      const prepared = await prepareUpdateNotice({
        currentVersion: "1.1.0",
        invokedAs: GLOBAL_ENTRY,
        now: NOW,
        resolveEntry: async (path) => path,
      });

      expect(prepared.line).toBeUndefined();
    },
  );

  it("should return silently and defer a stale check until after output", async () => {
    await writeMarker({ checkedAtMs: 0, latest: "9.0.0" });
    const launchRefresh = vi.fn();

    const prepared = await prepareUpdateNotice({
      currentVersion: "1.1.0",
      invokedAs: GLOBAL_ENTRY,
      now: NOW,
      resolveEntry: async (path) => path,
      launchRefresh,
    });

    expect(prepared.line).toBeUndefined();
    expect(launchRefresh).not.toHaveBeenCalled();
    prepared.refreshAfterOutput?.();
    expect(launchRefresh).toHaveBeenCalledOnce();
  });

  it("should suppress a synchronous refresh-launch failure", async () => {
    const prepared = await prepareUpdateNotice({
      currentVersion: "1.1.0",
      invokedAs: GLOBAL_ENTRY,
      now: NOW,
      resolveEntry: async (path) => path,
      launchRefresh: () => {
        throw new Error("unavailable");
      },
    });

    expect(() => prepared.refreshAfterOutput?.()).not.toThrow();
  });

  it("should show nothing when install detection cannot resolve the entry", async () => {
    await expect(
      prepareUpdateNotice({
        currentVersion: "1.1.0",
        invokedAs: GLOBAL_ENTRY,
        resolveEntry: async () => {
          throw new Error("unavailable");
        },
      }),
    ).resolves.toEqual({});
  });

  it("should show nothing when platform state makes install detection fail", async () => {
    const unavailableEnvironment = new Proxy(process.env, {
      get: () => {
        throw new Error("unavailable");
      },
    });

    await expect(
      prepareUpdateNotice({
        currentVersion: "1.1.0",
        invokedAs: GLOBAL_ENTRY,
        env: unavailableEnvironment,
        resolveEntry: async (path) => path,
      }),
    ).resolves.toEqual({});
  });
});
