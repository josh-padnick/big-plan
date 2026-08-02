// Proves the history gate in a disposable Git repository: an empty styling
// commit stays pixel-identical, an approved move matches its manifest, and an
// undeclared regression fails at the commit where it appears.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  return PNG.sync.write(png);
};

const pngIdentity = (buffer) => {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    sha256: createHash("sha256")
      .update(`width:${png.width};height:${png.height};rgba:`)
      .update(png.data)
      .digest("hex"),
  };
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
    await writeFile(join(repoRoot, "fixture.txt"), "legacy syntax\n", "utf8");
    await writeFile(join(repoRoot, "style.txt"), "red\n", "utf8");

    const colors = {
      red: onePixelPng({ red: 255, green: 0, blue: 0 }),
      blue: onePixelPng({ red: 0, green: 0, blue: 255 }),
      green: onePixelPng({ red: 0, green: 255, blue: 0 }),
    };
    const encodedColors = Object.fromEntries(
      Object.entries(colors).map(([name, buffer]) => [
        name,
        buffer.toString("base64"),
      ]),
    );
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const checkout = process.env.STYLE_SNAPSHOT_CHECKOUT;
const output = process.env.STYLE_SNAPSHOT_OUTPUT_DIR;
const style = (await readFile(join(checkout, "style.txt"), "utf8")).split(/\\s/)[0];
const fixture = await readFile(join(checkout, "fixture.txt"), "utf8");
if (fixture.includes("new-syntax")) {
  try {
    await readFile(join(checkout, "supports-new-syntax"), "utf8");
  } catch {
    throw new Error("fixture syntax is newer than this checkout");
  }
}
const colors = ${JSON.stringify(encodedColors)};
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
      "red\nCI repair without a visual contract\n",
      "utf8",
    );
    await commit({ repoRoot, subject: "no-mistakes: apply CI fixes" });
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: join(repoRoot, "artifacts-missing-contract"),
      }),
      /styling commits must end with \[visual:empty\] or \[visual:approved\]/,
    );
    await git(repoRoot, [
      "commit",
      "--amend",
      "-m",
      "no-mistakes: apply CI fixes [visual:empty]",
    ]);
    const ciRepairCommit = await git(repoRoot, ["rev-parse", "HEAD"]);

    await writeFile(join(repoRoot, "fixture.txt"), "new-syntax\n", "utf8");
    await writeFile(join(repoRoot, "supports-new-syntax"), "yes\n", "utf8");
    const fixtureCommit = await commit({
      repoRoot,
      subject: "test: update the configured fixture [visual:empty]",
    });

    await writeFile(
      join(repoRoot, "style.txt"),
      "red\ncomment-only change\n",
      "utf8",
    );
    const emptyStyleCommit = await commit({
      repoRoot,
      subject: "style: preserve the red pixel [visual:empty]",
    });

    const approvedSubject = "style: move the pixel to blue [visual:approved]";
    await writeFile(join(repoRoot, "style.txt"), "blue\n", "utf8");
    await mkdir(join(repoRoot, ".style-snapshots", "manifests"), {
      recursive: true,
    });
    const manifestPath = join(
      repoRoot,
      ".style-snapshots",
      "manifests",
      "blue.json",
    );
    const redIdentity = pngIdentity(colors.red);
    const approvedManifest = {
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
          changedPixels: 1,
          // Deliberately use a different valid JSON key order than the
          // verifier emits; semantic evidence identity must still compare.
          before: {
            sha256: redIdentity.sha256,
            height: redIdentity.height,
            width: redIdentity.width,
          },
          after: pngIdentity(colors.blue),
          propertyDeltas: [{ property: "color", from: "red", to: "blue" }],
        },
      ],
    };
    const writeManifest = async (manifest) => {
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
    };
    await writeManifest(approvedManifest);
    const approvedCommit = await commit({ repoRoot, subject: approvedSubject });

    const passingArtifacts = join(repoRoot, "artifacts-passing");
    const passing = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: passingArtifacts,
    });
    assert.deepEqual(
      passing.map((result) => ({
        visualKind: result.visualKind,
        changedCaptures: result.changedCaptures,
        changedPixels: result.changedPixels,
      })),
      [
        { visualKind: "empty", changedCaptures: 0, changedPixels: 0 },
        { visualKind: "empty", changedCaptures: 0, changedPixels: 0 },
        { visualKind: "empty", changedCaptures: 0, changedPixels: 0 },
        { visualKind: "approved", changedCaptures: 1, changedPixels: 1 },
      ],
    );
    for (const commitHash of [
      ciRepairCommit,
      fixtureCommit,
      emptyStyleCommit,
      approvedCommit,
    ]) {
      const ledger = JSON.parse(
        await readFile(
          join(passingArtifacts, commitHash.slice(0, 12), "evidence.json"),
          "utf8",
        ),
      );
      assert.equal(ledger.commit, commitHash);
      assert.equal(ledger.captures[0].capture, "state.png");
      assert.match(ledger.captures[0].before.sha256, /^[0-9a-f]{64}$/);
      assert.match(ledger.captures[0].after.sha256, /^[0-9a-f]{64}$/);
    }

    await writeManifest({
      ...approvedManifest,
      captureChanges: [
        {
          ...approvedManifest.captureChanges[0],
          after: pngIdentity(colors.green),
        },
      ],
    });
    await git(repoRoot, ["add", manifestPath]);
    await git(repoRoot, ["commit", "--amend", "--no-edit"]);
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: join(repoRoot, "artifacts-mismatched-manifest"),
      }),
      /exact capture evidence does not match the approved manifest/,
    );
    await writeManifest(approvedManifest);
    await git(repoRoot, ["add", manifestPath]);
    await git(repoRoot, ["commit", "--amend", "--no-edit"]);

    await git(repoRoot, ["checkout", "-b", "style-feature"]);
    await writeFile(
      join(repoRoot, "style.txt"),
      "blue\ncomment-only branch change\n",
      "utf8",
    );
    const featureCommit = await commit({
      repoRoot,
      subject: "style: preserve blue on a feature branch [visual:empty]",
    });
    await git(repoRoot, ["checkout", "main"]);
    await writeFile(join(repoRoot, "main-only.txt"), "advance main\n", "utf8");
    await commit({
      repoRoot,
      subject: "chore: advance main without styling changes",
    });
    await git(repoRoot, [
      "merge",
      "--no-ff",
      "style-feature",
      "-m",
      "Merge pull request #1 from example/style-feature",
    ]);
    const mergedPassing = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: join(repoRoot, "artifacts-merged"),
    });
    assert.ok(
      mergedPassing.some((result) => result.commit === featureCommit),
      "the styling commit on the merged branch must still be replayed",
    );
    assert.ok(
      mergedPassing.every(
        (result) => !result.subject.startsWith("Merge pull request"),
      ),
      "a pure merge commit must not require a second visual declaration",
    );

    const cleanMergeCommit = await git(repoRoot, ["rev-parse", "HEAD"]);
    await git(repoRoot, ["checkout", "-b", "conflicting-style-feature"]);
    await writeFile(
      join(repoRoot, "style.txt"),
      "blue\nconflicting feature comment\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "style: edit feature commentary [visual:empty]",
    });
    await git(repoRoot, ["checkout", "main"]);
    await writeFile(
      join(repoRoot, "style.txt"),
      "blue\nconflicting main comment\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "style: edit main commentary [visual:empty]",
    });
    await assert.rejects(
      git(repoRoot, [
        "merge",
        "--no-ff",
        "conflicting-style-feature",
        "-m",
        "Merge pull request #2 from example/conflicting-style-feature",
      ]),
    );
    await writeFile(
      join(repoRoot, "style.txt"),
      "blue\nresolved commentary\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "Merge pull request #2 from example/conflicting-style-feature",
    });
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: join(repoRoot, "artifacts-conflicting-merge"),
      }),
      /merge commit resolved a configured styling file.*Rebase and record the resolution as a single-parent/,
    );
    await git(repoRoot, ["reset", "--hard", cleanMergeCommit]);

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
