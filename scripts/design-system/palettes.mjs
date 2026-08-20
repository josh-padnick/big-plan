// Enforces the colour-theme contract described in _internal/DESIGN_PRINCIPLES.md: a
// palette is a set of shade ramps behind one shared role mapping, so every
// palette must supply every shade the roles reach, its chrome shades must run
// in the order their names claim, every text pairing a document can produce
// must meet WCAG AA in that palette's light and dark half, and every control
// boundary on a chrome band must meet the WCAG 1.4.11 non-text floor in both
// halves too.
//
// This check owns the exact required pairings and the exact contrast floors;
// DESIGN_PRINCIPLES.md owns why colour is expressed as roles over ramps. The
// palette id list is authored in src/render/preference-options.js and
// re-exported by src/render/preferences.ts for application consumers. A palette
// block is matched by its bare [data-palette="<id>"] selector, so a message
// that names one has to spell it that way.

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
// of these, plus the named chrome shades below, which is what makes "a palette
// is its shades" a complete statement.
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

// The chrome shades a palette declares by name rather than by ramp position.
// A ramp number is a lightness position, lowest lightest, and the dark half of
// the chrome ladder cannot honour that: its band is the darkest shade and its
// control edge the lightest, so the ladder climbs where the numbers descend.
// Naming them keeps every numeric step a lightness position. src/render/global.css
// states the ladder; CHROME_DARK_LADDER below is the executable form of it.
const CHROME_DARK_SHADES = [
  "chrome-dark-band",
  "chrome-dark-lift",
  "chrome-dark-edge",
  "chrome-dark-edge-strong",
];

const CHROME_SHADE_PATTERN = new RegExp(
  `^(?:${CHROME_DARK_SHADES.join("|")})$`,
);

// The dark chrome ladder, darkest first. A lift that does not lift, or an edge
// that sinks under the band it bounds, is the palette-conditional defect this
// order exists to refuse: it fails silently, because every shade on its own
// still looks like a plausible chrome grey.
const CHROME_DARK_LADDER = CHROME_DARK_SHADES;

// Ramps whose numbers a palette must keep as a lightness ladder, lowest
// lightest. Only the chrome ramp qualifies today: the reading ramps park role
// anchors at fixed numbers rather than ladder positions - --grey-150 carries
// the dark half's ink, and the brutalist palette hangs its hard structural
// edge on --grey-200, --grey-250, --grey-750 and --grey-800 - so their numbers
// have never been a lightness order and this check does not pretend otherwise.
const LADDER_RAMPS = ["neutral"];

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

// The commenting chrome. Its bands are approved local colours in the product
// palette rather than ramp steps, so a guest palette has to restate them or the
// comment card keeps the product's warm greys inside a themed document.
// src/render/global.css states which step each one takes.
const COMMENT_SURFACE_TOKEN_PATTERN = /^comment-[a-z]+-c$/;

// WCAG AA for body text. Every pairing below is text on a ground, so the large
// text allowance never applies: a plan is read at reading size.
const CONTRAST_FLOOR = 4.5;

// WCAG 1.4.11 for non-text contrast: the boundary that tells a reader where a
// control is, and the firmer one that says the control is under the pointer or
// open. A boundary below this floor is a control that dissolves into its band,
// which is how a palette silently loses a control the other palettes keep.
const NON_TEXT_FLOOR = 3;

// Reading surfaces a document can put primary or secondary text on. Tertiary
// text is deliberately absent from the bands: _internal/DESIGN_PRINCIPLES.md holds that a
// band carries primary or secondary text and never tertiary.
const PAGE_GROUNDS = ["--bg", "--raised-c"];
const BAND_GROUNDS = [
  "--surface-c",
  "--toolbar-surface-c",
  "--tray-c",
  "--well-c",
  "--header-bg",
  "--toolbar-bg",
  "--diff-content-bg",
  "--diff-hunk-bg",
  "--table-head-bg",
];
const CODE_GROUNDS = ["--diff-hunk-bg", "--diff-content-bg"];

