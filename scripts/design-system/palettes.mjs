// Enforces the colour-theme contract described in _internal/DESIGN_PRINCIPLES.md: a
// palette is a set of shade ramps behind one shared role mapping, so every
// palette must supply every ramp step the roles reach, and every text pairing a
// document can produce must meet WCAG AA in that palette's light and dark half.
//
// This check owns the exact required pairings and the exact contrast floor;
// _internal/DESIGN_PRINCIPLES.md owns why colour is expressed as roles over ramps. The
// palette id list is authored in src/render/preference-options.js and
// re-exported by src/render/preferences.ts for application consumers.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import {
  PALETTES,
  STORED_PALETTES,
} from "../../src/render/preference-options.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const GLOBAL_CSS = resolve(REPO_ROOT, "src/render/global.css");
const SYNTAX_CSS = resolve(
  REPO_ROOT,
  "src/render/markdown/syntax-highlighting.css",
);

// The ramp namespaces a palette owns. A role may only reach a shade through one
// of these, which is what makes "a palette is its ramps" a complete statement.
const RAMP_NAMESPACES = [
  "grey",
  "primary",
  "success",
  "warning",
  "danger",
  "info",
  "note",
  "neutral",
];

const RAMP_STEP_PATTERN = new RegExp(
  `^(?:${RAMP_NAMESPACES.join("|")})-[0-9]+$`,
);

// What a palette block is allowed to say, beyond its ramps. A theme is its
// shades; the shape scales are open to it because a stark reading surface is a
// shape as much as a colour, and both are closed scales the design system
// already owns. A role is not on this list on purpose: restating one would let
// a theme drift from the role vocabulary every other theme shares.
const PALETTE_SCALE_PATTERN =
  /^(?:radius|font-weight|tracking|elevation)-[a-z0-9-]+$/;

// The one role a palette may restate, because its two halves cannot share a
// ramp position. src/render/global.css states why at the palette blocks.
const PALETTE_ROLE_EXCEPTIONS = new Set(["ink-c"]);

const SYNTAX_TOKEN_PATTERN = /^syntax-[a-z]+-(?:c|bg)$/;

// WCAG AA for body text. Every pairing below is text on a ground, so the large
// text allowance never applies: a plan is read at reading size.
const CONTRAST_FLOOR = 4.5;

// Reading surfaces a document can put primary or secondary text on. Tertiary
// text is deliberately absent from the bands: _internal/DESIGN_PRINCIPLES.md holds that a
// band carries primary or secondary text and never tertiary.
const PAGE_GROUNDS = ["--bg", "--raised-c"];
const BAND_GROUNDS = [
  "--surface-c",
  "--tray-c",
  "--well-c",
  "--header-bg",
  "--diff-content-bg",
  "--diff-hunk-bg",
  "--table-head-bg",
];
const CODE_GROUNDS = ["--diff-hunk-bg", "--diff-content-bg"];

const SYNTAX_TOKENS = [
  "--syntax-keyword-c",
  "--syntax-entity-c",
  "--syntax-constant-c",
  "--syntax-string-c",
  "--syntax-variable-c",
  "--syntax-comment-c",
  "--syntax-tag-c",
];

/** Every text-on-ground pairing a rendered document can produce. */
const requiredPairings = () => {
  const pairings = [];
  const add = (ink, ground) => pairings.push({ ink, ground });
  for (const ground of [...PAGE_GROUNDS, ...BAND_GROUNDS]) {
    add("--ink-c", ground);
    add("--muted-c", ground);
  }
  for (const ground of PAGE_GROUNDS) {
    add("--subtle-c", ground);
    add("--accent-c", ground);
  }
  add("--accent-c", "--surface-c");
  add("--accent-c", "--accent-soft-c");
  add("--accent-soft-ink-c", "--accent-soft-c");
  add("--accent-ink-c", "--accent-c");
  add("--bg", "--accent-c");
  for (const tone of ["note", "tip", "warning", "danger"]) {
    add(`--callout-${tone}-c`, `--callout-${tone}-bg`);
    add(`--callout-${tone}-ink`, `--callout-${tone}-bg`);
  }
  for (const side of ["add", "remove"]) {
    add(`--diff-${side}-c`, `--diff-${side}-bg`);
  }
  for (const side of ["pro", "con"]) {
    add(`--decision-${side}-c`, `--decision-${side}-bg`);
    add(`--decision-${side}-ink`, `--decision-${side}-bg`);
  }
  add("--annotation-c", "--annotation-bg");
  add("--annotation-ink", "--annotation-bg");
  add("--diff-hunk-c", "--diff-hunk-bg");
  for (const token of SYNTAX_TOKENS) {
    for (const ground of CODE_GROUNDS) add(token, ground);
  }
  add("--syntax-addition-c", "--syntax-addition-bg");
  add("--syntax-deletion-c", "--syntax-deletion-bg");
  return pairings;
};

