// Replays styling commits against their parents and enforces each commit's
// declared visual contract: exact pixel identity or an approved move manifest.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import {
  DETERMINISM_FLAGS,
  environmentFingerprint,
  environmentLabel,
  sameEnvironment,
  sameRunnerEnvironment,
} from "./environment.mjs";

const execFileAsync = promisify(execFile);
const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CAPTURE_CONCURRENCY = 4;
const MAX_CAPTURE_CONCURRENCY = 4;

const RELEVANCE_FLOOR = {
  fixturePaths: ["examples/mdx-components.mdx", "examples/deck.mdx"],
  stylingFilePatterns: [
    "^\\.style-snapshots/config\\.json$",
    "^bun\\.lock$",
    "^package\\.json$",
    "^assets/(?:logo-(?:light|dark)\\.svg|favicon-(?:light|dark)\\.ico)$",
    "^scripts/gen-assets\\.mjs$",
    "^scripts/gen-css\\.mjs$",
    "^src/.*\\.css$",
    "^src/components/(?:.*/)?view[^/]*\\.tsx$",
    "^src/components/_shared/.*\\.tsx$",
    "^src/icons/lucide/.*\\.ts$",
    "^src/render/branding\\.generated\\.ts$",
    "^src/render/global\\.generated\\.ts$",
    "^src/render/page\\.ts$",
    "^src/render/render-document\\.ts$",
    "^src/render/serialize-html\\.ts$",
    "^src/render/(?:markdown|shell)/.*\\.ts$",
  ],
};

/** Runs a command and returns trimmed stdout with a useful failure boundary. */
const run = async ({ command, args, cwd, env = process.env, timeout }) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env,
    maxBuffer: 50 * 1024 * 1024,
    timeout,
  });
  return stdout.trim();
};

/** Reads the bounded capture concurrency from the local environment. */
const captureConcurrency = () => {
  const configured = Number.parseInt(
    process.env.STYLE_HISTORY_CAPTURE_CONCURRENCY ?? "",
    10,
  );
  if (!Number.isInteger(configured)) {
    return DEFAULT_CAPTURE_CONCURRENCY;
  }
  return Math.min(MAX_CAPTURE_CONCURRENCY, Math.max(1, configured));
};

/** Reads the visual contract from a subject or a GitHub squash body. */
export const visualContract = ({ subject, body }) => {
  const subjectKind = subject.match(/\[visual:(empty|approved)\]$/)?.[1];
  if (subjectKind !== undefined) {
    return {
      kind: subjectKind,
      subjects: [subject],
      squashed: false,
    };
  }
  const subjects = [
    ...body.matchAll(/^\* (.*?\[visual:(empty|approved)\])$/gm),
  ].map((match) => match[1]);
  if (subjects.some((value) => value.endsWith("[visual:approved]"))) {
    return {
      kind: "approved",
      subjects,
      squashed: true,
    };
  }
  return subjects.length > 0
    ? { kind: "empty", subjects, squashed: true }
    : undefined;
};

/** Runs asynchronous work in a small serial queue. */
const createSerialQueue = () => {
  let tail = Promise.resolve();
  return async (operation) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
};

