// Proves the history gate in a disposable Git repository: an empty styling
// commit stays pixel-identical, an approved move matches its manifest, and an
// undeclared regression fails at the commit where it appears.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { PNG } from "pngjs";
import { verifyHistory } from "./verify-history.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const directPixelProducingInputs = [
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
              captures: [
                {
                  themes: ["light", "dark"],
                  viewports: [{}],
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

test("should reject capture coverage narrowed within the verified range", async () => {
  const expandedDocuments = [
    {
      name: "fixture",
      source: "fixture.txt",
      captures: [
        {
          name: "first",
          selector: "article",
          themes: ["light"],
          viewports: [{ name: "desktop", width: 1440, height: 900 }],
          actions: [],
        },
        {
          name: "second",
          selector: "header",
          themes: ["light", "dark"],
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
    const narrowedConfig = {
      ...config,
      documents: [
        {
          ...expandedDocuments[0],
          captures: [expandedDocuments[0].captures[0]],
        },
      ],
    };
    await writeFile(
      configPath,
      `${JSON.stringify(narrowedConfig, null, 2)}\n`,
      "utf8",
    );
    await commit({
      repoRoot,
      subject: "test: narrow capture coverage [visual:empty]",
    });

    await assert.rejects(
      verifyHistory({
        repoRoot,
        base,
        configPath,
        artifactRoot: artifactPath({
          repoRoot,
          name: "narrowed-capture-coverage",
        }),
      }),
      /coverage may be added but not narrowed/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
