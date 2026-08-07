// Enforces the closed design scales described in DESIGN_PRINCIPLES.md. This
// check owns the exact allowed steps; the document owns why they are the steps.
//
// Colour and type need no check here, because the theme already closes them:
// a palette shade is a plain custom property and never becomes a utility, and
// every stock Tailwind size and tracking step is dropped before the product's
// own are declared. Spacing cannot be closed the same way, because Tailwind
// derives every numeric spacing utility from one base unit. So spacing, radius,
// and shadow are closed here instead.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = resolve(
  fileURLToPath(new URL("../../src", import.meta.url)),
);
const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// The spacing scale, in Tailwind's 0.25rem units: 2, 4, 6, 8, 12, 16, 24, 32,
// 48, 64, 96, and 128 pixels. Adjacent steps differ by a ratio a reader sees.
const SPACING_STEPS = new Set([
  "0",
  "px",
  "0.5",
  "1",
  "1.5",
  "2",
  "3",
  "4",
  "6",
  "8",
  "12",
  "16",
  "24",
  "32",
  "auto",
  "full",
]);

const SPACING_PREFIXES = [
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "ps",
  "pe",
  "p",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "m",
  "gap-x",
  "gap-y",
  "gap",
  "space-x",
  "space-y",
];

// A radius names an optional corner set and one step from the scale.
const RADIUS_SIDES = [
  "t",
  "r",
  "b",
  "l",
  "s",
  "e",
  "tl",
  "tr",
  "br",
  "bl",
  "ss",
  "se",
  "ee",
  "es",
];
const RADIUS_SCALE = ["none", "sm", "md", "lg", "xl", "2xl", "full"];
const RADIUS_STEPS = new Set([
  ...RADIUS_SCALE,
  ...RADIUS_SIDES.flatMap((side) =>
    RADIUS_SCALE.map((step) => `${side}-${step}`),
  ),
]);

const SHADOW_STEPS = new Set(["raised", "lifted", "floating", "focus", "none"]);
const INSET_SHADOW_STEPS = new Set(["pressed", "well", "none"]);

// The wireframe is a drawing of somebody else's interface, not a Big Plan
// reading surface, so its internal sketch metrics are its own language.
const EXEMPT_PATHS = [/^components\/wireframe\//];

// One escape, stated at the site rather than hidden in a path list. A value the
// captain approved before the design pass outranks the scale, because parity
// with the approved render is the product decision and the scale is only how
// new decisions get made. Mark the line or the line above it:
//
//   // approved-metric: the panel padding the approved render used
//
// .big-plan/refui-b-report.md records every marked value and why a scale step
// could not carry it.
const APPROVED_MARKER = "approved-metric:";
// Prettier wraps a long class string onto its own line and the explanation
// itself often wraps, so a marker covers the next few lines of code.
const APPROVED_MARKER_REACH = 3;

const group = SPACING_PREFIXES.join("|");
const RULES = [
  {
    name: "spacing",
    pattern: new RegExp(
      `(?<![a-zA-Z0-9-])-?(?:${group})-(\\[[^\\]]*\\]|[0-9]+(?:\\.[0-9]+)?)(?![0-9a-zA-Z.%_-])`,
      "g",
    ),
    allowed: SPACING_STEPS,
    advice:
      "pick a spacing step: 0, px, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32",
  },
  {
    name: "radius",
    pattern:
      /(?<![a-zA-Z0-9-])rounded-(\[[^\]]*\]|[a-z0-9-]+)(?![a-zA-Z0-9-])/g,
    allowed: RADIUS_STEPS,
    advice: "pick a radius step: none, sm, md, lg, xl, 2xl, full",
  },
  {
    name: "shadow",
    pattern: /(?<![a-zA-Z0-9-])shadow-(\[[^\]]*\]|[a-z0-9-]+)(?![a-zA-Z0-9-])/g,
    allowed: SHADOW_STEPS,
    advice: "pick an elevation step: raised, lifted, floating, none",
  },
  {
    name: "inset shadow",
    pattern:
      /(?<![a-zA-Z0-9-])inset-shadow-(\[[^\]]*\]|[a-z0-9-]+)(?![a-zA-Z0-9-])/g,
    allowed: INSET_SHADOW_STEPS,
    advice: "pick an inset step: pressed, well, none",
  },
  {
    // An em value names a ratio to the surrounding text rather than a step, so
    // it is the one size a call site may still state: inline code has to shrink
    // with whatever sentence it interrupts. A rem value is a step, and steps
    // come from the scale.
    name: "type size",
    pattern: /(?<![a-zA-Z0-9-])text-\[([0-9][^\]]*)\]/g,
    allowed: new Set(),
    permit: (value) => /^[0-9.]+em$/.test(value),
    advice:
      "pick a type step: text-2xs, xs, sm, base, lg, xl, 2xl, 3xl, 4xl, 5xl",
  },
  {
    name: "tracking",
    pattern:
      /(?<![a-zA-Z0-9-])tracking-(\[[^\]]*\]|[a-z0-9-]+)(?![a-zA-Z0-9-])/g,
    allowed: new Set(["tight", "caps", "normal", "[inherit]"]),
    advice: "pick tracking-tight for large type or tracking-caps for all caps",
  },
];

/** Collects every authored TypeScript module below the source root. */
const findModules = async (root) => {
  const modules = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.includes(".generated.") &&
        // A test asserting a class string is describing a decision, not making
        // one, so the scales are enforced where the decision lives.
        !entry.name.includes(".test.")
      ) {
        modules.push(path);
      }
    }
  };
  await visit(root);
  return modules.sort();
};

const isExempt = (relativePath) =>
  EXEMPT_PATHS.some((pattern) => pattern.test(relativePath));

const check = async () => {
  const failures = [];
  for (const module of await findModules(SOURCE_ROOT)) {
    const relativePath = relative(SOURCE_ROOT, module).replaceAll("\\", "/");
    if (isExempt(relativePath)) {
      continue;
    }
    const lines = (await readFile(module, "utf8")).split("\n");
    let markerReach = 0;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isComment =
        trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*");
      if (line.includes(APPROVED_MARKER)) {
        markerReach = APPROVED_MARKER_REACH;
        return;
      }
      if (markerReach > 0) {
        if (!isComment) {
          markerReach -= 1;
        }
        return;
      }
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        for (const match of line.matchAll(rule.pattern)) {
          const value = match[1];
          if (value !== undefined && rule.allowed.has(value)) {
            continue;
          }
          if (value !== undefined && rule.permit?.(value) === true) {
            continue;
          }
          failures.push(
            `${relative(REPO_ROOT, module)}:${index + 1}: off-scale ${rule.name} "${match[0]}"; ${rule.advice}`,
          );
        }
      }
    });
  }
  if (failures.length > 0) {
    console.error(
      "design system: authored markup must pick from the closed scales in DESIGN_PRINCIPLES.md",
    );
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("design system: passed");
};

await check();
