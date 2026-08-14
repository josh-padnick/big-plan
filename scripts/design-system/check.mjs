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
import postcss from "postcss";

const DEFAULT_SOURCE_ROOT = resolve(
  fileURLToPath(new URL("../../src", import.meta.url)),
);

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

const ARTBOARD_RAMP_STYLESHEET = "components/wireframe/styles.css";

const ARTBOARD_DEVICES = [
  { id: "desktop", name: "desktop", ownsRamp: true },
  { id: "tablet", name: "landscape tablet", ownsRamp: true },
  { id: "tablet-portrait", name: "portrait tablet", ownsRamp: false },
  { id: "phone", name: "phone", ownsRamp: false },
];

const ARTBOARD_ROLE_CLASSES = {
  body: "wireframe-artboard",
  heading: "wireframe-heading",
  meta: "wireframe-eyebrow",
  title: "wireframe-panel-title",
};

// Metadata sits closest to content because case and colour separate it as
// well; a title has only size and weight to work with, so it needs a real step.
const ARTBOARD_RAMP_SEPARATIONS = [
  { larger: "body", smaller: "meta", minimumRatio: 1.1 },
  { larger: "title", smaller: "body", minimumRatio: 1.25 },
  { larger: "heading", smaller: "title", minimumRatio: 1.2 },
];

const ARTBOARD_RAMP_ROLES = new Set(
  ARTBOARD_RAMP_SEPARATIONS.flatMap(({ larger, smaller }) => [larger, smaller]),
);

const remSize = (value) => {
  const match = /^([\d.]+)rem$/.exec(value.trim());
  return match?.[1] === undefined ? undefined : Number.parseFloat(match[1]);
};

const variableRole = (value) => {
  const match = /^var\(--wf-text-([a-z]+)\)$/.exec(value.trim());
  const role = match?.[1];
  return role !== undefined && ARTBOARD_RAMP_ROLES.has(role) ? role : undefined;
};

const selectorDevices = (selector) => {
  const devices = new Set();
  for (const match of selector.matchAll(
    /\[data-wireframe-device=["']([^"']+)["']\]/g,
  )) {
    const device = match[1];
    if (device !== undefined) {
      devices.add(device);
    }
  }
  return devices;
};

const selectorHasClass = (selector, className) =>
  new RegExp(`(?:^|[^a-zA-Z0-9_-])\\.${className}(?![a-zA-Z0-9_-])`).test(
    selector,
  );

const targetCompound = (selector) => {
  let start = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "\\") {
      index += 1;
    } else if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth -= 1;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")") {
      parenthesisDepth -= 1;
    } else if (
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      (character === ">" ||
        character === "+" ||
        character === "~" ||
        /\s/.test(character))
    ) {
      start = index + 1;
    }
  }
  return selector.slice(start).trim();
};

const roleForDeclaration = ({ selector, value }) => {
  const target = targetCompound(selector);
  for (const [role, className] of Object.entries(ARTBOARD_ROLE_CLASSES)) {
    if (!selectorHasClass(target, className)) {
      continue;
    }
    if (
      role === "title" &&
      selector.match(/\.wireframe-panel(?![a-zA-Z0-9_-])/g)?.length === 2 &&
      variableRole(value) === "meta"
    ) {
      return "meta";
    }
    return role;
  }
  return variableRole(value);
};

const selectorsFor = (declaration) =>
  declaration.parent?.type === "rule" ? declaration.parent.selectors : [];

const rampDeclarations = (root) => {
  const shared = {};
  const byDevice = new Map();
  root.walkDecls(/^--wf-text-/, (declaration) => {
    const role = declaration.prop.slice("--wf-text-".length);
    const size = remSize(declaration.value);
    if (!ARTBOARD_RAMP_ROLES.has(role) || size === undefined) {
      return;
    }
    for (const selector of selectorsFor(declaration)) {
      if (selector.trim() === ".wireframe") {
        shared[role] = size;
        continue;
      }
      if (!selectorHasClass(selector, "wireframe-screen")) {
        continue;
      }
      for (const device of selectorDevices(selector)) {
        const sizes = byDevice.get(device) ?? {};
        sizes[role] = size;
        byDevice.set(device, sizes);
      }
    }
  });
  return { shared, byDevice };
};

