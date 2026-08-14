// Enforces the closed design scales described in _internal/DESIGN_PRINCIPLES.md. This
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

// The artboard's own type ramp is a closed scale too, and it lives in CSS
// custom properties rather than in utilities, so the module scan above cannot
// see it. What matters here is not which sizes were picked but how far apart
// they are: a section title a fifth of a step above the rows beneath it reads
// as the same role drawn twice, which is how a drawing ends up looking flat
// while technically having every level. The anchors start at a line break
// because the same selectors also appear indented inside a grouped maximize
// rule, whose block declares no ramp.
const ARTBOARD_RAMP_STYLESHEET = "components/wireframe/styles.css";

const ARTBOARD_RAMPS = [
  { device: "shared default", anchor: "\n  .wireframe {" },
  {
    device: "desktop",
    anchor: '\n  .wireframe-screen[data-wireframe-device="desktop"] {',
  },
  {
    device: "landscape tablet",
    anchor: '\n  .wireframe-screen[data-wireframe-device="tablet"] {',
  },
];

// Metadata sits closest to content because case and colour separate it as
// well; a title has only size and weight to work with, so it needs a real step.
const ARTBOARD_RAMP_SEPARATIONS = [
  { larger: "body", smaller: "meta", minimumRatio: 1.1 },
  { larger: "title", smaller: "body", minimumRatio: 1.25 },
  { larger: "heading", smaller: "title", minimumRatio: 1.2 },
];

const rampSizes = (stylesheet, anchor) => {
  const start = stylesheet.indexOf(anchor);
  if (start < 0) {
    return undefined;
  }
  const block = stylesheet.slice(start, stylesheet.indexOf("\n  }", start));
  const sizes = {};
  for (const [, role, size] of block.matchAll(
    /--wf-text-([a-z]+):\s*([\d.]+)rem;/g,
  )) {
    sizes[role] = Number.parseFloat(size);
  }
  return sizes;
};

/** Reports artboard type roles that are too close to read as different roles. */
const checkArtboardTypeRamp = async () => {
  const path = join(SOURCE_ROOT, ARTBOARD_RAMP_STYLESHEET);
  let stylesheet;
  try {
    stylesheet = await readFile(path, "utf8");
  } catch {
    // A source tree without the artboard stylesheet has no ramp to close.
    return [];
  }
  const failures = [];
  for (const { device, anchor } of ARTBOARD_RAMPS) {
    const sizes = rampSizes(stylesheet, anchor);
    if (sizes === undefined) {
      failures.push(
        `${ARTBOARD_RAMP_STYLESHEET}: no ${device} type ramp; every device that scales down declares the whole ramp in one block`,
      );
      continue;
    }
    for (const { larger, smaller, minimumRatio } of ARTBOARD_RAMP_SEPARATIONS) {
      const largerSize = sizes[larger];
      const smallerSize = sizes[smaller];
      if (largerSize === undefined || smallerSize === undefined) {
        failures.push(
          `${ARTBOARD_RAMP_STYLESHEET}: ${device} ramp is missing --wf-text-${largerSize === undefined ? larger : smaller}`,
        );
        continue;
      }
      const ratio = largerSize / smallerSize;
      if (ratio < minimumRatio) {
        failures.push(
          `${ARTBOARD_RAMP_STYLESHEET}: ${device} ${larger} (${largerSize}rem) is only ${ratio.toFixed(2)}x ${smaller} (${smallerSize}rem); a reader cannot see a step that small, so make it at least ${minimumRatio}x`,
        );
      }
    }
  }
  return failures;
};

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
  const failures = [...(await checkArtboardTypeRamp())];
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
      "design system: authored markup must pick from the closed scales in _internal/DESIGN_PRINCIPLES.md",
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
