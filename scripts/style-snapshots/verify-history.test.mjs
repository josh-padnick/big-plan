// Proves the history gate in a disposable Git repository: an empty styling
// commit stays pixel-identical, an approved move matches its manifest, and an
// undeclared regression fails at the commit where it appears.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { PNG } from "pngjs";
import { verifyHistory } from "./verify-history.mjs";

const execFileAsync = promisify(execFile);

const git = async (repoRoot, arguments_) => {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: repoRoot,
  });
  return stdout.trim();
};

const commit = async ({ repoRoot, subject }) => {
  await git(repoRoot, ["add", "."]);
  await git(repoRoot, ["commit", "-m", subject]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
};

const onePixelPng = ({ red, green, blue }) => {
  const png = new PNG({ width: 1, height: 1 });
  png.data[0] = red;
  png.data[1] = green;
  png.data[2] = blue;
  png.data[3] = 255;
  return PNG.sync.write(png).toString("base64");
};

test("should stop at the commit whose screenshots exceed its visual contract", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "style-history-test-"));
  try {
    await git(repoRoot, ["init", "-b", "main"]);
    await git(repoRoot, ["config", "user.name", "Style History Test"]);
    await git(repoRoot, [
      "config",
      "user.email",
      "style-history@example.invalid",
    ]);
    await mkdir(join(repoRoot, ".style-snapshots"), { recursive: true });
    await writeFile(join(repoRoot, "fixture.txt"), "stable fixture\n", "utf8");
    await writeFile(join(repoRoot, "style.txt"), "red\n", "utf8");

    const colors = {
      red: onePixelPng({ red: 255, green: 0, blue: 0 }),
      blue: onePixelPng({ red: 0, green: 0, blue: 255 }),
      green: onePixelPng({ red: 0, green: 255, blue: 0 }),
    };
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const checkout = process.env.STYLE_SNAPSHOT_CHECKOUT;
const output = process.env.STYLE_SNAPSHOT_OUTPUT_DIR;
const style = (await readFile(join(checkout, "style.txt"), "utf8")).split(/\\s/)[0];
const colors = ${JSON.stringify(colors)};
await mkdir(output, { recursive: true });
await writeFile(join(output, "state.png"), Buffer.from(colors[style], "base64"));
`,
      "utf8",
    );
    const configPath = join(repoRoot, ".style-snapshots", "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          fixturePaths: ["fixture.txt"],
          stylingFilePatterns: ["^style\\.txt$"],
          manifestDirectory: ".style-snapshots/manifests",
          captureCommand: ["node", "{harnessRoot}/capture.mjs"],
        },
        null,
        2,
      ),
      "utf8",
    );
    const base = await commit({ repoRoot, subject: "test: establish fixture" });

    await writeFile(
      join(repoRoot, "style.txt"),
      "red\ncomment-only change\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "style: preserve the red pixel [visual:empty]",
    });

    const approvedSubject = "style: move the pixel to blue [visual:approved]";
    await writeFile(join(repoRoot, "style.txt"), "blue\n", "utf8");
    await mkdir(join(repoRoot, ".style-snapshots", "manifests"), {
      recursive: true,
    });
    await writeFile(
      join(repoRoot, ".style-snapshots", "manifests", "blue.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          commitSubject: approvedSubject,
          stylingFiles: [
            {
              path: "style.txt",
              propertyDeltas: [{ property: "color", from: "red", to: "blue" }],
            },
          ],
          captureChanges: [
            {
              capture: "state.png",
              propertyDeltas: [{ property: "color", from: "red", to: "blue" }],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await commit({ repoRoot, subject: approvedSubject });

    const passing = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: join(repoRoot, "artifacts-passing"),
    });
    assert.deepEqual(
      passing.map((result) => ({
        visualKind: result.visualKind,
        changedCaptures: result.changedCaptures,
        changedPixels: result.changedPixels,
      })),
      [
        { visualKind: "empty", changedCaptures: 0, changedPixels: 0 },
        { visualKind: "approved", changedCaptures: 1, changedPixels: 1 },
      ],
    );

    await writeFile(join(repoRoot, "style.txt"), "green\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: claim an unsafe move is empty [visual:empty]",
    });
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: join(repoRoot, "artifacts-failing"),
      }),
      /expected zero changed pixels; observed state\.png \(1 changed pixels\)/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
