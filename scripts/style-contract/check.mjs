// Enforces the repository-wide CSS escape-hatch and cascade contract described
// in ENGINEERING_PRACTICES.md. This check owns the exact marker and layer
// syntax, the volume a stylesheet may occupy, and where a stylesheet may live.
//
// The header markers say a file's CSS is justified in principle. The rules
// below say it is justified in fact: a rule selecting only classes styles an
// element its own view renders and belongs in utilities, and a file that keeps
// growing is buying volume that no single header sentence ever licensed.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import {
  DRAWING_SYSTEM_STYLESHEETS,
  RENDER_STYLESHEETS,
  STYLESHEET_BUDGETS,
} from "./allowlist.mjs";

const ESCAPE_HATCH_MARKER = "CSS escape hatch:";
const OVERRIDE_MARKER = "Override invariant:";
const UTILITY_FORM_MARKER = "Utility form:";
const CASCADE_ORDER = "theme, base, components, utilities, bp-state";
const CASCADE_ENTRYPOINT = "src/render/global.css";
const ALLOWED_BLOCK_LAYERS = new Set(["components", "bp-state"]);
const CONCRETE_REASONS = [
  /externally owned markup/i,
  /generated markup/i,
  /document-wide behavior/i,
  /token definitions?/i,
  /keyframe definitions?/i,
  /selector relationships?/i,
  /shared visual primitive/i,
];

/**
 * How many declarations a stylesheet with no recorded budget may hold. It is
 * enough for a token map or a handful of selector relationships, and far too
 * few for a parallel design system.
 */
const UNRECORDED_DECLARATION_BUDGET = 40;

// A class name is a CSS identifier, which is wider than the ASCII word a first
// draft reaches for: it may open with an underscore or hyphen, carry non-ASCII
// letters, or escape a character. The heuristic below has to recognize all of
// them, because a selector this check fails to parse is a selector that evades
// it, and `._card` evading the rule would defeat the rule.
const CSS_ESCAPE = String.raw`(?:\\[0-9A-Fa-f]{1,6}(?:\r\n|[ \t\n\f\r])?|\\[^\n])`;
const CSS_IDENTIFIER_START = String.raw`(?:${CSS_ESCAPE}|[A-Za-z_-]|[^\x00-\x7F])`;
const CSS_IDENTIFIER_REST = String.raw`(?:${CSS_ESCAPE}|[A-Za-z0-9_-]|[^\x00-\x7F])`;

/** Matches a selector naming only classes, with no other element to relate to. */
const CLASS_ONLY_COMPOUND = new RegExp(
  String.raw`^(?:\.${CSS_IDENTIFIER_START}${CSS_IDENTIFIER_REST}*)+$`,
);

const stripSelectorComments = (selector) => {
  let normalized = "";
  let quote;
  for (let index = 0; index < selector.length;) {
    const character = selector[index];
    if (character === "\\" && index + 1 < selector.length) {
      normalized += selector.slice(index, index + 2);
      index += 2;
    } else if (quote !== undefined) {
      normalized += character;
      if (character === quote) {
        quote = undefined;
      }
      index += 1;
    } else if (character === '"' || character === "'") {
      normalized += character;
      quote = character;
      index += 1;
    } else if (character === "/" && selector[index + 1] === "*") {
      const commentEnd = selector.indexOf("*/", index + 2);
      index = commentEnd === -1 ? selector.length : commentEnd + 2;
    } else {
      normalized += character;
      index += 1;
    }
  }
  return normalized;
};

const NO_VISUAL_OWNER =
  "stylesheet is outside a visual owner; use an authorable component folder, _shared/<visual-primitive>, src/review/browser, or a named src/render stylesheet.";

/** Reports whether a component or shared-primitive folder may own a stylesheet. */
const componentOwns = (segments) => {
  // A stylesheet needs an owning folder, not just a home under components: a
  // bare `src/components/styles.css` has no component to belong to, and its
  // file name would otherwise read as the owner.
  if (segments.length < 4) {
    return false;
  }
  const owner = segments[2];
  if (owner === undefined || owner.startsWith("_")) {
    return owner === "_shared" && segments.length >= 5
      ? !segments[3].startsWith("_")
      : false;
  }
  return true;
};