/** Reads every custom property declared for the bare root and each palette. */
const readDeclarations = async (paths) => {
  const base = new Map();
  const palettes = new Map();
  for (const path of paths) {
    const root = postcss.parse(await readFile(path, "utf8"), { from: path });
    root.walkRules((rule) => {
      const selector = rule.selector.trim().replaceAll(/\s+/g, " ");
      const paletteMatch = /^\[data-palette="([a-z-]+)"\]$/.exec(selector);
      const isBase =
        selector === ":root" || selector === ':root, [data-palette="default"]';
      if (!isBase && paletteMatch === null) return;
      const id = paletteMatch?.[1];
      const target =
        id === undefined || id === "default"
          ? base
          : (palettes.get(id) ?? palettes.set(id, new Map()).get(id));
      rule.walkDecls((declaration) => {
        if (declaration.prop.startsWith("--")) {
          target.set(declaration.prop.slice(2), declaration.value);
        }
      });
    });
  }
  return { base, palettes };
};

/** Splits one function's arguments on its own top-level commas. */
const splitArguments = (text) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
};

/** Reads one balanced function call starting at the given opening name. */
const readCall = (text, name) => {
  const start = text.indexOf(`${name}(`);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start + name.length; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          end: index + 1,
          body: text.slice(start + name.length + 1, index),
        };
      }
    }
  }
  return null;
};

/** Resolves one declared value into a literal colour for one appearance mode. */
const resolveValue = ({ value, mode, lookup, seen = new Set() }) => {
  let text = value.trim();
  for (let pass = 0; pass < 24; pass += 1) {
    const lightDark = readCall(text, "light-dark");
    if (lightDark !== null) {
      const halves = splitArguments(lightDark.body);
      const half = mode === "light" ? halves[0] : halves[1];
      text = `${text.slice(0, lightDark.start)}${half}${text.slice(lightDark.end)}`;
      continue;
    }
    const variable = readCall(text, "var");
    if (variable !== null) {
      const name = splitArguments(variable.body)[0].replace(/^--/, "");
      if (seen.has(name)) return null;
      const declared = lookup(name);
      if (declared === undefined) return null;
      text = `${text.slice(0, variable.start)}${declared}${text.slice(variable.end)}`;
      continue;
    }
    return text.trim();
  }
  return null;
};