// Control boundaries on the toolbar band, and the ground each one is seen
// against. A control's edge is the only thing separating it from the band it
// sits on, so it answers to the non-text floor rather than to the text one.
// The reading surface's own hairlines are deliberately absent: they divide
// passages of a document rather than bound a control, and 1.4.11 governs
// controls.
const CONTROL_EDGE_PAIRINGS = [
  { edge: "--toolbar-edge-c", ground: "--toolbar-bg" },
  { edge: "--toolbar-edge-strong-c", ground: "--toolbar-bg" },
  { edge: "--toolbar-edge-strong-c", ground: "--toolbar-surface-c" },
];

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

/**
 * Resolves one declared value into a literal colour for one appearance mode.
 * The pass cap is the bound on the substitution: a role that names itself, or a
 * chain longer than the design system ever builds, runs out of passes and comes
 * back unresolved rather than looping. A visited set cannot take its place,
 * because one value legitimately names the same property twice - --elevation-focus
 * names --accent-c in both light-dark() halves before the mode collapses them.
 */
const resolveValue = ({ value, mode, lookup }) => {
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
 * Reads one declared shade as a literal colour, or null when it is absent or
 * is not a plain literal. A shade is authored as a hex, so anything else is
 * something other than a shade and is not this check's business.
 */
const shadeLuminance = (declared) => {
  if (declared === undefined) return null;
  const color = parseColor(declared.trim());
  return color === null ? null : relativeLuminance(color);
};

/**
 * Checks that a set of shades, given darkest-first or lightest-first, actually
 * runs that way. Returns the first pair that breaks the order, so the message
 * can name the two shades a reader has to look at rather than the whole ladder.
 */
const brokenRung = (ordered, luminanceOf, direction) => {
  let previous = null;
  for (const name of ordered) {
    const luminance = luminanceOf(name);
    if (luminance === null) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      const climbs = luminance > previous.luminance + 1e-9;
      const sinks = luminance < previous.luminance - 1e-9;
      if (direction === "lighter" ? sinks : climbs) {
        return { from: previous, to: { name, luminance } };
      }
    }
    previous = { name, luminance };
  }
  return null;
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
      "preference-options.js: PALETTES must offer the product's own palette first",
    );
  }
  if (storedPaletteIds.join(",") !== themed.join(",")) {
    failures.push(
      "preference-options.js: STORED_PALETTES must be PALETTES without the default, in the same order",
    );
  }

  for (const id of themed) {
    if (!palettes.has(id)) {
      failures.push(
        `global.css: palette "${id}" is offered in preference-options.js but declares no [data-palette="${id}"] block`,
      );
    }
  }
  for (const id of palettes.keys()) {
    if (!themed.includes(id)) {
      failures.push(
        `global.css: palette "${id}" is declared but is not in STORED_PALETTES in preference-options.js`,
      );
    }
  }

  for (const [id, declarations] of palettes) {
    const stray = [...declarations.keys()]
      .filter(
        (name) =>
          !RAMP_STEP_PATTERN.test(name) &&
          !CHROME_SHADE_PATTERN.test(name) &&
          !PALETTE_SCALE_PATTERN.test(name) &&
          !SYNTAX_TOKEN_PATTERN.test(name) &&
          !COMMENT_SURFACE_TOKEN_PATTERN.test(name) &&
          !PALETTE_ROLE_EXCEPTIONS.has(name),
      )
      .sort();
    if (stray.length > 0) {
      failures.push(
        `global.css: palette "${id}" declares ${stray.map((name) => `--${name}`).join(", ")}; a palette may declare ramp steps, chrome shades, syntax tokens, comment-surface tokens, the closed radius, weight, tracking, and elevation scales, and ${[...PALETTE_ROLE_EXCEPTIONS].map((name) => `--${name}`).join(", ")}`,
      );
    }
  }

  // Every ramp step a role reaches has to exist in every palette, or that
  // palette silently borrows a shade from the default warm-grey ramp.
  const reachedSteps = new Set();
  for (const [name, value] of base) {
    if (RAMP_STEP_PATTERN.test(name) || CHROME_SHADE_PATTERN.test(name)) {
      continue;
    }
    for (const [, step] of value.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
      if (RAMP_STEP_PATTERN.test(step) || CHROME_SHADE_PATTERN.test(step)) {
        reachedSteps.add(step);
      }
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
        `global.css: palette "${id}" is missing shades the roles reach: ${missing.map((step) => `--${step}`).join(", ")}`,
      );
    }
  }

  // A number in a ramp is a lightness position, and a named chrome shade is a
  // rung on the dark ladder. Both only mean anything if they hold, and neither
  // fails loudly: a step out of order still renders, it just quietly stops
  // saying what its name says.
  for (const id of paletteIds) {
    const declared = palettes.get(id) ?? base;
    const luminanceOf = (name) =>
      shadeLuminance(declared.get(name) ?? base.get(name));
    for (const namespace of LADDER_RAMPS) {
      const steps = [...declared.keys()]
        .filter((name) => name.startsWith(`${namespace}-`))
        .filter((name) => RAMP_STEP_PATTERN.test(name))
        .sort(
          (left, right) =>
            Number(left.slice(namespace.length + 1)) -
            Number(right.slice(namespace.length + 1)),
        );
      const broken = brokenRung(steps, luminanceOf, "darker");
      if (broken !== null) {
        failures.push(
          `global.css: palette "${id}" ramp --${broken.from.name} (${broken.from.luminance.toFixed(3)}) is darker than --${broken.to.name} (${broken.to.luminance.toFixed(3)}); a higher ramp number must never be lighter`,
        );
      }
    }
    const brokenChrome = brokenRung(CHROME_DARK_LADDER, luminanceOf, "lighter");
    if (brokenChrome !== null) {
      failures.push(
        `global.css: palette "${id}" chrome shade --${brokenChrome.to.name} (${brokenChrome.to.luminance.toFixed(3)}) is not lighter than --${brokenChrome.from.name} (${brokenChrome.from.luminance.toFixed(3)}); the dark chrome ladder climbs from the band to its firmest edge`,
      );
    }
  }

  for (const id of paletteIds) {
    const overrides = palettes.get(id) ?? new Map();
    const lookup = (name) => overrides.get(name) ?? base.get(name);
    for (const mode of ["light", "dark"]) {
      for (const { edge, ground } of CONTROL_EDGE_PAIRINGS) {
        if (
          base.get(edge.slice(2)) === undefined ||
          base.get(ground.slice(2)) === undefined
        ) {
          continue;
        }
        const edgeValue = resolveValue({
          value: lookup(edge.slice(2)) ?? "",
          mode,
          lookup,
        });
        const groundValue = resolveValue({
          value: lookup(ground.slice(2)) ?? "",
          mode,
          lookup,
        });
        const edgeColor = edgeValue === null ? null : parseColor(edgeValue);
        const groundColor =
          groundValue === null ? null : parseColor(groundValue);
        if (edgeColor === null || groundColor === null) {
          failures.push(
            `${id}/${mode}: could not resolve ${edge} on ${ground} to a colour`,
          );
          continue;
        }
        const ratio = contrastRatio(edgeColor, groundColor);
        if (ratio < NON_TEXT_FLOOR) {
          failures.push(
            `${id}/${mode}: ${edge} (${edgeValue}) on ${ground} (${groundValue}) is ${ratio.toFixed(2)}:1, below the ${NON_TEXT_FLOOR}:1 WCAG 1.4.11 non-text floor`,
          );
        }
      }
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
      "palettes: every palette must declare every shade the roles reach, keep its ladders in order, meet WCAG AA on text, and meet the WCAG 1.4.11 non-text floor on control edges in both halves",
    );
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`palettes: passed (${paletteCount} palettes)`);
  }
}