/**
 * Explains why the repository does not assign visual presentation ownership at
 * this path, or returns undefined when it does.
 */
const placementFailure = ({ relativePath, renderStylesheets }) => {
  const segments = relativePath.split("/");
  if (segments[0] !== "src") {
    return NO_VISUAL_OWNER;
  }
  if (segments[1] === "render") {
    if (segments[2] === "shell") {
      return "the shell owns viewer chrome and holds no stylesheet; presentation for another slice's markup belongs in that slice, colocated with the view that renders it.";
    }
    return renderStylesheets.has(relativePath)
      ? undefined
      : `src/render holds only the named document-wide stylesheets (${[...renderStylesheets].sort().join(", ")}); a stylesheet serving one slice belongs in that slice.`;
  }
  if (segments[1] === "review" && segments[2] === "browser") {
    return undefined;
  }
  if (segments[1] !== "components") {
    return NO_VISUAL_OWNER;
  }
  return componentOwns(segments) ? undefined : NO_VISUAL_OWNER;
};

/** Reports a rule that styles only classes, which no view needs a stylesheet for. */
const isClassOnlyRule = (rule) => {
  const selectors = postcss.list.comma(stripSelectorComments(rule.selector));
  return (
    selectors.length > 0 &&
    selectors.every((selector) => CLASS_ONLY_COMPOUND.test(selector.trim()))
  );
};

/**
 * Accepts the per-rule hatch: the utility string this rule replaces, written
 * out. The payload is the whole point, so a bare marker licenses nothing; an
 * empty `Utility form:` would turn the checkable claim back into a blanket.
 */
const declaresUtilityForm = (rule) => {
  const previous = rule.prev();
  if (previous?.type !== "comment") {
    return false;
  }
  const marker = previous.text.indexOf(UTILITY_FORM_MARKER);
  return (
    marker !== -1 &&
    previous.text.slice(marker + UTILITY_FORM_MARKER.length).trim().length > 0
  );
};

/** Finds every authored stylesheet below the supplied source root. */
const findStylesheets = async (sourceRoot) => {
  const stylesheets = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.name.endsWith(".css")) {
        stylesheets.push(absolute);
      }
    }
  };
  await visit(sourceRoot);
  return stylesheets.sort();
};

