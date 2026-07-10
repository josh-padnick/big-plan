// ESLint flat config. Two jobs: the typescript-eslint recommended baseline
// with the conventions AGENTS.md promises (separate type imports), and the
// project-specific guardrails that convention alone cannot enforce - most
// importantly that Playwright specs use the extended test from test/fixtures
// (which fails on console errors) instead of importing @playwright/test.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
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
  // calls it. TIERS lists layers bottom to top; a layer may import lower
  // tiers, never its own tier's siblings, never higher tiers. FACADES adds
  // the entry-point rule: outside a feature, its internals are reached only
  // through the named facade. Renaming or adding a folder means editing one
  // LAYERS entry; the lint blocks are generated. (Generated scopes are
  // non-overlapping, which flat config's last-match-wins requires.)
  ...(() => {
    // A layer: where its files live, and which import specifiers reach it.
    const LAYERS = {
      escapeHtml: {
        files: ["src/render/escape-html.ts"],
        imports: ["**/escape-html.js"],
      },
      markdown: {
        files: ["src/render/markdown/**/*.ts"],
        imports: ["**/markdown/**"],
      },
      shell: {
        files: ["src/render/shell/**/*.ts"],
        imports: ["**/shell/**"],
      },
      page: {
        files: ["src/render/page.ts"],
        imports: ["**/page.js"],
      },
      composer: {
        files: ["src/render/*.ts"],
        ignores: ["src/render/page.ts", "src/render/escape-html.ts"],
        imports: ["**/render-document.js"],
      },
      cli: {
        files: ["src/cli/**/*.ts"],
        imports: ["**/cli/**"],
      },
    };

    // Bottom to top. Inner arrays are tiers of mutually-isolated siblings.
    const TIERS = [
      ["escapeHtml"],
      ["markdown", "shell", "page"],
      ["composer"],
      ["cli"],
    ];

    // Entry-point rules: these layers reach the listed internals only
    // through the facade layer.
    const FACADES = [
      {
        facade: "composer",
        internals: ["markdown", "shell", "page", "escapeHtml"],
        appliesTo: ["cli"],
      },
    ];

    // Design facts the tier order cannot express, as named exceptions:
    // markdown escapes through rehype-stringify, never by hand, so it may
    // not reach the shared escaper even though it sits a tier below.
    const EXTRA_BANS = [{ layer: "markdown", bans: ["escapeHtml"] }];

    const tierOf = (name) => TIERS.findIndex((tier) => tier.includes(name));

    return Object.keys(LAYERS)
      .map((name) => {
        const { files, ignores } = LAYERS[name];
        const banned = new Set(
          Object.keys(LAYERS).filter(
            (other) => other !== name && tierOf(other) >= tierOf(name),
          ),
        );
        for (const extra of EXTRA_BANS) {
          if (extra.layer === name) {
            for (const ban of extra.bans) banned.add(ban);
          }
        }
        for (const { facade, internals, appliesTo } of FACADES) {
          if (appliesTo.includes(name)) {
            for (const internal of internals) banned.add(internal);
            void facade;
          }
        }
        if (banned.size === 0) {
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
                    group: [...banned].flatMap(
                      (other) => LAYERS[other].imports,
                    ),
                    message: `Layering: ${name} may import only layers below itself; information flows one way, and a layer never knows what calls it. See TIERS, FACADES, and EXTRA_BANS in eslint.config.mjs.`,
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
);
