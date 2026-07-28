// ESLint flat config. Two jobs: the typescript-eslint recommended baseline
// with the conventions AGENTS.md promises (separate type imports), and the
// project-specific guardrails that convention alone cannot enforce - most
// importantly that Playwright specs use the extended test from test/fixtures
// (which fails on console errors) instead of importing @playwright/test.

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
      // Framework-free component compilers, authoring contracts, diagnostics,
      // and pure parsers stay at the bottom tier even though the file tree
      // co-locates them with the views and definitions that share their
      // product concept.
      model: {
        files: [
          "src/components/_authoring/**/*.ts",
          "src/components/*/compile*.ts",
          "src/components/code-diff/unified-diff*.ts",
          "src/components/code-snippet/split-highlighted-lines*.ts",
          "src/components/database-table-schema/derive-index-participation*.ts",
          "src/components/database-table-schema/parse-table-schema*.ts",
          "src/components/file-tree/derive-tree-view*.ts",
          "src/components/file-tree/parse-tree-text*.ts",
        ],
        imports: [
          "**/components/_authoring/**",
          "**/components/*/compile.js",
          "**/components/code-diff/unified-diff.js",
          "**/components/code-snippet/split-highlighted-lines.js",
          "**/components/database-table-schema/derive-index-participation.js",
          "**/components/database-table-schema/parse-table-schema.js",
          "**/components/file-tree/derive-tree-view.js",
          "**/components/file-tree/parse-tree-text.js",
        ],
        mayImport: [],
      },
      escapeHtml: {
        files: ["src/render/escape-html.ts"],
        imports: ["**/escape-html.js"],
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
        mayImport: [],
      },
      // React views and their never-authorable shared building blocks consume
      // compiled models without owning static serialization.
      ui: {
        files: [
          "src/components/_shared/**/*.ts",
          "src/components/_shared/**/*.tsx",
          "src/components/*/view*.ts",
          "src/components/*/view*.tsx",
          "src/components/file-tree/*-view.tsx",
        ],
        imports: [
          "**/components/_shared/**",
          "**/components/*/view*.js",
          "**/components/file-tree/*-view.js",
        ],
        mayImport: ["model", "icons"],
      },
      components: {
        files: [
          "src/components/_registration/**/*.ts",
          "src/components/*/definition*.ts",
          "src/components/file-tree/*-definition*.ts",
          "src/components/code-diff/test-fixtures.ts",
          "src/render/markdown/component-pipeline/**/*.ts",
        ],
        imports: [
          "**/components/_registration/**",
          "**/components/*/definition.js",
          "**/components/file-tree/*-definition.js",
          "**/render/markdown/component-pipeline/**",
        ],
        mayImport: ["icons", "model", "ui"],
      },
      markdown: {
        files: ["src/render/markdown/**/*.ts"],
        ignores: ["src/render/markdown/component-pipeline/**/*.ts"],
        // Direct Markdown-pipeline files only; the nested typed-component
        // concern has its own dependency contract.
        imports: ["**/markdown/*.js"],
        // Deliberately not escapeHtml: markdown escapes through
        // rehype-stringify, never by hand.
        mayImport: ["components", "model"],
      },
      shell: {
        files: ["src/render/shell/**/*.ts"],
        imports: ["**/shell/**"],
        mayImport: ["escapeHtml", "icons", "components"],
      },
      page: {
        files: ["src/render/page.ts"],
        imports: ["**/page.js"],
        mayImport: ["escapeHtml"],
      },
      composer: {
        files: ["src/render/*.ts"],
        ignores: ["src/render/page.ts", "src/render/escape-html.ts"],
        imports: ["**/compile-plan-model.js", "**/render-document.js"],
        mayImport: ["markdown", "shell", "page"],
      },
      cli: {
        files: ["src/cli/**/*.ts"],
        imports: ["**/cli/**"],
        // The composer files are the renderer's public entry points; granting
        // only them keeps the CLI out of the renderer's internals.
        mayImport: ["composer", "planLint"],
      },
    };

    // Bottom to top; a layer's grants must point strictly downward.
    const TIERS = [
      ["model", "escapeHtml", "icons", "planLint"],
      ["page", "ui"],
      ["components"],
      ["markdown", "shell"],
      ["composer"],
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
        const { files, ignores, mayImport } = LAYERS[name];
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
    // Node-runtime JavaScript: the bin shim and build-time generators.
    files: ["bin/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
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
