// Proves that bounded file reads use the opened file and enforce an accepted
// file identity.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  readBoundedRegularFile,
  regularFileIdentity,
} from "./bounded-regular-file.js";

const created: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("should refuse a file that does not match the accepted identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-bounded-file-"));
  created.push(directory);
  const acceptedPath = join(directory, "accepted.png");
  const otherPath = join(directory, "other.png");
  await writeFile(acceptedPath, "accepted");
  await writeFile(otherPath, "other");
  const identity = await regularFileIdentity({
    path: acceptedPath,
    maxBytes: 32,
  });
  expect(identity).toBeDefined();
  if (identity === undefined) return;

  await expect(
    readBoundedRegularFile({
      path: acceptedPath,
      maxBytes: 32,
      expectedIdentity: identity,
    }),
  ).resolves.toEqual(new TextEncoder().encode("accepted"));
  await expect(
    readBoundedRegularFile({
      path: otherPath,
      maxBytes: 32,
      expectedIdentity: identity,
    }),
  ).resolves.toBeUndefined();
});
