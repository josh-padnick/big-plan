// Proves the history gate in a disposable Git repository: an empty styling
// commit stays pixel-identical, an approved move matches its manifest, and an
// undeclared regression fails at the commit where it appears.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { PNG } from "pngjs";
import { availableDocuments } from "./available-documents.mjs";
import {
  capturePlan,
  verifyHistory,
  visualContract,
} from "./verify-history.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const directPixelProducingInputs = [
  "package.json",
  "bun.lock",
  "assets/logo-light.svg",
  "assets/favicon-light.ico",
  "scripts/gen-assets.mjs",
  "scripts/gen-css.mjs",
  "src/icons/lucide/info.ts",
  "src/render/branding.generated.ts",
  "src/render/page.ts",
  "src/render/render-document.ts",
  "src/render/serialize-html.ts",
];

const git = async ({ repoRoot, arguments_ }) => {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: repoRoot,
  });
  return stdout.trim();
};

const commit = async ({ repoRoot, subject }) => {
  await git({ repoRoot, arguments_: ["add", "."] });
  await git({ repoRoot, arguments_: ["commit", "-m", subject] });
  return git({ repoRoot, arguments_: ["rev-parse", "HEAD"] });
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

const artifactPath = ({ repoRoot, name }) =>
  join(repoRoot, "test-results", "style-history", name);

test("reads visual contracts from direct and squash commit messages", () => {
  assert.deepEqual(
    visualContract({
      subject: "style: move the pixel [visual:approved]",
      body: "",
    }),
    {
      kind: "approved",
      subjects: ["style: move the pixel [visual:approved]"],
      squashed: false,
    },
  );
  assert.deepEqual(
    visualContract({
      subject: "Restore component interactions (#66)",
      body: [
        "* fix(shell): restore title [visual:approved]",
        "* test(components): restore fallback [visual:empty]",
      ].join("\n"),
    }),
    {
      kind: "approved",
      subjects: [
        "fix(shell): restore title [visual:approved]",
        "test(components): restore fallback [visual:empty]",
      ],
      squashed: true,
    },
  );
});

test("should select owned components and retain the global safety net", () => {
  const config = {
    schemaVersion: 2,
    capturePolicy: { globalFilePatterns: ["^src/render/"] },
    documents: [
      {
        name: "showcase",
        captures: [
          { name: "document", scope: "full-document" },
          {
            name: "callout",
            scope: "component",
            ownerPatterns: ["^src/components/callout/"],
          },
          {
            name: "wireframe",
            scope: "component",
            ownerPatterns: ["^src/components/wireframe/"],
          },
        ],
      },
    ],
  };
  assert.deepEqual(
    capturePlan({
      config,
      stylingFiles: ["src/components/callout/styles.css"],
      isTip: false,
    }),
    ["showcase/callout"],
  );
  assert.deepEqual(
    capturePlan({
      config,
      stylingFiles: ["src/render/global.generated.ts"],
      isTip: false,
    }),
    ["showcase/document", "showcase/callout", "showcase/wireframe"],
  );
  assert.throws(
    () =>
      capturePlan({
        config,
        stylingFiles: ["src/components/unknown/styles.css"],
        isTip: false,
      }),
    /no component owner/u,
  );
});

const createMinimalRepository = async ({
  stylingFilePatterns = ["^irrelevant\\.txt$"],
  documents = [
    {
      captures: [
        {
          themes: ["light"],
          viewports: [{}],
        },
      ],
    },
  ],
} = {}) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "style-history-test-"));
  await git({ repoRoot, arguments_: ["init", "-b", "main"] });
  await git({
    repoRoot,
    arguments_: ["config", "user.name", "Style History Test"],
  });
  await git({
    repoRoot,
    arguments_: ["config", "user.email", "style-history@example.invalid"],
  });
  await mkdir(join(repoRoot, ".style-snapshots"), { recursive: true });
  await writeFile(join(repoRoot, "fixture.txt"), "fixture\n", "utf8");
  await writeFile(join(repoRoot, "style.txt"), "red\n", "utf8");
  const capture = onePixelPng({ red: 255, green: 0, blue: 0 });
  await writeFile(
    join(repoRoot, "capture.mjs"),
    `import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const output = process.env.STYLE_SNAPSHOT_OUTPUT_DIR;
await mkdir(output, { recursive: true });
await writeFile(join(output, "state.png"), Buffer.from(${JSON.stringify(capture.toString("base64"))}, "base64"));
`,
    "utf8",
  );
  const configPath = join(repoRoot, ".style-snapshots", "config.json");
  const config = {
    schemaVersion: 1,
    fixturePaths: ["fixture.txt"],
    stylingFilePatterns,
    manifestDirectory: ".style-snapshots/manifests",
    captureCommand: ["node", "{harnessRoot}/capture.mjs"],
    documents,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const base = await commit({ repoRoot, subject: "test: establish fixture" });
  return { repoRoot, configPath, config, base };
};

