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
      // The framework-free plan model: compiled component models, shared
      // attribute validation, diagnostics, and pure fence parsers. This is
      // the contract every render target (and the future review app)
      // consumes; it imports nothing project-local by construction.
      model: {
        files: ["src/model/**/*.ts"],
        imports: ["**/model/**"],
        mayImport: [],
      },
      escapeHtml: {
        files: ["src/render/escape-html.ts"],
        imports: ["**/escape-html.js"],
        mayImport: [],
      },
      icons: {
        files: ["src/render/icons/**/*.ts"],
        imports: ["**/icons/**"],
        mayImport: [],
      },
      // The React render target: ports consuming compiled plan models,
      // SSR-only today. The review app later hydrates these same components.
      react: {
        files: ["src/react/**/*.ts", "src/react/**/*.tsx"],
        imports: ["**/react/**"],
        mayImport: ["model", "icons"],
      },
      codeBlock: {
        files: ["src/render/markdown/code-block/**/*.ts"],
        imports: ["**/markdown/code-block/**"],
        mayImport: ["icons"],
      },
      // Never-authorable presentation building blocks the registered
      // component directories compose; shared/ may reach down into icons but
      // never sideways into a component directory.
      componentShared: {
        files: ["src/render/markdown/components/shared/**/*.ts"],
        imports: ["**/components/shared/**"],
        mayImport: ["icons"],
      },
      components: {
        files: ["src/render/markdown/components/**/*.ts"],
        ignores: ["src/render/markdown/components/shared/**/*.ts"],
        imports: ["**/markdown/components/**"],
        mayImport: ["icons", "componentShared", "model", "react"],
      },
      markdown: {
        files: ["src/render/markdown/**/*.ts"],
        ignores: [
          "src/render/markdown/code-block/**/*.ts",
          "src/render/markdown/components/**/*.ts",
        ],
        // Direct Markdown-pipeline files only; the nested code-block and
        // typed-component concerns have their own dependency contracts.
        imports: ["**/markdown/*.js"],
        // Deliberately not escapeHtml: markdown escapes through
        // rehype-stringify, never by hand.
        mayImport: ["codeBlock", "components", "model"],
      },
      shell: {
        files: ["src/render/shell/**/*.ts"],
        imports: ["**/shell/**"],
        mayImport: ["escapeHtml", "codeBlock", "components", "componentShared"],
      },
      page: {
        files: ["src/render/page.ts"],
        imports: ["**/page.js"],
        mayImport: ["escapeHtml"],
      },
      composer: {
        files: ["src/render/*.ts"],
        ignores: ["src/render/page.ts", "src/render/escape-html.ts"],
        imports: ["**/render-document.js"],
        mayImport: ["markdown", "shell", "page"],
      },
      cli: {
        files: ["src/cli/**/*.ts"],
        imports: ["**/cli/**"],
        // The composer is the renderer's public entry point; granting only it
        // is what keeps the CLI out of the renderer's internals.
        mayImport: ["composer"],
      },
    };

    // Bottom to top; a layer's grants must point strictly downward.
    const TIERS = [
      ["model", "escapeHtml", "icons"],
      ["codeBlock", "page", "componentShared", "react"],
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
    // Model tests exercise the full authoring pipeline end to end, so they
    // may reach up into the markdown layer; production model code cannot.
    files: ["src/model/*.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Browser-side scripts run in the viewer, not Node.
    files: ["src/**/*.browser.ts"],
    languageOptions: { globals: globals.browser },
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
