// ESLint flat config. Two jobs: the typescript-eslint recommended baseline
// with the conventions ENGINEERING_PRACTICES.md promises (separate type
// imports), and the project-specific guardrails that convention alone cannot
// enforce - most importantly that Playwright specs use the extended test from
// test/fixtures (which fails on console errors) instead of importing
// @playwright/test.

import { readdirSync } from "node:fs";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "docs/",
      "node_modules/",
      "**/*.generated.ts",
      "examples/",
      "test-results/",
      "playwright-report/",
      ".agent-runs/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Playwright fixture signatures destructure an empty object by design.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
    },
  },
  // Architectural layering, declared as data and compiled to lint blocks.
  // Information flows one way: a layer knows what it calls and never what
  // calls it. The model is allow-list, default-deny: each layer names what it
  // may import (validated to sit in a strictly lower tier), and everything
  // else known is banned. A completeness guard walks src/ at lint startup and
  // throws if any file is not claimed by a layer, so a new file or folder
  // cannot silently join the codebase unmodeled - lint fails until it is
  // assigned. (Generated scopes are non-overlapping, which flat config's
  // last-match-wins on no-restricted-imports requires.)
  ...(() => {
    // A layer: where its files live, which import specifiers reach it, and
    // what it MAY import. Everything else known to the model is banned.
    const LAYERS = {
      // Guidance-bearing slide vocabulary is the shared bottom tier consumed
      // by model compilation, lint, component registration, and rendering.
      planVocabulary: {
        files: ["src/plan-vocabulary/**/*.ts"],
        imports: ["**/plan-vocabulary/**"],
        mayImport: [],
      },
      // Framework-free component compilers, authoring contracts, diagnostics,
      // and pure parsers stay at the bottom tier even though the file tree
      // co-locates them with the views and definitions that share their
      // product concept.
      model: {
        files: [
          "src/components/_authoring/**/*.ts",
          "src/components/_model/**/*.ts",
          "src/components/*/compile*.ts",
          "src/components/code-diff/unified-diff*.ts",
          "src/components/flow-diagram/anchors*.ts",
          "src/components/mermaid-diagram/anchors*.ts",
          "src/components/mermaid-diagram/fixtures*.ts",
          "src/components/mermaid-diagram/parse*.ts",
          "src/components/mermaid-diagram/renderer*.ts",
          "src/components/code-snippet/split-highlighted-lines*.ts",
          "src/components/data-table/parse-table-grid*.ts",
          "src/components/data-table/sort-values*.ts",
          "src/components/database-table-schema/derive-index-participation*.ts",
          "src/components/database-table-schema/parse-table-schema*.ts",
          "src/components/wireframe/catalog*.ts",
          "src/components/wireframe/model*.ts",
        ],
        imports: [
          "**/components/_authoring/**",
          "**/components/_model/**",
          "**/components/*/compile.js",
          "**/components/code-diff/unified-diff.js",
          "**/components/flow-diagram/anchors.js",
          "**/components/code-snippet/split-highlighted-lines.js",
          "**/components/data-table/parse-table-grid.js",
          "**/components/data-table/sort-values.js",
          "**/components/database-table-schema/derive-index-participation.js",
          "**/components/database-table-schema/parse-table-schema.js",
          "**/components/wireframe/catalog.js",
          "**/components/wireframe/model.js",
        ],
        mayImport: ["planVocabulary"],
      },
      escapeHtml: {
        files: ["src/render/escape-html.ts"],
        imports: ["**/escape-html.js"],
        mayImport: [],
      },
      // The persisted reviewer-preferences contract is shared by the head
      // bootstrap in the page envelope and the shell's settings script, so it
      // sits below both rather than inside either one.
      preferences: {
        files: ["src/render/preferences*.ts"],
        imports: ["**/preferences.js"],
        mayImport: [],
      },
      icons: {
        files: ["src/icons/**/*.ts"],
        imports: ["**/icons/lucide-icon.js", "**/icons/lucide/**"],
        mayImport: [],
      },
      // Validate-only authoring lint parses source independently and exposes
      // one framework-free interface over its private rule collection.
      planLint: {
        files: ["src/lint/**/*.ts"],
        imports: ["**/lint/**"],
        mayImport: ["planVocabulary"],
      },
      // React views and their never-authorable shared building blocks consume
      // compiled models without owning static serialization.
      ui: {
        files: [
          "src/components/_shared/**/*.ts",
          "src/components/_shared/**/*.tsx",
          "src/components/*/view*.ts",
          "src/components/*/view*.tsx",
        ],
        imports: ["**/components/_shared/**", "**/components/*/view*.js"],
        mayImport: ["model", "icons"],
      },
      components: {
        files: [
          "src/components/_registration/**/*.ts",
          "src/components/*/definition*.ts",
          "src/components/code-diff/test-fixtures.ts",
          "src/render/markdown/component-pipeline/**/*.ts",
        ],
        imports: [
          "**/components/_registration/**",
          "**/components/*/definition.js",
          "**/render/markdown/component-pipeline/**",
        ],
        mayImport: ["icons", "model", "planVocabulary", "ui"],
      },
      markdown: {
        files: ["src/render/markdown/**/*.ts"],
        ignores: ["src/render/markdown/component-pipeline/**/*.ts"],
        // Direct Markdown-pipeline files only; the nested typed-component
        // concern has its own dependency contract.
        imports: ["**/markdown/*.js"],
        // Deliberately not escapeHtml: markdown escapes through
        // rehype-stringify, never by hand. Icons are granted because document
        // transforms build chrome - the deck transform draws collapse
        // controls, the code-figure transform draws the maximize control - and
        // a glyph either drew itself would be locally defined icon data, which
        // the icons layer exists to prevent.
        mayImport: ["components", "icons", "model", "planVocabulary"],
      },
      shell: {
        files: ["src/render/shell/**/*.ts"],
        imports: ["**/shell/**"],
        // Script delivery reads the same figure-control vocabulary components
        // emit, so the shell consumes its model owner instead of copying it.
        mayImport: [
          "escapeHtml",
          "icons",
          "components",
          "model",
          "preferences",
        ],
      },
      page: {
        files: ["src/render/page.ts"],
        imports: ["**/page.js"],
        mayImport: ["escapeHtml", "preferences"],
      },
      composer: {
        files: ["src/render/*.ts"],
        ignores: [
          "src/render/page.ts",
          "src/render/escape-html.ts",
          "src/render/preferences*.ts",
        ],
        imports: [
          "**/compile-plan-model.js",
          "**/plan-id.js",
          "**/render-document.js",
          "**/serialize-html.js",
        ],
        mayImport: ["markdown", "shell", "page"],
      },
      // Browser-safe review models. These modules must stay usable by both the
      // browser island and the local review runtime.
      reviewShared: {
        files: ["src/review/shared/**/*.ts", "src/review/shared/**/*.tsx"],
        imports: ["**/review/shared/**"],
        mayImport: [],
        blockedImports: ["node:*"],
        blockedImportRegex: ["^\\.\\./"],
      },
      // The browser island may use only browser-owned presentation code,
      // browser-safe review models, and framework-neutral icons.
      reviewBrowser: {
        files: ["src/review/browser/**/*.ts", "src/review/browser/**/*.tsx"],
        imports: ["**/review/browser/**"],
        mayImport: ["icons", "reviewShared"],
        blockedImports: ["node:*"],
        blockedImportRegex: ["^\\.\\./(?!\\.|shared/)"],
      },
      // The local review runtime: loopback transport, session identity, the
      // reviewer's on-disk state, and the feedback package. It renders through
      // the composer's public entry points and owns no command I/O.
      review: {
        files: ["src/review/**/*.ts", "src/review/**/*.tsx"],
        ignores: [
          "src/review/browser/**/*.ts",
          "src/review/browser/**/*.tsx",
          "src/review/shared/**/*.ts",
          "src/review/shared/**/*.tsx",
        ],
        imports: ["**/review/**"],
        mayImport: ["composer", "icons", "planLint", "reviewShared"],
      },
      cli: {
        files: ["src/cli/**/*.ts"],
        imports: ["**/cli/**"],
        // The composer files are the renderer's public entry points; granting
        // only them keeps the CLI out of the renderer's internals.
        mayImport: ["composer", "planLint", "review", "reviewShared"],
      },
    };

    // Bottom to top; a layer's grants must point strictly downward.
    const TIERS = [
      ["planVocabulary", "escapeHtml", "icons", "preferences"],
      ["model", "planLint"],
      ["page", "ui"],
      ["components"],
      ["markdown", "shell"],
      ["composer", "reviewShared"],
      ["review", "reviewBrowser"],
      ["cli"],
    ];

    const names = Object.keys(LAYERS);
    const tierOf = (name) => TIERS.findIndex((tier) => tier.includes(name));

    // Model validation: every layer is placed in a tier, and every grant
    // points at a known layer in a strictly lower tier.
    for (const name of names) {
      if (tierOf(name) === -1) {
        throw new Error(
          `eslint.config.mjs layering: "${name}" is not placed in TIERS.`,
        );
      }
      for (const grant of LAYERS[name].mayImport) {
        if (!names.includes(grant)) {
          throw new Error(
            `eslint.config.mjs layering: "${name}" grants unknown layer "${grant}".`,
          );
        }
        if (tierOf(grant) >= tierOf(name)) {
          throw new Error(
            `eslint.config.mjs layering: "${name}" may not import "${grant}" - grants must point strictly downward in TIERS.`,
          );
        }
      }
    }

    // Minimal glob support for the patterns used above: **, *, and literals.
    // Tokens are translated in one pass so a replacement fragment can never
    // be rescanned and mangled by a later replacement.
    const globToRegExp = (glob) =>
      new RegExp(
        "^" +
          glob
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*\/|\*\*|\*/g, (token) =>
              token === "**/" ? "(?:.*/)?" : token === "**" ? ".*" : "[^/]*",
            ) +
          "$",
      );
    const matches = (path, globs) =>
      globs.some((g) => globToRegExp(g).test(path));

    // Completeness guard: every TypeScript file under src/ (generated files
    // excepted - they are lint-ignored build artifacts) must belong to
    // exactly one layer's file scope.
    const srcRoot = `${import.meta.dirname}/src`;
    const unclaimed = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolute = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        const relative = absolute.slice(import.meta.dirname.length + 1);
        // All TypeScript source flavors are guarded; generated build
        // artifacts are lint-ignored and exempt.
        if (
          !/\.(?:ts|tsx|mts|cts)$/.test(relative) ||
          relative.includes(".generated.")
        ) {
          continue;
        }
        const claimedBy = names.filter((name) => {
          const { files, ignores = [] } = LAYERS[name];
          return matches(relative, files) && !matches(relative, ignores);
        });
        if (claimedBy.length !== 1) {
          unclaimed.push(
            `${relative} (claimed by: ${claimedBy.join(", ") || "no layer"})`,
          );
        }
      }
    };
    walk(srcRoot);
    if (unclaimed.length > 0) {
      throw new Error(
        `eslint.config.mjs layering: every src/ file must belong to exactly one layer. Fix LAYERS for:\n  ${unclaimed.join("\n  ")}`,
      );
    }

    return names
      .map((name) => {
        const {
          files,
          ignores,
          mayImport,
          blockedImports = [],
          blockedImportRegex = [],
        } = LAYERS[name];
        const banned = names.filter(
          (other) => other !== name && !mayImport.includes(other),
        );
        if (banned.length === 0) {
          return null;
        }
        return {
          files,
          ...(ignores === undefined ? {} : { ignores }),
          rules: {
            "no-restricted-imports": [
              "error",
              {
                patterns: [
                  {
                    group: banned.flatMap((other) => LAYERS[other].imports),
                    message: `Layering: ${name} may import only [${mayImport.join(", ") || "nothing project-local"}]. Information flows one way; grant access via mayImport in eslint.config.mjs only if the flow stays downward.`,
                  },
                  ...(blockedImports.length === 0
                    ? []
                    : [
                        {
                          group: blockedImports,
                          message: `Layering: ${name} must remain browser-safe and may not import Node built-ins.`,
                        },
                      ]),
                  ...blockedImportRegex.map((regex) => ({
                    regex,
                    message: `Layering: ${name} may not import server-owned review modules.`,
                  })),
                ],
              },
            ],
          },
        };
      })
      .filter((block) => block !== null);
  })(),
  {
    // Co-located component tests may exercise the full authoring pipeline;
    // production compiler, view, and definition files remain boundary-checked.
    files: ["src/components/**/*.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Co-located renderer tests assert on serialized HTML, so they may reach
    // the composer's serializer; production markdown files stay HAST-only.
    files: ["src/render/**/*.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // live-target.browser.ts is the one owner of identity lookups against plan
    // DOM. A hand-written selector for a block id or a flow anchor skips its
    // article scoping, its lens-copy exclusion, and its drift check, and every
    // one of those omissions fails silently by resolving something plausible,
    // so the selector text itself is fenced to the resolver. The shell scripts
    // are fenced too even though they have no such lookup today: the layering
    // keeps the resolver out of their reach, so a first one there needs a
    // deliberate answer rather than a copied query.
    files: [
      "src/review/browser/**/*.ts",
      "src/review/browser/**/*.tsx",
      "src/render/shell/**/*.ts",
    ],
    ignores: ["src/review/browser/live-target.browser.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TemplateElement[value.raw=/data-(block-id|flow-anchor)="/], Literal[value=/data-(block-id|flow-anchor)="/]',
          message:
            "Resolve plan identity through live-target.browser.ts (liveBlock, liveFlowAnchor, liveLensAnchor); a raw identity selector skips article scoping, lens-copy exclusion, and the drift check.",
        },
      ],
    },
  },
  {
    // Node-runtime JavaScript: the bin shim and build-time generators.
    files: ["bin/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Browser-runtime JavaScript: the authored viewer sources a generator
    // bundles into the document. They never run in Node, so they get browser
    // globals rather than the project default.
    files: ["assets/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Playwright specs must go through the extended test in fixtures.ts so
    // every spec fails on console errors and uncaught page errors; importing
    // @playwright/test directly would silently opt out of that guarantee.
    files: ["test/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              message:
                "Import test and expect from ./fixtures so the spec fails on console errors.",
            },
          ],
        },
      ],
    },
  },
  {
    // fixtures.ts is the one legitimate importer of @playwright/test.
    files: ["test/fixtures.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // Prettier owns formatting; disable any style rules that would fight it.
  eslintConfigPrettier,
);