test("should require explicit named animated-surface exemptions", async () => {
  const { repoRoot, configPath, config, base } =
    await createMinimalRepository();
  try {
    const invalidExemptions = [
      {
        value: [],
        message: /must be a non-empty array/u,
      },
      {
        value: [
          {
            name: "",
            selector: "[data-animated]",
            reason: "Transient feedback.",
          },
        ],
        message: /requires a non-empty name/u,
      },
      {
        value: [
          {
            name: "sample-feedback",
            selector: "[data-first]",
            reason: "First transient surface.",
          },
          {
            name: "sample-feedback",
            selector: "[data-second]",
            reason: "Second transient surface.",
          },
        ],
        message: /name "sample-feedback" is duplicated/u,
      },
    ];

    for (const invalid of invalidExemptions) {
      await writeFile(
        configPath,
        `${JSON.stringify(
          { ...config, animatedSurfaceExemptions: invalid.value },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await assert.rejects(
        verifyHistory({
          repoRoot,
          base,
          configPath,
          artifactRoot: artifactPath({
            repoRoot,
            name: "invalid-animated-surface-exemptions",
          }),
        }),
        invalid.message,
      );
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should reject an approved styling commit without a manifest", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    stylingFilePatterns: ["^style\\.txt$"],
  });
  try {
    await writeFile(
      join(repoRoot, "style.txt"),
      "red\napproved move\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "style: claim an approved move [visual:approved]",
    });
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "approved-without-manifest",
        }),
      }),
      /approved commit requires 1 manifest.*Repair this history entry/u,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("excludes bookkeeping merges and their side-only ancestry from the contract", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    stylingFilePatterns: ["^style\\.txt$"],
  });
  try {
    await writeFile(
      join(repoRoot, "style.txt"),
      "red\nbranch-line comment\n",
      "utf8",
    );
    const branchStyleCommit = await commit({
      repoRoot,
      subject: "style: keep red on the branch line [visual:empty]",
    });

    await git({ repoRoot, arguments_: ["checkout", "-b", "recovery", base] });
    await writeFile(
      join(repoRoot, "style.txt"),
      "red\nuncontracted recovery repair\n",
      "utf8",
    );
    const recoveryCommit = await commit({
      repoRoot,
      subject: "no-mistakes(review): repair the pipeline",
    });
    await git({ repoRoot, arguments_: ["checkout", "main"] });
    await git({
      repoRoot,
      arguments_: [
        "merge",
        "-s",
        "ours",
        "recovery",
        "-m",
        "Merge commit 'recovery' into main",
      ],
    });
    const bookkeepingMerge = await git({
      repoRoot,
      arguments_: ["rev-parse", "HEAD"],
    });

    await writeFile(
      join(repoRoot, "style.txt"),
      "red\nbranch-line comment after recovery\n",
      "utf8",
    );
    const tipStyleCommit = await commit({
      repoRoot,
      subject: "style: keep red after the recovery merge [visual:empty]",
    });

    const results = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({ repoRoot, name: "bookkeeping-merge" }),
    });
    const verifiedCommits = results.map((result) => result.commit);
    assert.ok(
      verifiedCommits.includes(branchStyleCommit),
      "the branch-line styling commit before the merge must stay contracted",
    );
    assert.ok(
      verifiedCommits.includes(tipStyleCommit),
      "the branch-line styling commit after the merge must stay contracted",
    );
    assert.ok(
      !verifiedCommits.includes(recoveryCommit),
      "the recovery commit reachable only through the bookkeeping merge must be excluded",
    );
    assert.ok(
      !verifiedCommits.includes(bookkeepingMerge),
      "the bookkeeping merge itself must be excluded",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should stop at the commit whose screenshots exceed its visual contract", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "style-history-test-"));
  try {
    await git({ repoRoot, arguments_: ["init", "-b", "main"] });
    await git({
      repoRoot,
      arguments_: ["config", "user.name", "Style History Test"],
    });
    await git({
      repoRoot,
      arguments_: ["config", "user.email", "style-history@example.invalid"],
    });
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
          documents: [
            {
              captures: [
                {
                  themes: ["light"],
                  viewports: [{}],
                },
              ],
            },
          ],
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
        artifactRoot: artifactPath({
          repoRoot,
          name: "missing-contract",
        }),
      }),
      /styling commits must end with \[visual:empty\] or \[visual:approved\]/,
    );
    await git({
      repoRoot,
      arguments_: [
        "commit",
        "--amend",
        "-m",
        "no-mistakes: apply CI fixes [visual:empty]",
      ],
    });
    const ciRepairCommit = await git({
      repoRoot,
      arguments_: ["rev-parse", "HEAD"],
    });

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

    const passingArtifacts = artifactPath({ repoRoot, name: "passing" });
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
          after: {
            ...pngIdentity(colors.green),
            sha256Alternates: [pngIdentity(colors.blue).sha256],
          },
        },
      ],
    });
    await git({ repoRoot, arguments_: ["add", manifestPath] });
    await git({
      repoRoot,
      arguments_: ["commit", "--amend", "--no-edit"],
    });
    await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({
        repoRoot,
        name: "alternate-approved-raster",
      }),
    });

    await writeManifest({
      ...approvedManifest,
      captureChanges: [
        {
          ...approvedManifest.captureChanges[0],
          after: pngIdentity(colors.green),
        },
      ],
    });
    await git({ repoRoot, arguments_: ["add", manifestPath] });
    await git({
      repoRoot,
      arguments_: ["commit", "--amend", "--no-edit"],
    });
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "mismatched-manifest",
        }),
      }),
      /exact capture evidence does not match the approved manifest/,
    );
    await writeManifest(approvedManifest);
    await git({ repoRoot, arguments_: ["add", manifestPath] });
    await git({
      repoRoot,
      arguments_: ["commit", "--amend", "--no-edit"],
    });

    await git({
      repoRoot,
      arguments_: ["checkout", "-b", "style-feature"],
    });
    await writeFile(
      join(repoRoot, "style.txt"),
      "blue\ncomment-only branch change\n",
      "utf8",
    );
    const featureCommit = await commit({
      repoRoot,
      subject: "style: preserve blue on a feature branch [visual:empty]",
    });
    await git({ repoRoot, arguments_: ["checkout", "main"] });
    await writeFile(join(repoRoot, "main-only.txt"), "advance main\n", "utf8");
    await commit({
      repoRoot,
      subject: "chore: advance main without styling changes",
    });
    await git({
      repoRoot,
      arguments_: [
        "merge",
        "--no-ff",
        "style-feature",
        "-m",
        "Merge pull request #1 from example/style-feature",
      ],
    });
    const mergedPassing = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({ repoRoot, name: "merged" }),
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

    const cleanMergeCommit = await git({
      repoRoot,
      arguments_: ["rev-parse", "HEAD"],
    });
    await git({
      repoRoot,
      arguments_: ["checkout", "-b", "conflicting-style-feature"],
    });
    await writeFile(
      join(repoRoot, "style.txt"),
      "blue\nconflicting feature comment\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "style: edit feature commentary [visual:empty]",
    });
    await git({ repoRoot, arguments_: ["checkout", "main"] });
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
      git({
        repoRoot,
        arguments_: [
          "merge",
          "--no-ff",
          "conflicting-style-feature",
          "-m",
          "Merge pull request #2 from example/conflicting-style-feature",
        ],
      }),
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
        artifactRoot: artifactPath({
          repoRoot,
          name: "conflicting-merge",
        }),
      }),
      /merge commit resolved a configured styling file.*Rebase and record the resolution as a single-parent/,
    );
    await git({
      repoRoot,
      arguments_: ["reset", "--hard", cleanMergeCommit],
    });

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
        artifactRoot: artifactPath({ repoRoot, name: "failing" }),
      }),
      /expected zero changed pixels; observed state\.png \(1 changed pixels\)/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("reports every visual-contract failure from one run", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    stylingFilePatterns: ["^style\\.txt$"],
  });
  try {
    const colors = {
      red: onePixelPng({ red: 255, green: 0, blue: 0 }),
      blue: onePixelPng({ red: 0, green: 0, blue: 255 }),
      green: onePixelPng({ red: 0, green: 255, blue: 0 }),
    };
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const style = (await readFile(join(process.env.STYLE_SNAPSHOT_CHECKOUT, "style.txt"), "utf8")).split(/\\s/)[0];
const colors = ${JSON.stringify(
        Object.fromEntries(
          Object.entries(colors).map(([name, value]) => [
            name,
            value.toString("base64"),
          ]),
        ),
      )};
await mkdir(process.env.STYLE_SNAPSHOT_OUTPUT_DIR, { recursive: true });
await writeFile(join(process.env.STYLE_SNAPSHOT_OUTPUT_DIR, "state.png"), Buffer.from(colors[style], "base64"));
`,
      "utf8",
    );
    await writeFile(join(repoRoot, "style.txt"), "blue\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: blue without approval [visual:empty]",
    });
    await writeFile(join(repoRoot, "style.txt"), "green\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: green without approval [visual:empty]",
    });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({ repoRoot, name: "aggregate-failures" }),
      }),
      (error) =>
        /verification failed for 2 commits/u.test(error.message) &&
        error.message.indexOf("style: blue without approval") <
          error.message.indexOf("style: green without approval"),
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("reuses receipts for an unchanged tree prefix and invalidates changed trees", async () => {
  const { repoRoot, configPath, config, base } = await createMinimalRepository({
    stylingFilePatterns: ["^style\\.txt$"],
  });
  const receiptDirectory = join(repoRoot, "receipts");
  const previousReceiptDirectory = process.env.STYLE_HISTORY_RECEIPT_DIR;
  const previousAuthority = process.env.STYLE_HISTORY_PIXEL_AUTHORITY_CLASS;
  process.env.STYLE_HISTORY_RECEIPT_DIR = receiptDirectory;
  process.env.STYLE_HISTORY_PIXEL_AUTHORITY_CLASS = "local";
  try {
    const colors = {
      red: onePixelPng({ red: 255, green: 0, blue: 0 }),
      blue: onePixelPng({ red: 0, green: 0, blue: 255 }),
    };
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const style = (await readFile(join(process.env.STYLE_SNAPSHOT_CHECKOUT, "style.txt"), "utf8")).split(/\\s/)[0];
const colors = ${JSON.stringify(
        Object.fromEntries(
          Object.entries(colors).map(([name, value]) => [
            name,
            value.toString("base64"),
          ]),
        ),
      )};
await mkdir(process.env.STYLE_SNAPSHOT_OUTPUT_DIR, { recursive: true });
await mkdir(process.env.STYLE_HISTORY_RECEIPT_DIR, { recursive: true });
await appendFile(join(process.env.STYLE_HISTORY_RECEIPT_DIR, "capture-count"), "1\\n");
await writeFile(join(process.env.STYLE_SNAPSHOT_OUTPUT_DIR, "state.png"), Buffer.from(colors[style], "base64"));
`,
      "utf8",
    );
    await writeFile(join(repoRoot, "style.txt"), "red\ncomment one\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: preserve red one [visual:empty]",
    });
    await writeFile(join(repoRoot, "style.txt"), "red\ncomment two\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: preserve red two [visual:empty]",
    });
    await writeFile(join(repoRoot, "style.txt"), "blue\n", "utf8");
    const changedCommit = await commit({
      repoRoot,
      subject: "style: blue without approval [visual:empty]",
    });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({ repoRoot, name: "receipt-first" }),
      }),
      /expected zero changed pixels/u,
    );
    const firstCount = (
      await readFile(join(receiptDirectory, "capture-count"), "utf8")
    )
      .trim()
      .split("\n").length;
    const receipts = JSON.parse(
      await readFile(join(receiptDirectory, "receipts.json"), "utf8"),
    );
    assert.equal(Object.keys(receipts.receipts).length, 2);

    await writeFile(join(repoRoot, "style.txt"), "red\n", "utf8");
    await git({
      repoRoot,
      arguments_: ["add", "style.txt"],
    });
    await git({
      repoRoot,
      arguments_: [
        "commit",
        "--amend",
        "-m",
        "style: restore red after rerun [visual:empty]",
      ],
    });
    const rerun = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({ repoRoot, name: "receipt-second" }),
    });
    const secondCount = (
      await readFile(join(receiptDirectory, "capture-count"), "utf8")
    )
      .trim()
      .split("\n").length;
    assert.equal(rerun.length, 3);
    assert.equal(rerun[0].cached, true);
    assert.equal(rerun[1].cached, true);
    assert.equal(secondCount - firstCount, 2);
    assert.notEqual(changedCommit, rerun[2].commit);

    const fullHead = await git({ repoRoot, arguments_: ["rev-parse", "HEAD"] });
    await git({
      repoRoot,
      arguments_: ["reset", "--hard", rerun[1].commit],
    });
    const rewound = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({ repoRoot, name: "receipt-tip-rewind" }),
    });
    const tipRewindCount = (
      await readFile(join(receiptDirectory, "capture-count"), "utf8")
    )
      .trim()
      .split("\n").length;
    assert.equal(rewound.length, 2);
    assert.equal(rewound[0].cached, true);
    assert.notEqual(rewound[1].cached, true);
    assert.equal(
      tipRewindCount - secondCount,
      2,
      "a mid-branch receipt must not stand in for tip-scope verification",
    );
    await git({ repoRoot, arguments_: ["reset", "--hard", fullHead] });

    await writeFile(
      configPath,
      `${JSON.stringify(
        { ...config, stylingFilePatterns: ["^style\\.txt$", "^other\\.txt$"] },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({ repoRoot, name: "receipt-policy-change" }),
    });
    const policyChangeCount = (
      await readFile(join(receiptDirectory, "capture-count"), "utf8")
    )
      .trim()
      .split("\n").length;
    assert.equal(policyChangeCount - tipRewindCount, 4);
  } finally {
    if (previousReceiptDirectory === undefined) {
      delete process.env.STYLE_HISTORY_RECEIPT_DIR;
    } else {
      process.env.STYLE_HISTORY_RECEIPT_DIR = previousReceiptDirectory;
    }
    if (previousAuthority === undefined) {
      delete process.env.STYLE_HISTORY_PIXEL_AUTHORITY_CLASS;
    } else {
      process.env.STYLE_HISTORY_PIXEL_AUTHORITY_CLASS = previousAuthority;
    }
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should retain relevance from every config revision", async () => {
  const { repoRoot, configPath, config, base } = await createMinimalRepository({
    stylingFilePatterns: ["^custom-pixel\\.txt$"],
  });
  try {
    await writeFile(
      configPath,
      `${JSON.stringify(
        { ...config, stylingFilePatterns: ["^irrelevant\\.txt$"] },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "test: narrow mutable relevance [visual:empty]",
    });
    await writeFile(join(repoRoot, "custom-pixel.txt"), "changed\n", "utf8");
    await commit({ repoRoot, subject: "test: omit the visual contract" });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "relevance-floor",
        }),
      }),
      /styling commits must end with \[visual:empty\] or \[visual:approved\]/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should derive fixture relevance from every document source", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    documents: [
      {
        name: "derived-fixture",
        source: "derived-fixture.txt",
        captures: [
          {
            name: "document",
            selector: "article",
            themes: ["light"],
            viewports: [{ name: "desktop", width: 1440, height: 900 }],
            actions: [],
          },
        ],
      },
    ],
  });
  try {
    await writeFile(
      join(repoRoot, "derived-fixture.txt"),
      "initial fixture\n",
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "test: establish derived fixture [visual:empty]",
    });
    await writeFile(
      join(repoRoot, "derived-fixture.txt"),
      "changed fixture\n",
      "utf8",
    );
    await commit({ repoRoot, subject: "test: omit the visual contract" });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "derived-fixture-relevance",
        }),
      }),
      /styling commits must end with \[visual:empty\] or \[visual:approved\]/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should retain relevance when a covered source is renamed", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository();
  try {
    const componentDirectory = join(repoRoot, "src", "components", "example");
    const coveredPath = join(componentDirectory, "view.tsx");
    await mkdir(componentDirectory, { recursive: true });
    await writeFile(coveredPath, "export const view = true;\n", "utf8");
    await commit({
      repoRoot,
      subject: "test: establish covered view [visual:empty]",
    });
    await git({
      repoRoot,
      arguments_: ["config", "diff.renames", "true"],
    });
    await git({
      repoRoot,
      arguments_: [
        "mv",
        "src/components/example/view.tsx",
        "src/components/example/presenter.tsx",
      ],
    });
    await commit({ repoRoot, subject: "test: omit the visual contract" });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "renamed-source-relevance",
        }),
      }),
      /styling commits must end with \[visual:empty\] or \[visual:approved\]/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should classify every direct pixel-producing input as relevant", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository();
  try {
    for (const path of directPixelProducingInputs) {
      await git({ repoRoot, arguments_: ["reset", "--hard", base] });
      await mkdir(join(repoRoot, path, ".."), { recursive: true });
      await writeFile(join(repoRoot, path), "pixel input\n", "utf8");
      await commit({ repoRoot, subject: `test: change ${path}` });
      await assert.rejects(
        verifyHistory({
          repoRoot,
          base,
          configPath,
          artifactRoot: artifactPath({
            repoRoot,
            name: `pixel-input-${path.replaceAll("/", "-")}`,
          }),
        }),
        /styling commits must end with \[visual:empty\] or \[visual:approved\]/,
      );
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should configure every direct pixel-producing input as relevant", async () => {
  const config = JSON.parse(
    await readFile(
      join(repositoryRoot, ".style-snapshots", "config.json"),
      "utf8",
    ),
  );
  const patterns = config.stylingFilePatterns.map(
    (pattern) => new RegExp(pattern),
  );

  for (const path of directPixelProducingInputs) {
    assert.ok(
      patterns.some((pattern) => pattern.test(path)),
      "Active style snapshot config must include " + path,
    );
  }
});

test("should reject artifact cleanup outside the disposable evidence root", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository();
  try {
    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: repoRoot,
      }),
      /artifacts must stay under test-results\/style-history/,
    );
    assert.equal(
      JSON.parse(await readFile(configPath, "utf8")).schemaVersion,
      1,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should reject a styling conflict resolved to one parent's version", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    stylingFilePatterns: ["^style\\.txt$"],
  });
  try {
    await git({
      repoRoot,
      arguments_: ["checkout", "-b", "style-feature"],
    });
    await writeFile(join(repoRoot, "style.txt"), "blue\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: change feature color [visual:empty]",
    });
    await git({ repoRoot, arguments_: ["checkout", "main"] });
    await writeFile(join(repoRoot, "style.txt"), "green\n", "utf8");
    await commit({
      repoRoot,
      subject: "style: change main color [visual:empty]",
    });
    await assert.rejects(
      git({
        repoRoot,
        arguments_: [
          "merge",
          "--no-ff",
          "style-feature",
          "-m",
          "Merge pull request #3 from example/style-feature",
        ],
      }),
    );
    await writeFile(join(repoRoot, "style.txt"), "blue\n", "utf8");
    await commit({
      repoRoot,
      subject: "Merge pull request #3 from example/style-feature",
    });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "parent-equal-merge",
        }),
      }),
      /merge commit resolved a configured styling file.*Rebase and record the resolution as a single-parent/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should validate final HEAD capture completeness unconditionally", async () => {
  const { repoRoot, configPath, config, base } =
    await createMinimalRepository();
  try {
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...config,
          documents: [
            {
              ...config.documents[0],
              captures: [
                config.documents[0].captures[0],
                {
                  name: "additional",
                  selector: "article",
                  themes: ["light"],
                  viewports: [{}],
                  actions: [],
                },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "test: add an incomplete capture [visual:empty]",
    });
    await writeFile(join(repoRoot, "non-style.txt"), "advance HEAD\n", "utf8");
    await commit({ repoRoot, subject: "test: advance HEAD" });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "head-completeness",
        }),
      }),
      /Final style fixture produced 1 of 2 configured captures/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should require every configured viewport and theme at HEAD", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    documents: [
      {
        name: "sample",
        source: "fixture.txt",
        captures: [
          {
            name: "document",
            selector: "article",
            themes: ["light", "dark"],
            viewports: [{ name: "desktop", width: 1440, height: 900 }],
            actions: [],
          },
        ],
      },
    ],
  });
  try {
    const capture = onePixelPng({ red: 255, green: 0, blue: 0 });
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const output = process.env.STYLE_SNAPSHOT_OUTPUT_DIR;
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "sample__document__desktop__light.png"),
  Buffer.from(${JSON.stringify(capture.toString("base64"))}, "base64"),
);
await writeFile(
  join(output, "capture-manifest.json"),
  JSON.stringify({
    schemaVersion: 1,
    selectedCaptureKeys: JSON.parse(process.env.STYLE_SNAPSHOT_CAPTURE_KEYS ?? "[]"),
    captures: [
      {
        key: "sample/document",
        viewport: "desktop",
        theme: "light",
        path: "sample__document__desktop__light.png",
      },
    ],
  }),
);
`,
      "utf8",
    );
    await commit({ repoRoot, subject: "test: capture only the light theme" });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "head-theme-coverage",
        }),
      }),
      /did not produce a visible target for sample\/document at desktop\/dark/u,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should reject empty capture configuration dimensions", async () => {
  const { repoRoot, configPath, config, base } =
    await createMinimalRepository();
  try {
    const invalidConfigs = [
      {
        name: "documents",
        config: { ...config, documents: [] },
      },
      {
        name: "captures",
        config: { ...config, documents: [{ captures: [] }] },
      },
      {
        name: "themes",
        config: {
          ...config,
          documents: [{ captures: [{ themes: [], viewports: [{}] }] }],
        },
      },
      {
        name: "viewports",
        config: {
          ...config,
          documents: [{ captures: [{ themes: ["light"], viewports: [] }] }],
        },
      },
    ];

    for (const invalid of invalidConfigs) {
      await writeFile(
        configPath,
        `${JSON.stringify(invalid.config, null, 2)}\n`,
        "utf8",
      );
      await assert.rejects(
        verifyHistory({
          repoRoot,
          base,
          configPath,
          artifactRoot: artifactPath({
            repoRoot,
            name: `empty-${invalid.name}`,
          }),
        }),
        new RegExp(`requires non-empty ${invalid.name}`),
      );
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should reject changed merge-base capture definitions", async () => {
  const expandedDocuments = [
    {
      name: "fixture",
      source: "fixture.txt",
      captures: [
        {
          name: "first",
          selector: "article",
          themes: ["light", "dark"],
          viewports: [
            {
              name: "desktop",
              width: 1440,
              height: 900,
              deviceScaleFactor: 1,
            },
          ],
          actions: [
            { type: "click", selector: "[data-first]" },
            { type: "click", selector: "[data-second]" },
          ],
        },
        {
          name: "second",
          selector: "header",
          themes: ["light"],
          viewports: [{ name: "phone", width: 390, height: 844 }],
          actions: [],
        },
      ],
    },
  ];
  const { repoRoot, configPath, config, base } = await createMinimalRepository({
    documents: expandedDocuments,
  });
  try {
    const mutations = [
      {
        name: "document-source",
        apply: (documents) => {
          documents[0].source = "replacement-fixture.txt";
        },
      },
      {
        name: "selector",
        apply: (documents) => {
          documents[0].captures[0].selector = "header";
        },
      },
      {
        name: "ordered-actions",
        apply: (documents) => {
          documents[0].captures[0].actions.reverse();
        },
      },
      {
        name: "themes",
        apply: (documents) => {
          documents[0].captures[0].themes = ["light"];
        },
      },
      {
        name: "complete-viewport",
        apply: (documents) => {
          documents[0].captures[0].viewports[0].deviceScaleFactor = 2;
        },
      },
      {
        name: "removed-capture",
        apply: (documents) => {
          documents[0].captures = [documents[0].captures[0]];
        },
      },
    ];

    for (const mutation of mutations) {
      await git({
        repoRoot,
        arguments_: ["reset", "--hard", base],
      });
      const documents = structuredClone(expandedDocuments);
      mutation.apply(documents);
      await writeFile(
        configPath,
        `${JSON.stringify({ ...config, documents }, null, 2)}\n`,
        "utf8",
      );
      await commit({
        repoRoot,
        subject: `test: change ${mutation.name} [visual:empty]`,
      });

      await assert.rejects(
        verifyHistory({
          repoRoot,
          base,
          configPath,
          artifactRoot: artifactPath({
            repoRoot,
            name: `changed-capture-${mutation.name}`,
          }),
        }),
        /existing definitions are immutable and additions require new capture keys/,
      );
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should allow capture evolution after a config-free merge base", async () => {
  const initialDocuments = [
    {
      name: "sample",
      source: "fixture.txt",
      captures: [
        {
          name: "document",
          selector: "article",
          themes: ["light"],
          viewports: [{ name: "desktop", width: 1440, height: 900 }],
          actions: [],
        },
      ],
    },
  ];
  const { repoRoot, configPath, config } = await createMinimalRepository({
    documents: initialDocuments,
  });
  try {
    await git({
      repoRoot,
      arguments_: ["rm", ".style-snapshots/config.json"],
    });
    const base = await commit({
      repoRoot,
      subject: "test: establish config-free merge base",
    });
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await commit({
      repoRoot,
      subject: "test: introduce sample capture [visual:empty]",
    });
    const finalDocuments = structuredClone(initialDocuments);
    finalDocuments[0].name = "components";
    finalDocuments[0].captures[0].name = "full-document";
    await writeFile(
      configPath,
      `${JSON.stringify({ ...config, documents: finalDocuments }, null, 2)}\n`,
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "test: replace sample capture matrix [visual:empty]",
    });

    const results = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({
        repoRoot,
        name: "config-evolution",
      }),
    });
    assert.equal(results.length, 2);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should preserve absent-before evidence for a new fixture", async () => {
  const existingDocument = {
    name: "existing",
    source: "fixture.txt",
    captures: [
      {
        name: "document",
        selector: "article",
        themes: ["light"],
        viewports: [{ name: "desktop", width: 1440, height: 900 }],
        actions: [],
      },
    ],
  };
  const { repoRoot, configPath, config, base } = await createMinimalRepository({
    documents: [existingDocument],
  });
  try {
    const helperUrl = pathToFileURL(
      join(
        repositoryRoot,
        "scripts",
        "style-snapshots",
        "available-documents.mjs",
      ),
    ).href;
    const capture = onePixelPng({ red: 255, green: 0, blue: 0 });
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { availableDocuments } from ${JSON.stringify(helperUrl)};
const checkout = process.env.STYLE_SNAPSHOT_CHECKOUT;
const output = process.env.STYLE_SNAPSHOT_OUTPUT_DIR;
const config = JSON.parse(await readFile(process.env.STYLE_SNAPSHOT_CONFIG, "utf8"));
await mkdir(output, { recursive: true });
for (const document of await availableDocuments({ checkout, documents: config.documents })) {
  await writeFile(
    join(output, document.name + "__document__desktop__light.png"),
    Buffer.from(${JSON.stringify(capture.toString("base64"))}, "base64"),
  );
}
`,
      "utf8",
    );
    const addedDocument = {
      ...existingDocument,
      name: "added",
      source: "added-fixture.txt",
    };
    await writeFile(
      join(repoRoot, "added-fixture.txt"),
      "added fixture\n",
      "utf8",
    );
    await writeFile(
      configPath,
      `${JSON.stringify(
        { ...config, documents: [existingDocument, addedDocument] },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const fixtureCommit = await commit({
      repoRoot,
      subject: "test: add fixture capture [visual:empty]",
    });
    const artifacts = artifactPath({
      repoRoot,
      name: "new-fixture-before-null",
    });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifacts,
      }),
      /added__document__desktop__light\.png \(1 changed pixels\)/,
    );
    const evidence = JSON.parse(
      await readFile(
        join(artifacts, fixtureCommit.slice(0, 12), "evidence.json"),
        "utf8",
      ),
    );
    const addedCapture = evidence.captures.find(
      (entry) => entry.capture === "added__document__desktop__light.png",
    );
    assert.equal(addedCapture.before, null);
    assert.match(addedCapture.after.sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should skip only documents missing from a historical checkout", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "capture-source-test-"));
  try {
    await writeFile(join(repoRoot, "present.mdx"), "present\n", "utf8");
    const present = { name: "present", source: "present.mdx" };
    const missing = { name: "missing", source: "missing.mdx" };

    assert.deepEqual(
      await availableDocuments({
        checkout: repoRoot,
        documents: [present, missing],
      }),
      [present],
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should allow initial capture configuration after the merge base", async () => {
  const { repoRoot, configPath, config } = await createMinimalRepository();
  try {
    await git({
      repoRoot,
      arguments_: ["rm", ".style-snapshots/config.json"],
    });
    const base = await commit({
      repoRoot,
      subject: "test: establish config-free merge base",
    });
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await commit({
      repoRoot,
      subject: "test: introduce capture config [visual:empty]",
    });

    const results = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({
        repoRoot,
        name: "initial-capture-config",
      }),
    });
    assert.equal(results.length, 1);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("should tile a masked full-document capture below the viewport", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "style-history-capture-regression-"),
  );
  try {
    await execFileAsync(
      process.execPath,
      [join(repositoryRoot, "scripts", "style-snapshots", "capture.mjs")],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          STYLE_SNAPSHOT_CHECKOUT: repositoryRoot,
          STYLE_SNAPSHOT_OUTPUT_DIR: outputDirectory,
          STYLE_SNAPSHOT_CONFIG: join(
            repositoryRoot,
            ".style-snapshots",
            "config.json",
          ),
          STYLE_SNAPSHOT_HARNESS_ROOT: outputDirectory,
          STYLE_SNAPSHOT_CAPTURE_KEYS: JSON.stringify([
            "all-components/full-document",
          ]),
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    const captureManifest = JSON.parse(
      await readFile(join(outputDirectory, "capture-manifest.json"), "utf8"),
    );
    assert.equal(captureManifest.captures.length, 4);
    const widths = { desktop: [], phone: [] };
    for (const entry of captureManifest.captures) {
      const image = PNG.sync.read(
        await readFile(join(outputDirectory, entry.path)),
      );
      assert.ok(
        image.height > 900,
        `${entry.path} must include content below one viewport`,
      );
      widths[entry.viewport].push(image.width);
    }
    for (const desktopWidth of widths.desktop) {
      for (const phoneWidth of widths.phone) {
        assert.ok(
          desktopWidth > phoneWidth,
          `desktop capture width ${desktopWidth} must exceed phone capture width ${phoneWidth}; a narrower desktop means isolation restore squeezed the layout`,
        );
      }
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("should capture each unique SHA at configured bounded concurrency", async () => {
  const { repoRoot, configPath, base } = await createMinimalRepository({
    stylingFilePatterns: ["^style\\.txt$"],
  });
  try {
    const capture = onePixelPng({ red: 255, green: 0, blue: 0 });
    const encodedCapture = capture.toString("base64");
    const requestedConcurrency = Number.parseInt(
      process.env.STYLE_HISTORY_CAPTURE_CONCURRENCY ?? "4",
      10,
    );
    const expectedConcurrency = Number.isInteger(requestedConcurrency)
      ? Math.min(4, Math.max(1, requestedConcurrency))
      : 4;
    await writeFile(
      join(repoRoot, "capture.mjs"),
      `import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const checkout = process.env.STYLE_SNAPSHOT_CHECKOUT;
const output = process.env.STYLE_SNAPSHOT_OUTPUT_DIR;
const logPath = join(process.env.STYLE_SNAPSHOT_HARNESS_ROOT, "capture-events.log");
await appendFile(logPath, "start:" + basename(checkout) + "\\n");
const deadline = Date.now() + 5000;
while (Date.now() < deadline) {
  const events = (await readFile(logPath, "utf8")).trim().split("\\n");
  const active =
    events.filter((event) => event.startsWith("start:")).length -
    events.filter((event) => event.startsWith("end:")).length;
  if (active >= ${expectedConcurrency}) {
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}
await mkdir(output, { recursive: true });
await writeFile(join(output, "state.png"), Buffer.from(${JSON.stringify(encodedCapture)}, "base64"));
await appendFile(logPath, "end:" + basename(checkout) + "\\n");
`,
      "utf8",
    );
    for (const index of [1, 2, 3]) {
      await writeFile(
        join(repoRoot, "style.txt"),
        `red\ncomment ${index}\n`,
        "utf8",
      );
      await commit({
        repoRoot,
        subject: `style: preserve the red pixel ${index} [visual:empty]`,
      });
    }

    const results = await verifyHistory({
      repoRoot,
      base,
      configPath,
      artifactRoot: artifactPath({
        repoRoot,
        name: "bounded-capture-concurrency",
      }),
    });
    assert.equal(results.length, 3);

    const events = (
      await readFile(join(repoRoot, "capture-events.log"), "utf8")
    )
      .trim()
      .split("\n");
    assert.equal(
      events.filter((event) => event.startsWith("start:")).length,
      4,
      "the base and three commits must each be captured once",
    );
    let activeCaptures = 0;
    let maximumActiveCaptures = 0;
    for (const event of events) {
      activeCaptures += event.startsWith("start:") ? 1 : -1;
      maximumActiveCaptures = Math.max(maximumActiveCaptures, activeCaptures);
    }
    assert.equal(maximumActiveCaptures, expectedConcurrency);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