/** Captures each requested SHA once while keeping failures deterministic. */
const captureCommits = async ({ commits, captureCommit, concurrency }) => {
  let nextIndex = 0;
  const failures = [];
  const worker = async () => {
    while (nextIndex < commits.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        await captureCommit(commits[index]);
      } catch (error) {
        failures.push({ error, index });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, commits.length) }, () =>
      worker(),
    ),
  );
  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index);
    throw new Error(
      [
        `Style history capture failed for ${failures.length} commit${failures.length === 1 ? "" : "s"}.`,
        ...failures.map(
          ({ error, index }) =>
            `- ${commits[index]}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ].join("\n"),
      { cause: failures[0].error },
    );
  }
};

/** Validates the stable surface of one screenshot configuration revision. */
const parseConfig = (source) => {
  const config = JSON.parse(source);
  if (![1, 2].includes(config.schemaVersion)) {
    throw new Error("Style screenshot config must use schemaVersion 1 or 2.");
  }
  for (const field of [
    "fixturePaths",
    "stylingFilePatterns",
    "captureCommand",
    "documents",
  ]) {
    if (!Array.isArray(config[field]) || config[field].length === 0) {
      throw new Error(`Style screenshot config requires non-empty ${field}.`);
    }
  }
  for (const [documentIndex, document] of config.documents.entries()) {
    if (!Array.isArray(document.captures) || document.captures.length === 0) {
      throw new Error(
        `Style screenshot config document ${documentIndex + 1} requires non-empty captures.`,
      );
    }
    for (const [captureIndex, capture] of document.captures.entries()) {
      for (const field of ["themes", "viewports"]) {
        if (!Array.isArray(capture[field]) || capture[field].length === 0) {
          throw new Error(
            `Style screenshot config document ${documentIndex + 1} capture ${captureIndex + 1} requires non-empty ${field}.`,
          );
        }
      }
      if (
        capture.multiple !== undefined &&
        typeof capture.multiple !== "boolean"
      ) {
        throw new Error(
          `Style screenshot document ${documentIndex + 1} capture ${captureIndex + 1} multiple must be boolean when present.`,
        );
      }
      if (
        capture.scope !== undefined &&
        !["component", "full-document"].includes(capture.scope)
      ) {
        throw new Error(
          `Style screenshot document ${documentIndex + 1} capture ${captureIndex + 1} scope must be component or full-document.`,
        );
      }
      if (capture.scope === "component") {
        if (
          !Array.isArray(capture.ownerPatterns) ||
          capture.ownerPatterns.length === 0 ||
          capture.ownerPatterns.some(
            (pattern) => typeof pattern !== "string" || pattern.length === 0,
          )
        ) {
          throw new Error(
            `Style screenshot document ${documentIndex + 1} component capture ${captureIndex + 1} requires non-empty ownerPatterns.`,
          );
        }
      }
    }
  }
  if (
    typeof config.manifestDirectory !== "string" ||
    config.manifestDirectory.length === 0
  ) {
    throw new Error("Style screenshot config requires manifestDirectory.");
  }
  if (config.animatedSurfaceExemptions !== undefined) {
    if (
      !Array.isArray(config.animatedSurfaceExemptions) ||
      config.animatedSurfaceExemptions.length === 0
    ) {
      throw new Error(
        "Style screenshot animatedSurfaceExemptions must be a non-empty array when present.",
      );
    }
    const names = new Set();
    for (const exemption of config.animatedSurfaceExemptions) {
      for (const field of ["name", "selector", "reason"]) {
        if (
          typeof exemption[field] !== "string" ||
          exemption[field].trim() === ""
        ) {
          throw new Error(
            `Style screenshot animated-surface exemption requires a non-empty ${field}.`,
          );
        }
      }
      if (names.has(exemption.name)) {
        throw new Error(
          `Style screenshot animated-surface exemption name "${exemption.name}" is duplicated.`,
        );
      }
      names.add(exemption.name);
    }
  }
  if (config.schemaVersion === 2) {
    if (
      config.capturePolicy === undefined ||
      !Array.isArray(config.capturePolicy.globalFilePatterns) ||
      config.capturePolicy.globalFilePatterns.length === 0 ||
      config.capturePolicy.globalFilePatterns.some(
        (pattern) => typeof pattern !== "string" || pattern.length === 0,
      )
    ) {
      throw new Error(
        "Style screenshot schemaVersion 2 requires non-empty capturePolicy.globalFilePatterns.",
      );
    }
    const scopedCaptures = config.documents.flatMap((document) =>
      document.captures.filter((capture) => capture.scope !== undefined),
    );
    if (
      scopedCaptures.length === 0 ||
      scopedCaptures.some(
        (capture) => capture.scope === "full-document" && capture.multiple,
      )
    ) {
      throw new Error(
        "Style screenshot schemaVersion 2 requires scoped captures and single full-document targets.",
      );
    }
  }
  if (config.captureEnvironment !== undefined) {
    if (
      typeof config.captureEnvironment !== "object" ||
      config.captureEnvironment === null ||
      typeof config.captureEnvironment.authorityClass !== "string" ||
      config.captureEnvironment.authorityClass.trim() === ""
    ) {
      throw new Error(
        "Style screenshot captureEnvironment requires a non-empty authorityClass.",
      );
    }
  }
  return config;
};

/** Produces stable JSON while preserving order where configuration order matters. */
const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

const configFingerprint = (config) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(config)))
    .digest("hex");

const receiptKey = ({ parentTree, commitTree }) =>
  `${parentTree}:${commitTree}`;

const readReceiptStore = async (directory) => {
  try {
    const store = JSON.parse(
      await readFile(join(directory, "receipts.json"), "utf8"),
    );
    return store.schemaVersion === 1 &&
      store.receipts !== null &&
      typeof store.receipts === "object"
      ? store
      : { schemaVersion: 1, receipts: {} };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return { schemaVersion: 1, receipts: {} };
    }
    throw error;
  }
};

const writeReceiptStore = async (directory, store) => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "receipts.json"),
    `${JSON.stringify(store, null, 2)}\n`,
    "utf8",
  );
};

const currentEnvironment = async ({ repoRoot }) => {
  const browser = await chromium.launch({
    headless: true,
    args: DETERMINISM_FLAGS,
  });
  try {
    return environmentFingerprint({
      browserVersion: browser.version(),
      fontRoot: join(repoRoot, "assets", "fonts"),
      authorityClass:
        process.env.STYLE_HISTORY_PIXEL_AUTHORITY_CLASS ??
        (process.env.CI === "true" ? "ci-runner" : "local"),
    });
  } finally {
    await browser.close();
  }
};

/** Indexes the complete rendering contract for each named capture. */
const captureDefinitions = (config) => {
  const definitions = new Map();
  for (const document of config.documents) {
    for (const capture of document.captures) {
      const key = JSON.stringify([document.name, capture.name]);
      if (definitions.has(key)) {
        throw new Error(
          `Style screenshot config contains duplicate capture key ${key}.`,
        );
      }
      const { themes, viewports, ...orderedCapture } = capture;
      const normalizedViewports = viewports
        .map((viewport) => canonicalize(viewport))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      definitions.set(
        key,
        JSON.stringify(
          canonicalize({
            documentSource: document.source,
            capture: {
              ...orderedCapture,
              themes: [...themes].sort(),
              viewports: normalizedViewports,
            },
          }),
        ),
      );
    }
  }
  return definitions;
};

/** Returns captures in document order with their stable configuration keys. */
const captureEntries = (config) =>
  config.documents.flatMap((document) =>
    document.captures.map((capture) => ({
      key: `${document.name}/${capture.name}`,
      document,
      capture,
    })),
  );

const treePairFor = async ({ repoRoot, parent, commit }) => ({
  parentTree: await run({
    command: "git",
    args: ["rev-parse", `${parent}^{tree}`],
    cwd: repoRoot,
  }),
  commitTree: await run({
    command: "git",
    args: ["rev-parse", `${commit}^{tree}`],
    cwd: repoRoot,
  }),
});

/** Selects owned regions while retaining a complete global and tip safety net. */
export const capturePlan = ({ config, stylingFiles, isTip }) => {
  if (config.schemaVersion < 2) {
    return captureEntries(config).map(({ key }) => key);
  }
  const globalPatterns = config.capturePolicy.globalFilePatterns.map(
    (pattern) => new RegExp(pattern),
  );
  const isGlobal = stylingFiles.some((path) =>
    globalPatterns.some((pattern) => pattern.test(path)),
  );
  const entries = captureEntries(config);
  const selected = entries.filter(({ capture }) => {
    if (isTip || isGlobal) {
      return true;
    }
    return (
      capture.scope === "component" &&
      stylingFiles.some((path) =>
        capture.ownerPatterns.some((pattern) => new RegExp(pattern).test(path)),
      )
    );
  });
  if (!isGlobal && !isTip) {
    const ownedFiles = stylingFiles.filter((path) =>
      entries.some(
        ({ capture }) =>
          capture.scope === "component" &&
          capture.ownerPatterns.some((pattern) =>
            new RegExp(pattern).test(path),
          ),
      ),
    );
    if (ownedFiles.length !== stylingFiles.length) {
      throw new Error(
        `Style screenshot capture policy has no component owner for ${stylingFiles
          .filter((path) => !ownedFiles.includes(path))
          .join(", ")}. Mark the file global or add an owner pattern.`,
      );
    }
  }
  return selected.map(({ key }) => key);
};

/** Prevents a branch from reinterpreting capture keys present on its base. */
const assertCaptureCoverage = ({ config, baselineConfig }) => {
  if (baselineConfig === null) {
    return;
  }
  const activeDefinitions = captureDefinitions(config);
  const baselineDefinitions = captureDefinitions(baselineConfig);
  const changedCaptureCount = [...baselineDefinitions].filter(
    ([key, definition]) => activeDefinitions.get(key) !== definition,
  ).length;
  if (changedCaptureCount > 0) {
    throw new Error(
      `Style screenshot config changes or removes ${changedCaptureCount} merge-base capture definition(s); existing definitions are immutable and additions require new capture keys.`,
    );
  }
};

/** Includes document sources in relevance without duplicating config entries. */
const fixturePathsForConfig = (config) => [
  ...config.fixturePaths,
  ...(config.documents ?? [])
    .map((document) => document.source)
    .filter((source) => typeof source === "string"),
];

/** Reads the active screenshot configuration from the harness checkout. */
const readConfig = async (configPath) =>
  parseConfig(await readFile(configPath, "utf8"));

/** Reads a historical config when that revision contains one. */
const readConfigAtCommit = async ({ repoRoot, commit, configRepoPath }) => {
  try {
    return parseConfig(
      await run({
        command: "git",
        args: ["show", `${commit}:${configRepoPath}`],
        cwd: repoRoot,
      }),
    );
  } catch (error) {
    if (error.code === 128) {
      return null;
    }
    throw error;
  }
};

/** Restricts destructive evidence cleanup to the repository-owned run root. */
const validateArtifactRoot = async ({ repoRoot, artifactRoot }) => {
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedArtifactRoot = resolve(artifactRoot);
  const artifactRepoPath = relative(resolvedRepoRoot, resolvedArtifactRoot);
  if (
    artifactRepoPath === "" ||
    artifactRepoPath.startsWith("..") ||
    isAbsolute(artifactRepoPath)
  ) {
    throw new Error(
      "Style history artifacts must stay under test-results/style-history.",
    );
  }

  const canonicalRepoRoot = await realpath(resolvedRepoRoot);
  const canonicalArtifactRoot = resolve(canonicalRepoRoot, artifactRepoPath);
  const disposableRoot = join(
    canonicalRepoRoot,
    "test-results",
    "style-history",
  );
  const disposablePath = relative(disposableRoot, canonicalArtifactRoot);
  if (disposablePath.startsWith("..") || isAbsolute(disposablePath)) {
    throw new Error(
      "Style history artifacts must stay under test-results/style-history.",
    );
  }

  let current = canonicalRepoRoot;
  for (const part of artifactRepoPath.split(/[\\/]/)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(
          "Style history artifact paths must not traverse symbolic links.",
        );
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  return canonicalArtifactRoot;
};

/** Lists files recursively using POSIX-style relative names for manifests. */
const listFiles = async (directory) => {
  const files = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        files.push(relative(directory, absolute).replaceAll("\\", "/"));
      }
    }
  };
  await visit(directory);
  return files.sort();
};

/** Reads stable pixel evidence without depending on PNG encoder metadata. */
const readCapture = async (path) => {
  const png = PNG.sync.read(await readFile(path));
  const sha256 = createHash("sha256")
    .update(`width:${png.width};height:${png.height};rgba:`)
    .update(png.data)
    .digest("hex");
  return {
    width: png.width,
    height: png.height,
    sha256,
    data: png.data,
  };
};

/** Removes decoded pixel bytes from evidence written to manifests and CI. */
const captureIdentity = (capture) =>
  capture === null
    ? null
    : {
        width: capture.width,
        height: capture.height,
        sha256: capture.sha256,
      };

// Hosted Chromium can vary one antialias channel on rounded edges without a
// layout or color change. Larger channel deltas remain visual differences.
const PIXEL_CHANNEL_TOLERANCE = 1;

/** Counts visual differences, including pixels added by dimension changes. */
const comparePngs = async ({ beforePath, afterPath }) => {
  const before = beforePath === null ? null : await readCapture(beforePath);
  const after = afterPath === null ? null : await readCapture(afterPath);
  const width = Math.max(before?.width ?? 0, after?.width ?? 0);
  const height = Math.max(before?.height ?? 0, after?.height ?? 0);
  const diff = new PNG({ width, height });
  let changedPixels = 0;
  let toleratedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const beforeOffset =
        before !== null && x < before.width && y < before.height
          ? (y * before.width + x) * 4
          : null;
      const afterOffset =
        after !== null && x < after.width && y < after.height
          ? (y * after.width + x) * 4
          : null;
      const channelDelta =
        beforeOffset !== null && afterOffset !== null
          ? Math.max(
              Math.abs(before.data[beforeOffset] - after.data[afterOffset]),
              Math.abs(
                before.data[beforeOffset + 1] - after.data[afterOffset + 1],
              ),
              Math.abs(
                before.data[beforeOffset + 2] - after.data[afterOffset + 2],
              ),
            )
          : null;
      const changed =
        beforeOffset === null ||
        afterOffset === null ||
        before.data[beforeOffset + 3] !== after.data[afterOffset + 3] ||
        channelDelta > PIXEL_CHANNEL_TOLERANCE;
      if (
        !changed &&
        channelDelta !== null &&
        channelDelta > 0 &&
        channelDelta <= PIXEL_CHANNEL_TOLERANCE
      ) {
        toleratedPixels += 1;
      }
      const diffOffset = (y * width + x) * 4;
      if (changed) {
        changedPixels += 1;
        diff.data[diffOffset] = 255;
        diff.data[diffOffset + 1] = 0;
        diff.data[diffOffset + 2] = 0;
        diff.data[diffOffset + 3] = 255;
      } else {
        diff.data[diffOffset] = 0;
        diff.data[diffOffset + 1] = 0;
        diff.data[diffOffset + 2] = 0;
        diff.data[diffOffset + 3] = 0;
      }
    }
  }
  return {
    changedPixels,
    toleratedPixels,
    before: captureIdentity(before),
    after: captureIdentity(after),
    diff: changedPixels === 0 ? null : diff,
  };
};

/** Returns deterministic evidence for every capture on either side. */
const captureFilePrefix = (key) => {
  const separator = key.indexOf("/");
  const document = key.slice(0, separator);
  const capture = key.slice(separator + 1);
  return (
    [document, capture]
      .map((part) => part.replaceAll(/[^a-zA-Z0-9_-]/g, "-"))
      .join("__") + "__"
  );
};

/** Compares only the captures owned by one styling commit. */
const compareCaptureSets = async ({
  beforeDirectory,
  afterDirectory,
  captureKeys,
}) => {
  const prefixes = captureKeys?.map(captureFilePrefix);
  const belongsToRequest = (path) =>
    path.endsWith(".png") &&
    (prefixes === undefined ||
      prefixes.some((prefix) => path.startsWith(prefix)));
  const beforeFiles = (await listFiles(beforeDirectory)).filter(
    belongsToRequest,
  );
  const afterFiles = (await listFiles(afterDirectory)).filter(belongsToRequest);
  const allFiles = [...new Set([...beforeFiles, ...afterFiles])].sort();
  const captures = [];

  for (const capture of allFiles) {
    const comparison = await comparePngs({
      beforePath: beforeFiles.includes(capture)
        ? join(beforeDirectory, capture)
        : null,
      afterPath: afterFiles.includes(capture)
        ? join(afterDirectory, capture)
        : null,
    });
    captures.push({ capture, ...comparison });
  }
  return captures;
};

/** Normalizes object key order before exact manifest evidence comparison. */
const normalizeIdentity = (identity) =>
  identity === null
    ? null
    : {
        width: identity.width,
        height: identity.height,
        sha256: identity.sha256,
      };

/** Selects the deterministic evidence shared by manifests and CI ledgers. */
const captureEvidence = ({
  capture,
  changedPixels,
  toleratedPixels = 0,
  before,
  after,
}) => ({
  capture,
  changedPixels,
  toleratedPixels,
  before: normalizeIdentity(before),
  after: normalizeIdentity(after),
});

/** Accepts only the exact raster identities listed by an approved manifest. */
const identityMatches = (expected, actual) => {
  if (expected === null || actual === null) {
    return expected === actual;
  }
  return (
    expected.width === actual.width &&
    expected.height === actual.height &&
    [expected.sha256, ...(expected.sha256Alternates ?? [])].includes(
      actual.sha256,
    )
  );
};

/** Compares approved evidence while allowing listed exact raster variants. */
const captureEvidenceMatches = (expected, actual) =>
  expected.capture === actual.capture &&
  expected.changedPixels === actual.changedPixels &&
  identityMatches(expected.before, actual.before) &&
  identityMatches(expected.after, actual.after);

/** Writes one durable machine-readable evidence ledger per relevant commit. */
const writeEvidenceLedger = async ({ artifactDirectory, entry, captures }) => {
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    join(artifactDirectory, "evidence.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        commit: entry.commit,
        parent: entry.parent,
        subject: entry.subject,
        visualKind: entry.visualKind,
        captures: captures.map(captureEvidence),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

/** Preserves both images and a red pixel mask for CI artifact inspection. */
const writeArtifacts = async ({
  artifactDirectory,
  changes,
  beforeDirectory,
  afterDirectory,
}) => {
  for (const change of changes) {
    const captureDirectory = join(
      artifactDirectory,
      change.capture.replaceAll("/", "__").replace(/\.png$/, ""),
    );
    await mkdir(captureDirectory, { recursive: true });
    for (const [name, sourceDirectory] of [
      ["before.png", beforeDirectory],
      ["after.png", afterDirectory],
    ]) {
      try {
        await copyFile(
          join(sourceDirectory, change.capture),
          join(captureDirectory, name),
        );
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    if (change.diff !== null) {
      await writeFile(
        join(captureDirectory, "diff.png"),
        PNG.sync.write(change.diff),
      );
    }
  }
};

/** Validates the machine-readable contract committed with an approved move. */
const validateManifest = async ({
  repoRoot,
  commit,
  parent,
  subject,
  manifestDirectory,
  stylingFiles,
  changes,
  contractSubjects = [subject],
  squashed = false,
}) => {
  const manifestFiles = (
    await run({
      command: "git",
      args: [
        "diff",
        "--name-only",
        "--diff-filter=A",
        parent,
        commit,
        "--",
        manifestDirectory,
      ],
      cwd: repoRoot,
    })
  )
    .split("\n")
    .filter(Boolean);
  const approvedSubjects = contractSubjects.filter((value) =>
    value.endsWith("[visual:approved]"),
  );
  const expectedManifestCount = squashed ? approvedSubjects.length : 1;
  if (manifestFiles.length !== expectedManifestCount) {
    throw new Error(
      `${subject}: an approved commit requires ${expectedManifestCount} manifest${expectedManifestCount === 1 ? "" : "s"} under ${manifestDirectory}; found ${manifestFiles.length}. Repair this history entry instead of treating missing evidence as empty.`,
    );
  }

  const manifests = await Promise.all(
    manifestFiles.map(async (manifestFile) =>
      JSON.parse(
        await run({
          command: "git",
          args: ["show", `${commit}:${manifestFile}`],
          cwd: repoRoot,
        }),
      ),
    ),
  );
  for (const manifest of manifests) {
    if (
      manifest.schemaVersion !== 1 ||
      (squashed
        ? !approvedSubjects.includes(manifest.commitSubject)
        : manifest.commitSubject !== subject)
    ) {
      throw new Error(
        `${subject}: manifest schemaVersion must be 1 and commitSubject must match exactly.`,
      );
    }
    if (
      !Array.isArray(manifest.stylingFiles) ||
      !Array.isArray(manifest.captureChanges)
    ) {
      throw new Error(
        `${subject}: manifest requires stylingFiles and captureChanges arrays.`,
      );
    }
  }

  const assertDeltas = (entries, label) => {
    for (const entry of entries) {
      if (
        !Array.isArray(entry.propertyDeltas) ||
        entry.propertyDeltas.length === 0
      ) {
        throw new Error(
          `${subject}: every ${label} entry needs at least one propertyDelta.`,
        );
      }
      for (const delta of entry.propertyDeltas) {
        if (
          typeof delta.property !== "string" ||
          typeof delta.from !== "string" ||
          typeof delta.to !== "string"
        ) {
          throw new Error(
            `${subject}: propertyDelta values must name property, from, and to.`,
          );
        }
      }
    }
  };
  for (const manifest of manifests) {
    assertDeltas(manifest.stylingFiles, "stylingFiles");
    assertDeltas(manifest.captureChanges, "captureChanges");
  }

  const actualFiles = [...stylingFiles].sort();
  const manifestFilesInContract = [
    ...new Set(
      manifests.flatMap((manifest) =>
        manifest.stylingFiles.map((entry) => entry.path),
      ),
    ),
  ].sort();
  if (
    !squashed &&
    (JSON.stringify(manifestFilesInContract) !== JSON.stringify(actualFiles) ||
      !manifestFilesInContract.every((path) => actualFiles.includes(path)))
  ) {
    throw new Error(
      `${subject}: manifest styling files ${JSON.stringify(manifestFilesInContract)} do not match commit styling files ${JSON.stringify(actualFiles)}.`,
    );
  }

  const isSha256 = (value) =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const isIdentity = (value) => {
    if (value === null) {
      return true;
    }
    if (
      typeof value !== "object" ||
      !Number.isInteger(value.width) ||
      value.width <= 0 ||
      !Number.isInteger(value.height) ||
      value.height <= 0 ||
      !isSha256(value.sha256)
    ) {
      return false;
    }
    if (value.sha256Alternates === undefined) {
      return true;
    }
    return (
      Array.isArray(value.sha256Alternates) &&
      value.sha256Alternates.length > 0 &&
      value.sha256Alternates.every(isSha256) &&
      new Set([value.sha256, ...value.sha256Alternates]).size ===
        value.sha256Alternates.length + 1
    );
  };
  const manifestChanges = manifests.flatMap(
    (manifest) => manifest.captureChanges,
  );
  for (const entry of manifestChanges) {
    if (
      typeof entry.capture !== "string" ||
      !Number.isInteger(entry.changedPixels) ||
      entry.changedPixels < 0 ||
      !isIdentity(entry.before) ||
      !isIdentity(entry.after)
    ) {
      throw new Error(
        `${subject}: every captureChanges entry requires capture, exact changedPixels, and before/after dimensions and exact SHA-256 hashes. Optional SHA-256 alternatives must be unique.`,
      );
    }
  }

  const actualCaptures = changes
    .map(captureEvidence)
    .sort((left, right) => left.capture.localeCompare(right.capture));
  if (squashed) {
    const expectedCaptureNames = [
      ...new Set(manifestChanges.map((entry) => entry.capture)),
    ].sort();
    const actualCaptureNames = actualCaptures.map((entry) => entry.capture);
    if (
      !actualCaptureNames.every((capture) =>
        expectedCaptureNames.includes(capture),
      )
    ) {
      throw new Error(
        `${subject}: squash manifests must cover every changed capture.`,
      );
    }
    return;
  }
  const expectedCaptures = manifestChanges.sort((left, right) =>
    left.capture.localeCompare(right.capture),
  );
  if (
    expectedCaptures.length !== actualCaptures.length ||
    expectedCaptures.some(
      (expected, index) =>
        !captureEvidenceMatches(expected, actualCaptures[index]),
    )
  ) {
    throw new Error(
      `${subject}: exact capture evidence does not match the approved manifest.`,
    );
  }
};

/**
 * Verifies every relevant commit in the merge-base-to-HEAD range. Capture
 * configuration comes from the final harness, while fixture content stays at
 * each revision so a parent never has to parse syntax introduced by its child.
 */
export const verifyHistory = async ({
  repoRoot,
  base,
  configPath,
  artifactRoot,
}) => {
  const disposableArtifactRoot = await validateArtifactRoot({
    repoRoot,
    artifactRoot,
  });
  const config = await readConfig(configPath);
  const policyFingerprint = configFingerprint(config);
  const environment = await currentEnvironment({ repoRoot });
  const receiptDirectory =
    process.env.STYLE_HISTORY_RECEIPT_DIR === undefined
      ? null
      : resolve(process.env.STYLE_HISTORY_RECEIPT_DIR);
  const receiptStore =
    receiptDirectory === null
      ? { schemaVersion: 1, receipts: {} }
      : await readReceiptStore(receiptDirectory);
  const pixelAuthority =
    config.captureEnvironment?.authorityClass === undefined ||
    config.captureEnvironment.authorityClass === environment.authorityClass;
  const harnessRoot = dirname(dirname(configPath));
  const configRepoPath = relative(repoRoot, configPath).replaceAll("\\", "/");
  if (configRepoPath.startsWith("../") || isAbsolute(configRepoPath)) {
    throw new Error("Style screenshot config must be inside the repository.");
  }
  const head = await run({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: repoRoot,
  });
  const mergeBase = await run({
    command: "git",
    args: ["merge-base", base, "HEAD"],
    cwd: repoRoot,
  });
  const commitOutput = await run({
    command: "git",
    args: ["rev-list", "--reverse", `${mergeBase}..HEAD`],
    cwd: repoRoot,
  });
  const commits = commitOutput.split("\n").filter(Boolean);
  const historicalConfigs = await Promise.all(
    [mergeBase, ...commits].map((commit) =>
      readConfigAtCommit({ repoRoot, commit, configRepoPath }),
    ),
  );
  assertCaptureCoverage({
    config,
    baselineConfig: historicalConfigs[0],
  });
  const relevanceConfigs = [
    RELEVANCE_FLOOR,
    ...historicalConfigs.filter((candidate) => candidate !== null),
    config,
  ];
  const fixturePaths = new Set(relevanceConfigs.flatMap(fixturePathsForConfig));
  const patterns = [
    ...new Set(
      relevanceConfigs.flatMap((candidate) => candidate.stylingFilePatterns),
    ),
  ].map((pattern) => new RegExp(pattern));
  const relevant = [];

  for (const commit of commits) {
    const parentLine = await run({
      command: "git",
      args: ["rev-list", "--parents", "-n", "1", commit],
      cwd: repoRoot,
    });
    const [, ...parents] = parentLine.split(" ");
    const parent = parents[0];
    if (parent === undefined) {
      continue;
    }
    const changedFiles = (
      parents.length > 1
        ? await run({
            command: "git",
            args: [
              "show",
              "--remerge-diff",
              "--name-only",
              "--format=",
              "--no-renames",
              commit,
            ],
            cwd: repoRoot,
          })
        : await run({
            command: "git",
            args: ["diff", "--name-only", "--no-renames", parent, commit],
            cwd: repoRoot,
          })
    )
      .split("\n")
      .filter(Boolean);
    const stylingFiles = changedFiles.filter(
      (path) =>
        path === configRepoPath ||
        fixturePaths.has(path) ||
        patterns.some((pattern) => pattern.test(path)),
    );
    if (stylingFiles.length === 0) {
      continue;
    }
    const subject = await run({
      command: "git",
      args: ["show", "-s", "--format=%s", commit],
      cwd: repoRoot,
    });
    const body = await run({
      command: "git",
      args: ["show", "-s", "--format=%b", commit],
      cwd: repoRoot,
    });
    if (parents.length > 1) {
      throw new Error(
        `${subject}: a merge commit resolved a configured styling file, so its visual delta cannot be isolated from the merged branch. Rebase and record the resolution as a single-parent [visual:empty] or [visual:approved] commit.`,
      );
    }
    const contract = visualContract({ subject, body });
    if (contract === undefined) {
      throw new Error(
        `${subject}: styling commits must end with [visual:empty] or [visual:approved].`,
      );
    }
    relevant.push({
      commit,
      parent,
      treePair: await treePairFor({ repoRoot, parent, commit }),
      subject,
      stylingFiles,
      visualKind: contract.kind,
      contractSubjects: contract.subjects,
      squashed: contract.squashed,
    });
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "big-plan-style-history-"),
  );
  const capturesByCommit = new Map();
  const worktreeOperations = createSerialQueue();

  const captureCommit = async (commit, captureKeys) => {
    const cacheKey = `${commit}:${JSON.stringify(captureKeys)}`;
    const cached = capturesByCommit.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const worktree = join(temporaryRoot, `worktree-${commit.slice(0, 12)}`);
    const outputDirectory = join(
      temporaryRoot,
      `captures-${commit.slice(0, 12)}`,
    );
    await worktreeOperations(() =>
      run({
        command: "git",
        args: ["worktree", "add", "--detach", worktree, commit],
        cwd: repoRoot,
      }),
    );
    let capturedEnvironment = environment;
    try {
      await mkdir(outputDirectory, { recursive: true });
      const command = config.captureCommand.map((part) =>
        part.replaceAll("{harnessRoot}", harnessRoot),
      );
      await run({
        command: command[0],
        args: command.slice(1),
        cwd: harnessRoot,
        timeout: CAPTURE_TIMEOUT_MS,
        env: {
          ...process.env,
          STYLE_SNAPSHOT_CHECKOUT: worktree,
          STYLE_SNAPSHOT_OUTPUT_DIR: outputDirectory,
          STYLE_SNAPSHOT_CONFIG: configPath,
          STYLE_SNAPSHOT_HARNESS_ROOT: harnessRoot,
          STYLE_SNAPSHOT_CAPTURE_KEYS: JSON.stringify(captureKeys),
        },
      });
      try {
        const manifest = JSON.parse(
          await readFile(
            join(outputDirectory, "capture-manifest.json"),
            "utf8",
          ),
        );
        if (manifest.environment !== undefined) {
          capturedEnvironment = manifest.environment;
          if (!sameRunnerEnvironment(environment, capturedEnvironment)) {
            throw new Error(
              `environment differs: captured on ${environmentLabel(capturedEnvironment)}, verifying on ${environmentLabel(environment)}`,
            );
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      if (commit === head) {
        const captureManifestPath = join(
          outputDirectory,
          "capture-manifest.json",
        );
        try {
          const captureManifest = JSON.parse(
            await readFile(captureManifestPath, "utf8"),
          );
          const observedTuples = new Set(
            captureManifest.captures.map(
              (entry) => `${entry.key}@${entry.viewport}@${entry.theme}`,
            ),
          );
          const definitionsByKey = new Map(
            captureEntries(config).map((entry) => [entry.key, entry.capture]),
          );
          const missingTuples = captureKeys.flatMap((key) => {
            const capture = definitionsByKey.get(key);
            if (capture === undefined) {
              return [key];
            }
            return capture.viewports.flatMap((viewport) =>
              capture.themes
                .filter(
                  (theme) =>
                    !observedTuples.has(`${key}@${viewport.name}@${theme}`),
                )
                .map((theme) => `${key} at ${viewport.name}/${theme}`),
            );
          });
          if (missingTuples.length > 0) {
            throw new Error(
              `Final style fixture did not produce a visible target for ${missingTuples.join(", ")}.`,
            );
          }
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
          const expectedCaptureCount = config.documents.reduce(
            (documentTotal, document) =>
              documentTotal +
              document.captures.reduce(
                (captureTotal, capture) =>
                  captureTotal +
                  capture.themes.length * capture.viewports.length,
                0,
              ),
            0,
          );
          const actualCaptureCount = (await listFiles(outputDirectory)).filter(
            (path) => path.endsWith(".png"),
          ).length;
          if (actualCaptureCount !== expectedCaptureCount) {
            throw new Error(
              `Final style fixture produced ${actualCaptureCount} of ${expectedCaptureCount} configured captures.`,
              { cause: error },
            );
          }
        }
      }
    } finally {
      await worktreeOperations(() =>
        run({
          command: "git",
          args: ["worktree", "remove", "--force", worktree],
          cwd: repoRoot,
        }),
      );
    }
    const result = {
      directory: outputDirectory,
      environment: capturedEnvironment,
    };
    capturesByCommit.set(cacheKey, result);
    return result;
  };

  const results = [];
  const receiptFor = (entry) =>
    receiptStore.receipts[receiptKey(entry.treePair)];
  const entryCaptureKeys = (entry) =>
    capturePlan({
      config,
      stylingFiles: entry.stylingFiles,
      isTip: entry.commit === head,
    });
  const reusableReceipt = (entry) => {
    const receipt = receiptFor(entry);
    return (
      pixelAuthority &&
      receiptDirectory !== null &&
      receipt?.schemaVersion === 1 &&
      receipt.policyFingerprint === policyFingerprint &&
      sameEnvironment(receipt.environment, environment) &&
      receipt.isTip === (entry.commit === head) &&
      JSON.stringify(receipt.captureKeys) ===
        JSON.stringify(entryCaptureKeys(entry)) &&
      receipt.visualKind === entry.visualKind &&
      JSON.stringify(receipt.stylingFiles) ===
        JSON.stringify([...entry.stylingFiles].sort()) &&
      JSON.stringify(receipt.contractSubjects) ===
        JSON.stringify(entry.contractSubjects) &&
      receipt.squashed === entry.squashed &&
      receipt.result !== undefined
    );
  };
  try {
    await rm(disposableArtifactRoot, { recursive: true, force: true });
    const firstUncachedIndex = relevant.findIndex(
      (entry) => !reusableReceipt(entry),
    );
    const activeRelevant =
      firstUncachedIndex === -1 ? [] : relevant.slice(firstUncachedIndex);
    for (const entry of relevant.slice(
      0,
      firstUncachedIndex === -1 ? relevant.length : firstUncachedIndex,
    )) {
      results.push({ ...receiptFor(entry).result, cached: true });
    }
    const captureRequests = new Map();
    const addCaptureRequest = (commit, captureKeys) => {
      const existing = captureRequests.get(commit) ?? new Set();
      for (const captureKey of captureKeys) {
        existing.add(captureKey);
      }
      captureRequests.set(commit, existing);
    };
    addCaptureRequest(
      head,
      capturePlan({ config, stylingFiles: [], isTip: true }),
    );
    for (const entry of activeRelevant) {
      const captureKeys = entryCaptureKeys(entry);
      addCaptureRequest(entry.parent, captureKeys);
      addCaptureRequest(entry.commit, captureKeys);
    }
    const commitsToCapture = [...captureRequests.keys()];
    // The default is four capture jobs. The maximum is shared by all SHA work.
    await captureCommits({
      commits: commitsToCapture,
      captureCommit: (commit) =>
        captureCommit(commit, [...captureRequests.get(commit)].sort()),
      concurrency: captureConcurrency(),
    });
    const failures = [];
    for (const entry of activeRelevant) {
      try {
        const beforeCapture = await captureCommit(
          entry.parent,
          [...captureRequests.get(entry.parent)].sort(),
        );
        const afterCapture = await captureCommit(
          entry.commit,
          [...captureRequests.get(entry.commit)].sort(),
        );
        if (
          !sameRunnerEnvironment(
            beforeCapture.environment,
            afterCapture.environment,
          )
        ) {
          throw new Error(
            `environment differs: captured on ${environmentLabel(beforeCapture.environment)}, verifying on ${environmentLabel(afterCapture.environment)}`,
          );
        }
        const captures = await compareCaptureSets({
          beforeDirectory: beforeCapture.directory,
          afterDirectory: afterCapture.directory,
          captureKeys:
            config.schemaVersion < 2 ? undefined : entryCaptureKeys(entry),
        });
        const changes = captures.filter((capture) => capture.changedPixels > 0);
        const artifactDirectory = join(
          disposableArtifactRoot,
          entry.commit.slice(0, 12),
        );
        await writeEvidenceLedger({
          artifactDirectory,
          entry,
          captures,
        });
        await writeArtifacts({
          artifactDirectory,
          changes,
          beforeDirectory: beforeCapture.directory,
          afterDirectory: afterCapture.directory,
        });

        if (pixelAuthority) {
          if (entry.visualKind === "empty" && changes.length > 0) {
            const detail = changes
              .map(
                (change) =>
                  `${change.capture} (${change.changedPixels} changed pixels)`,
              )
              .join(", ");
            throw new Error(
              `${entry.subject}: expected zero changed pixels; observed ${detail}.`,
            );
          }
          if (entry.visualKind === "approved") {
            await validateManifest({
              repoRoot,
              commit: entry.commit,
              parent: entry.parent,
              subject: entry.subject,
              manifestDirectory: config.manifestDirectory,
              stylingFiles: entry.stylingFiles,
              changes,
              contractSubjects: entry.contractSubjects,
              squashed: entry.squashed,
            });
            if (changes.length === 0) {
              throw new Error(
                `${entry.subject}: an approved commit must produce its declared screenshot changes.`,
              );
            }
          }
        }
        const result = {
          commit: entry.commit,
          subject: entry.subject,
          visualKind: entry.visualKind,
          changedCaptures: changes.length,
          changedPixels: changes.reduce(
            (total, change) => total + (change.changedPixels ?? 0),
            0,
          ),
          advisory: !pixelAuthority,
        };
        results.push(result);
        if (pixelAuthority && receiptDirectory !== null) {
          receiptStore.receipts[receiptKey(entry.treePair)] = {
            schemaVersion: 1,
            ...entry.treePair,
            policyFingerprint,
            environment,
            isTip: entry.commit === head,
            captureKeys: entryCaptureKeys(entry),
            visualKind: entry.visualKind,
            stylingFiles: [...entry.stylingFiles].sort(),
            contractSubjects: entry.contractSubjects,
            squashed: entry.squashed,
            result,
          };
          await writeReceiptStore(receiptDirectory, receiptStore);
        }
      } catch (error) {
        failures.push({ entry, error });
      }
    }
    if (failures.length > 0) {
      throw new Error(
        [
          `Style history verification failed for ${failures.length} commit${failures.length === 1 ? "" : "s"}.`,
          ...failures.map(
            ({ entry, error }) =>
              `- ${entry.subject}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ].join("\n"),
        { cause: failures[0].error },
      );
    }
  } finally {
    for (const worktree of (await readdir(temporaryRoot)).filter((name) =>
      name.startsWith("worktree-"),
    )) {
      try {
        await run({
          command: "git",
          args: [
            "worktree",
            "remove",
            "--force",
            join(temporaryRoot, worktree),
          ],
          cwd: repoRoot,
        });
      } catch {
        // The primary failure is more useful than best-effort cleanup noise.
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return results;
};

/** Parses the intentionally small command surface used locally and in CI. */
const parseArguments = (arguments_) => {
  const result = {
    base: "origin/main",
    config: ".style-snapshots/config.json",
    artifacts: "test-results/style-history",
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (
      argument === "--base" ||
      argument === "--config" ||
      argument === "--artifacts"
    ) {
      if (value === undefined) {
        throw new Error(`${argument} requires a value.`);
      }
      const key =
        argument === "--base"
          ? "base"
          : argument === "--config"
            ? "config"
            : "artifacts";
      result[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument "${String(argument)}".`);
    }
  }
  return result;
};

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const arguments_ = parseArguments(process.argv.slice(2));
  const repoRoot = await run({
    command: "git",
    args: ["rev-parse", "--show-toplevel"],
    cwd: process.cwd(),
  });
  const results = await verifyHistory({
    repoRoot,
    base: arguments_.base,
    configPath: resolve(repoRoot, arguments_.config),
    artifactRoot: resolve(repoRoot, arguments_.artifacts),
  });
  if (results.length === 0) {
    console.log("style history: no relevant commits");
  } else {
    if (results.some((result) => result.advisory)) {
      console.log(
        "style history: advisory-only; this environment is not the configured pixel authority",
      );
    }
    for (const result of results) {
      console.log(
        `style history: ${result.commit.slice(0, 12)} ${result.visualKind} ${result.changedCaptures} changed captures ${result.changedPixels} changed pixels`,
      );
    }
  }
}
