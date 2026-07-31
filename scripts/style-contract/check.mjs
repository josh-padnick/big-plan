// Enforces the repository-wide CSS escape-hatch and cascade contract described
// in AGENTS.md. This check owns the exact marker and layer syntax.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const ESCAPE_HATCH_MARKER = "CSS escape hatch:";
const OVERRIDE_MARKER = "Override invariant:";
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
  /local readability/i,
];

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

/** Returns true only for root-scoped primitive declarations, never styling. */
const isRootPrimitiveRule = (rule) => {
  const selectors = rule.selectors;
  if (
    selectors.length === 0 ||
    selectors.some((selector) => !selector.trim().startsWith(":root"))
  ) {
    return false;
  }
  const declarations = rule.nodes?.filter((node) => node.type === "decl");
  return (
    declarations !== undefined &&
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
export const checkStylesheetContract = async ({ sourceRoot }) => {
  const failures = [];
  const cascadeDeclarations = [];
  for (const stylesheet of await findStylesheets(sourceRoot)) {
    const relativePath = relative(
      dirnameOfSource(sourceRoot),
      stylesheet,
    ).replaceAll("\\", "/");
    const root = postcss.parse(await readFile(stylesheet, "utf8"), {
      from: stylesheet,
    });
    const firstNode = root.first;
    const header = firstNode?.type === "comment" ? firstNode.text : "";
    if (
      !header.includes(ESCAPE_HATCH_MARKER) ||
      !CONCRETE_REASONS.some((reason) => reason.test(header))
    ) {
      failures.push(
        `${relativePath}:1: file-level comment must include "${ESCAPE_HATCH_MARKER}" and a concrete generated/external ownership, document-wide, token/keyframe, selector, primitive, or readability reason.`,
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
      } else if (!ALLOWED_BLOCK_LAYERS.has(layer.params)) {
        failures.push(
          diagnostic({
            relativePath,
            node: layer,
            message:
              'authored presentation blocks may use only "@layer components" or "@layer bp-state".',
          }),
        );
      }
    });

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
      const layer = ancestors.find((node) => node.name === "layer");
      if (layer === undefined) {
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
      if (layer.params === "bp-state") {
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