const roleSizesByDevice = ({ root, ramps }) => {
  const sizesByDevice = new Map(
    ARTBOARD_DEVICES.map(({ id }) => {
      const ramp = { ...ramps.shared, ...ramps.byDevice.get(id) };
      return [
        id,
        Object.fromEntries(
          [...ARTBOARD_RAMP_ROLES].map((role) => [role, new Set([ramp[role]])]),
        ),
      ];
    }),
  );
  root.walkDecls("font-size", (declaration) => {
    for (const selector of selectorsFor(declaration)) {
      const role = roleForDeclaration({ selector, value: declaration.value });
      if (role === undefined) {
        continue;
      }
      const constrainedDevices = selectorDevices(selector);
      for (const { id } of ARTBOARD_DEVICES) {
        if (constrainedDevices.size > 0 && !constrainedDevices.has(id)) {
          continue;
        }
        const ramp = { ...ramps.shared, ...ramps.byDevice.get(id) };
        const size =
          remSize(declaration.value) ?? ramp[variableRole(declaration.value)];
        if (size !== undefined) {
          sizesByDevice.get(id)?.[role]?.add(size);
        }
      }
    }
  });
  return sizesByDevice;
};

const checkArtboardTypeRamp = async (sourceRoot) => {
  const path = join(sourceRoot, ARTBOARD_RAMP_STYLESHEET);
  let stylesheet;
  try {
    stylesheet = await readFile(path, "utf8");
  } catch {
    // A source tree without the artboard stylesheet has no ramp to close.
    return [];
  }
  const root = postcss.parse(stylesheet, { from: path });
  const ramps = rampDeclarations(root);
  const sizesByDevice = roleSizesByDevice({ root, ramps });
  const failures = [];
  for (const { id, name, ownsRamp } of ARTBOARD_DEVICES) {
    const ownedRamp = ownsRamp ? ramps.byDevice.get(id) : ramps.shared;
    const sizes = sizesByDevice.get(id);
    if (sizes === undefined) {
      continue;
    }
    for (const { larger, smaller, minimumRatio } of ARTBOARD_RAMP_SEPARATIONS) {
      if (
        ownedRamp?.[larger] === undefined ||
        ownedRamp?.[smaller] === undefined
      ) {
        failures.push(
          `${ARTBOARD_RAMP_STYLESHEET}: ${name} ramp is missing --wf-text-${ownedRamp?.[larger] === undefined ? larger : smaller}`,
        );
        continue;
      }
      const largerSizes = [...sizes[larger]].filter(
        (size) => size !== undefined,
      );
      const smallerSizes = [...sizes[smaller]].filter(
        (size) => size !== undefined,
      );
      const pair = largerSizes
        .flatMap((largerSize) =>
          smallerSizes.map((smallerSize) => ({
            largerSize,
            smallerSize,
            ratio: largerSize / smallerSize,
          })),
        )
        .sort((left, right) => left.ratio - right.ratio)[0];
      if (pair === undefined) {
        continue;
      }
      const { largerSize, smallerSize, ratio } = pair;
      if (ratio < minimumRatio) {
        failures.push(
          `${ARTBOARD_RAMP_STYLESHEET}: ${name} ${larger} (${largerSize}rem) is only ${ratio.toFixed(2)}x ${smaller} (${smallerSize}rem); a reader cannot see a step that small, so make it at least ${minimumRatio}x`,
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

export const checkDesignSystem = async ({
  sourceRoot = DEFAULT_SOURCE_ROOT,
} = {}) => {
  const failures = [...(await checkArtboardTypeRamp(sourceRoot))];
  for (const module of await findModules(sourceRoot)) {
    const relativePath = relative(sourceRoot, module).replaceAll("\\", "/");
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
            `${relative(resolve(sourceRoot, ".."), module)}:${index + 1}: off-scale ${rule.name} "${match[0]}"; ${rule.advice}`,
          );
        }
      }
    });
  }
  return failures;
};

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const sourceRoot = resolve(process.cwd(), process.argv[2] ?? "src");
  const failures = await checkDesignSystem({ sourceRoot });
  if (failures.length > 0) {
    console.error(
      "design system: authored markup must pick from the closed scales in _internal/DESIGN_PRINCIPLES.md",
    );
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("design system: passed");
  }
}
