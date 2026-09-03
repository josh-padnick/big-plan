// Renders the sample plans the docs link to, straight from the repository's own
// example plans, so a sample page can never show a document the current CLI
// would not produce. Run from docs/ via `bun run gen:demo`.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "bin", "big-plan.mjs");
const PUBLIC = join(ROOT, "docs", "public");

// `big-plan render` shares the plan-authoring guidance gate, which refuses to
// run until `big-plan guidance` has been acknowledged for the working
// directory. These samples are already-authored example plans checked into the
// repository, not plans this build is writing, so the gate has nothing to
// protect here. Pin the acknowledgment to a throwaway state directory and
// record it once: render is unlocked for this build only, without touching the
// developer's real state or weakening the gate for anyone authoring a plan.
const stateDir = mkdtempSync(join(tmpdir(), "big-plan-docs-guidance-"));
const env = { ...process.env, BIG_PLAN_STATE_DIR: stateDir };
execFileSync(process.execPath, [CLI, "guidance"], {
  cwd: ROOT,
  env,
  stdio: "ignore",
});

// Each sample publishes its rendered document at /plans/<slug>/, beside the plain
// source the docs invite readers to download. The docs page about a sample lives
// at /samples/<slug>/, so the two never collide in the built output.
const SAMPLES = [
  {
    slug: "rate-limiting",
    source: join(ROOT, "docs", "src", "demo", "example-plan.md"),
  },
  { slug: "retry-queue", source: join(ROOT, "examples", "deck.mdx") },
  {
    slug: "workflow-builder",
    source: join(ROOT, "examples", "workflow-engine-builder.mdx"),
  },
  {
    slug: "all-components",
    source: join(ROOT, "examples", "all-components.mdx"),
  },
];

for (const { slug, source } of SAMPLES) {
  const out = join(PUBLIC, "plans", slug);
  mkdirSync(out, { recursive: true });
  execFileSync(
    process.execPath,
    [CLI, "render", source, join(out, "index.html")],
    {
      cwd: ROOT,
      env,
    },
  );
  copyFileSync(source, join(out, "plan.md"));
  console.log(`rendered sample ${slug}`);
}

// The acknowledgment marker only existed to unlock render for this build.
rmSync(stateDir, { recursive: true, force: true });

// The legacy /demo/ address predates the samples section and still resolves.
mkdirSync(join(PUBLIC, "demo"), { recursive: true });
copyFileSync(
  join(PUBLIC, "plans", "rate-limiting", "index.html"),
  join(PUBLIC, "demo", "index.html"),
);
copyFileSync(
  join(PUBLIC, "plans", "rate-limiting", "plan.md"),
  join(PUBLIC, "demo", "example-plan.md"),
);
console.log("mirrored /demo/");
