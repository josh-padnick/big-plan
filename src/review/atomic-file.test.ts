// Proves review-file replacement and immutable creation remain complete,
// owner-only, and recoverable across filesystem failures.

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFileExclusively,
  replaceFileAtomically,
} from "./atomic-file.js";

describe("atomic review files", () => {
  it("should preserve the previous value when rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-atomic-"));
    const path = join(directory, "state.json");
    await replaceFileAtomically({ path, contents: '{"revision":1}\n' });
    await expect(
      replaceFileAtomically({
        path,
        contents: '{"revision":2}\n',
        operations: {
          open: (await import("node:fs/promises")).open,
          chmod: (await import("node:fs/promises")).chmod,
          unlink: (await import("node:fs/promises")).unlink,
          rename: async () => {
            throw new Error("injected rename failure");
          },
        },
      }),
    ).rejects.toThrow("injected rename failure");
    await expect(readFile(path, "utf8")).resolves.toBe('{"revision":1}\n');
  });

  it("should keep resulting files owner-only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-atomic-"));
    const path = join(directory, "state.json");
    await replaceFileAtomically({ path, contents: "{}\n" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("should refuse to replace an immutable record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-atomic-"));
    const path = join(directory, "event.json");
    await createFileExclusively({ path, contents: '{"event":1}\n' });
    await expect(
      createFileExclusively({ path, contents: '{"event":2}\n' }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(path, "utf8")).resolves.toBe('{"event":1}\n');
  });
});