/** Converts a resolved literal into linear-light RGB, or null when opaque-unknown. */
const parseColor = (text) => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(text);
  if (hex !== null) {
    const value = Number.parseInt(hex[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const rgb = /^rgb\(\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*(?:\/.*)?\)$/.exec(
    text,
  );
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
};

const relativeLuminance = ([red, green, blue]) => {
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
};

const contrastRatio = (left, right) => {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Checks one palette set and returns every failure it found, so the caller
 * decides how to report. Inputs are injectable because the test exercises the
 * contract against a throwaway palette rather than today's five.
 */
export const checkPalettes = async ({
  globalCss = GLOBAL_CSS,
  syntaxCss = SYNTAX_CSS,
  paletteIds = PALETTES,
  storedPaletteIds = STORED_PALETTES,
} = {}) => {
  const failures = [];
  const { base, palettes } = await readDeclarations([globalCss, syntaxCss]);
  const themed = paletteIds.filter((id) => id !== "default");

  if (paletteIds[0] !== "default") {
    failures.push(
      "preferences.ts: PALETTES must offer the product's own palette first",
    );
  }
  if (storedPaletteIds.join(",") !== themed.join(",")) {
    failures.push(
      "preferences.ts: STORED_PALETTES must be PALETTES without the default, in the same order",
    );
  }

  for (const id of themed) {
    if (!palettes.has(id)) {
      failures.push(
        `global.css: palette "${id}" is offered in preferences.ts but declares no :root[data-palette="${id}"] block`,
      );
    }
  }
  for (const id of palettes.keys()) {
    if (!themed.includes(id)) {
      failures.push(
        `global.css: palette "${id}" is declared but is not in STORED_PALETTES in preferences.ts`,
      );
    }
  }

  for (const [id, declarations] of palettes) {
    const stray = [...declarations.keys()]
      .filter(
        (name) =>
          !RAMP_STEP_PATTERN.test(name) &&
          !PALETTE_SCALE_PATTERN.test(name) &&
          !SYNTAX_TOKEN_PATTERN.test(name) &&
          !PALETTE_ROLE_EXCEPTIONS.has(name),
      )
      .sort();
    if (stray.length > 0) {
      failures.push(
        `global.css: palette "${id}" declares ${stray.map((name) => `--${name}`).join(", ")}; a palette may declare ramp steps, syntax tokens, the closed radius, weight, tracking, and elevation scales, and ${[...PALETTE_ROLE_EXCEPTIONS].map((name) => `--${name}`).join(", ")}`,
      );
    }
  }

  // Every ramp step a role reaches has to exist in every palette, or that
  // palette silently borrows a shade from the default warm-grey ramp.
  const reachedSteps = new Set();
  for (const [name, value] of base) {
    if (RAMP_STEP_PATTERN.test(name)) continue;
    for (const [, step] of value.matchAll(/var\(--([a-z]+-[0-9]+)\)/g)) {
      if (RAMP_STEP_PATTERN.test(step)) reachedSteps.add(step);
    }
  }
  for (const id of themed) {
    const declarations = palettes.get(id);
    if (declarations === undefined) continue;
    const missing = [...reachedSteps]
      .filter((step) => !declarations.has(step))
      .sort();
    if (missing.length > 0) {
      failures.push(
        `global.css: palette "${id}" is missing ramp steps the roles reach: ${missing.map((step) => `--${step}`).join(", ")}`,
      );
    }
  }

  for (const id of paletteIds) {
    const overrides = palettes.get(id) ?? new Map();
    const lookup = (name) => overrides.get(name) ?? base.get(name);
    for (const mode of ["light", "dark"]) {
      for (const { ink, ground } of requiredPairings()) {
        // A role the stylesheet does not declare is not this check's business:
        // the Tailwind theme owns which roles exist, this check owns how the
        // ones that exist have to behave in every palette.
        if (
          base.get(ink.slice(2)) === undefined ||
          base.get(ground.slice(2)) === undefined
        ) {
          continue;
        }
        const inkValue = resolveValue({
          value: lookup(ink.slice(2)) ?? "",
          mode,
          lookup,
        });
        const groundValue = resolveValue({
          value: lookup(ground.slice(2)) ?? "",
          mode,
          lookup,
        });
        const inkColor = inkValue === null ? null : parseColor(inkValue);
        const groundColor =
          groundValue === null ? null : parseColor(groundValue);
        if (inkColor === null || groundColor === null) {
          failures.push(
            `${id}/${mode}: could not resolve ${ink} on ${ground} to a colour`,
          );
          continue;
        }
        const ratio = contrastRatio(inkColor, groundColor);
        if (ratio < CONTRAST_FLOOR) {
          failures.push(
            `${id}/${mode}: ${ink} (${inkValue}) on ${ground} (${groundValue}) is ${ratio.toFixed(2)}:1, below the ${CONTRAST_FLOOR}:1 WCAG AA floor`,
          );
        }
      }
    }
  }

  return { failures, paletteCount: paletteIds.length };
};

export { contrastRatio, parseColor, resolveValue, splitArguments };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { failures, paletteCount } = await checkPalettes();
  if (failures.length > 0) {
    console.error(
      "palettes: every palette must declare every ramp step the roles reach and meet WCAG AA in both halves",
    );
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`palettes: passed (${paletteCount} palettes)`);
  }
}