/** Distinguishes an escaped quote from one after a literal backslash pair. */
const isEscaped = ({ value, index }) => {
  let backslashCount = 0;
  for (
    let previous = index - 1;
    previous >= 0 && value[previous] === "\\";
    previous -= 1
  ) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

/** Consumes one balanced attribute or functional-pseudo segment. */
const consumeBalanced = ({ selector, start, open, close }) => {
  let depth = 0;
  let quote;
  for (let index = start; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote !== undefined) {
      if (character === quote && !isEscaped({ value: selector, index })) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
};

/** Accepts only :root itself plus attributes and pseudo-classes on that root. */
const isRootCompoundSelector = (selector) => {
  const value = selector.trim();
  if (!value.startsWith(":root")) {
    return false;
  }
  let index = ":root".length;
  while (index < value.length) {
    if (value[index] === "[") {
      index = consumeBalanced({
        selector: value,
        start: index,
        open: "[",
        close: "]",
      });
    } else if (value[index] === ":") {
      index += 1;
      const nameStart = index;
      while (/[a-zA-Z0-9_-]/.test(value[index] ?? "")) {
        index += 1;
      }
      if (index === nameStart) {
        return false;
      }
      if (value[index] === "(") {
        index = consumeBalanced({
          selector: value,
          start: index,
          open: "(",
          close: ")",
        });
      }
    } else {
      return false;
    }
    if (index === -1) {
      return false;
    }
  }
  return true;
};

// A colour theme is a set of token declarations that has to be selectable
// below the root as well as on it, so a settings swatch can carry one theme's
// shades inside a document painted in another. It declares tokens and nothing
// else, which is what keeps it a primitive rather than a styling rule.
const PALETTE_COMPOUND_SELECTOR = /^\[data-palette="[a-z0-9-]+"\]$/;

const isPrimitiveScopeSelector = (selector) =>
  isRootCompoundSelector(selector) ||
  PALETTE_COMPOUND_SELECTOR.test(selector.trim());

/** Returns true only for token-scope primitive declarations, never styling. */
const isRootPrimitiveRule = (rule) => {
  const selectors = rule.selectors;
  if (
    selectors.length === 0 ||
    selectors.some((selector) => !isPrimitiveScopeSelector(selector))
  ) {
    return false;
  }
  const declarations = [];
  rule.walkDecls((declaration) => {
    declarations.push(declaration);
  });
  return (
    declarations.length > 0 &&
    declarations.every(
      (declaration) =>
        declaration.prop.startsWith("--") ||
        declaration.prop === "color-scheme",
    )
  );
};

/** Formats one source-aware diagnostic without hiding the responsible rule. */
const diagnostic = ({ relativePath, node, message }) => {
  const line = node.source?.start?.line;
  return `${relativePath}${line === undefined ? "" : `:${line}`}: ${message}`;
};

/** Walks parents explicitly because PostCSS nodes expose one parent at a time. */
const ancestorsOf = (node) => {
  const ancestors = [];
  let parent = node.parent;
  while (parent !== undefined) {
    ancestors.push(parent);
    parent = parent.parent;
  }
  return ancestors;
};

/**
 * Checks every authored stylesheet and returns all failures so an agent can
 * repair the contract in one pass instead of discovering files serially.
 */
export const checkStylesheetContract = async ({
  sourceRoot,
  renderStylesheets = RENDER_STYLESHEETS,
  drawingSystems = DRAWING_SYSTEM_STYLESHEETS,
  budgets = STYLESHEET_BUDGETS,
}) => {
  const failures = [];
  const cascadeDeclarations = [];
  const foundPaths = new Set();
  for (const stylesheet of await findStylesheets(sourceRoot)) {
    const relativePath = relative(
      dirnameOfSource(sourceRoot),
      stylesheet,
    ).replaceAll("\\", "/");
    foundPaths.add(relativePath);
    const root = postcss.parse(await readFile(stylesheet, "utf8"), {
      from: stylesheet,
    });
    const placement = placementFailure({ relativePath, renderStylesheets });
    if (placement !== undefined) {
      failures.push(`${relativePath}:1: ${placement}`);
    }
    const firstNode = root.first;
    const header = firstNode?.type === "comment" ? firstNode.text : "";
    if (
      !header.includes(ESCAPE_HATCH_MARKER) ||
      !CONCRETE_REASONS.some((reason) => reason.test(header))
    ) {
      failures.push(
        `${relativePath}:1: file-level comment must include "${ESCAPE_HATCH_MARKER}" and a concrete generated/external ownership, document-wide, token/keyframe, selector, or shared-primitive reason; readability is not a file-level reason.`,
      );
    }

    const budget = budgets[relativePath];
    let declarationCount = 0;
    root.walkDecls(() => {
      declarationCount += 1;
    });
    if (budget === undefined) {
      if (declarationCount > UNRECORDED_DECLARATION_BUDGET) {
        failures.push(
          `${relativePath}:1: ${declarationCount} declarations exceed the ${UNRECORDED_DECLARATION_BUDGET} a stylesheet gets without a recorded budget; move what the view owns into utilities, or record this size in scripts/style-contract/allowlist.mjs and say in review what bought it.`,
        );
      }
    } else if (declarationCount > budget.declarations) {
      failures.push(
        `${relativePath}:1: ${declarationCount} declarations exceed the recorded budget of ${budget.declarations}; a stylesheet may shrink freely but grows only by raising its entry in scripts/style-contract/allowlist.mjs.`,
      );
    }

    root.walkAtRules("layer", (layer) => {
      if (layer.nodes === undefined) {
        cascadeDeclarations.push({ relativePath, layer });
        if (layer.params !== CASCADE_ORDER) {
          failures.push(
            diagnostic({
              relativePath,
              node: layer,
              message: `layer-order declaration must be exactly "@layer ${CASCADE_ORDER};".`,
            }),
          );
        }
      } else {
        if (!ALLOWED_BLOCK_LAYERS.has(layer.params)) {
          failures.push(
            diagnostic({
              relativePath,
              node: layer,
              message:
                'authored presentation blocks may use only "@layer components" or "@layer bp-state".',
            }),
          );
        }
        if (
          ancestorsOf(layer).some(
            (ancestor) =>
              ancestor.type === "atrule" && ancestor.name === "layer",
          )
        ) {
          failures.push(
            diagnostic({
              relativePath,
              node: layer,
              message:
                "nested layer blocks obscure the effective cascade owner; use one top-level layer block.",
            }),
          );
        }
      }
    });

    const classOnlyRules = [];
    root.walkRules((rule) => {
      const ancestors = ancestorsOf(rule).filter(
        (node) => node.type === "atrule",
      );
      if (
        ancestors.some(
          (node) =>
            node.name === "keyframes" || node.name === "-webkit-keyframes",
        )
      ) {
        return;
      }
      if (isClassOnlyRule(rule) && !declaresUtilityForm(rule)) {
        classOnlyRules.push(rule);
      }
      const layers = ancestors.filter((node) => node.name === "layer");
      if (layers.length === 0) {
        if (!isRootPrimitiveRule(rule)) {
          failures.push(
            diagnostic({
              relativePath,
              node: rule,
              message:
                'presentation rule is unlayered; use "components" or a justified "bp-state" override.',
            }),
          );
        }
        return;
      }
      if (layers.some((layer) => layer.params === "bp-state")) {
        const previous = rule.prev();
        if (
          previous?.type !== "comment" ||
          !previous.text.includes(OVERRIDE_MARKER)
        ) {
          failures.push(
            diagnostic({
              relativePath,
              node: rule,
              message: `bp-state rule requires an adjacent "${OVERRIDE_MARKER}" comment naming the resting utility or invariant it must beat.`,
            }),
          );
        }
      }
    });

    if (drawingSystems.has(relativePath)) {
      // A drawing system is exempt from the class-only rule, so recorded debt
      // for one is never validated and never falls to zero. Say so rather than
      // letting the two inventories disagree in silence.
      if (budget?.classOnlyRules !== undefined) {
        failures.push(
          `${relativePath}:1: recorded both as a drawing system and as class-only debt; a drawing system is exempt from that rule, so drop classOnlyRules from its budget in scripts/style-contract/allowlist.mjs.`,
        );
      }
    } else {
      const recorded = budget?.classOnlyRules ?? 0;
      if (recorded === 0) {
        for (const rule of classOnlyRules) {
          failures.push(
            diagnostic({
              relativePath,
              node: rule,
              message: `"${rule.selector}" selects only classes, so it styles an element its own view renders; put these declarations in utilities on that markup, add an adjacent "${UTILITY_FORM_MARKER}" comment spelling out the utility string when it is genuinely unreadable, or declare this file a drawing system in scripts/style-contract/allowlist.mjs.`,
            }),
          );
        }
      } else if (classOnlyRules.length !== recorded) {
        failures.push(
          `${relativePath}:1: ${classOnlyRules.length} class-only-selector rules against a recorded debt of ${recorded}; this debt only shrinks, so record ${classOnlyRules.length} in scripts/style-contract/allowlist.mjs and drop the entry once it reaches zero.`,
        );
      }
    }
  }

  for (const recordedPath of [
    ...renderStylesheets,
    ...drawingSystems,
    ...Object.keys(budgets),
  ]) {
    if (!foundPaths.has(recordedPath)) {
      failures.push(
        `${recordedPath}: recorded in scripts/style-contract/allowlist.mjs but no such stylesheet exists; remove the stale entry.`,
      );
    }
  }

  const canonicalDeclarations = cascadeDeclarations.filter(
    ({ layer }) => layer.params === CASCADE_ORDER,
  );
  if (
    canonicalDeclarations.length !== 1 ||
    canonicalDeclarations[0].relativePath !== CASCADE_ENTRYPOINT
  ) {
    const locations = canonicalDeclarations
      .map(({ relativePath }) => relativePath)
      .join(", ");
    failures.push(
      `${CASCADE_ENTRYPOINT}: exactly one canonical "@layer ${CASCADE_ORDER};" declaration is required at the stylesheet entrypoint${locations.length === 0 ? "" : `; found at ${locations}`}.`,
    );
  }
  return failures;
};

/** Keeps fixture roots and the real src/ root on the same relative path base. */
const dirnameOfSource = (sourceRoot) => resolve(sourceRoot, "..");

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const sourceRoot = resolve(process.cwd(), process.argv[2] ?? "src");
  const failures = await checkStylesheetContract({ sourceRoot });
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("stylesheet contract: passed");
  }
}
