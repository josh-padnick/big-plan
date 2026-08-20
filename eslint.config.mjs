// ESLint flat config. Two jobs: the typescript-eslint recommended baseline
// with the conventions _internal/ENGINEERING_PRACTICES.md promises (separate type
// imports), and the project-specific guardrails that convention alone cannot
// enforce - most importantly that Playwright specs use the extended test from
// test/fixtures (which fails on console errors) instead of importing
// @playwright/test.

import { readdirSync } from "node:fs";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

// The two bespoke syntax fences below are declared as data because the review
// island and the shell are both in scope for both. Flat config replaces a
// rule's options rather than merging them, so declaring `no-restricted-syntax`
// twice over the same file silently drops one fence - the exact quiet failure
// both exist to stop.

// live-target.browser.ts is the one owner of identity lookups against plan
// DOM. A hand-written selector for a block id or a flow anchor skips its
// article scoping, its lens-copy exclusion, and its drift check, and every
// one of those omissions fails silently by resolving something plausible,
// so the selector text itself is fenced to the resolver. The shell scripts
// are fenced too even though they have no such lookup today: the layering
// keeps the resolver out of their reach, so a first one there needs a
// deliberate answer rather than a copied query.
const PLAN_IDENTITY_SELECTOR = {
  selector:
    'TemplateElement[value.raw=/data-(block-id|flow-anchor)="/], Literal[value=/data-(block-id|flow-anchor)="/]',
  message:
    "Resolve plan identity through live-target.browser.ts (liveBlock, liveFlowAnchor, liveLensAnchor); a raw identity selector skips article scoping, lens-copy exclusion, and the drift check.",
};

// Anything laid out as a grid in a bounded column must say what its column
// is. A grid item keeps `min-width: auto`, so an implicit track is floored at
// the widest item's min-content width and the whole container grows past the
// panel - which a scrolling panel then hides rather than reports. That is how
// one pasted code line clipped every card in the feedback sidebar (BIG-185).
// Naming the track (`grid-cols-[minmax(0,1fr)]` on a one-column surface) is
// the one-word answer, and it is fenced because the failure is silent: the
// markup is valid, the cascade is clean, and only a reader at a narrow width
// ever sees it. Nothing at runtime fails when the declaration goes missing,
// so this fence is the whole guard rather than a second one.
//
// The fence covers two regimes that share that failure shape. The review
// sidebar is a fixed-width column whose containers are one column by
// construction, which is what makes `minmax(0, 1fr)` always the right answer
// there. The shell is the reading chrome: its one-column grids want the same
// declaration, and its multi-column layouts already name a track (`[12rem_1fr]`
// beside the settings list, `[auto_minmax(0,1fr)_auto]` in the branding bar).
// The fence requires a declared track, not that one-column recipe, so a named
// multi-column track is compliant.
//
// Plan-component views stay out. An earlier sweep that reached them put
// `minmax(0, 1fr)` on `.decision-rows`, which outranked
// `decision-card.css`'s `repeat(auto-fit, ...)` and collapsed the option
// cards into a stack. That is a different regime: the track lives in CSS, not
// in the class string, and a utility here would be the defect the fence exists
// to prevent. The glob therefore stops at the review island and the shell.
//
// The fence reads every grid container, not only the lists: the panels the
// same fix had to touch are `grid ... content-start` divs with no `list-none`
// in them, so a fence that asked for a list would have watched the narrower
// half of the defect it was written for. Server-rendered class strings in
// `.ts` are read alongside the React views, because the rule is about the
// layout a string asks for rather than about which renderer emits it.
//
// What the predicate is deliberate about.
//
// A variant may prefix the `grid` token: `wide:grid` and `[&>li]:grid` are
// still a container whose column a reader at a narrow width depends on. The
// track that answers for one is the track scoped the same way, so a prefixed
// `grid` is answered by a `grid-cols-` carrying that same prefix. A prefix
// that only changes when a rule applies - a breakpoint, a state - is also
// answered by an unprefixed track, which is inert wherever `display` is not
// grid and so costs nothing to carry. A prefix that retargets the rule at
// another element, which is any arbitrary variant naming `&`, is not: an
// unprefixed track there lands on the parent rather than on the child the
// variant selects, so it would read as compliant while leaving the child's
// track implicit. An unprefixed `grid` still requires an unprefixed
// `grid-cols-`; a track declared only at a breakpoint leaves the narrow
// regime this fence exists for undeclared.
//
// Tokens are split on any whitespace with `[\s\S]` rather than `.`, so a
// class list a formatter wrapped across lines is still read.
//
// `inline-grid` is deliberately outside the fence. An inline-grid box is
// shrink-to-fit, so it is not the shape this rule describes, and its remedy
// would not be either: `minmax(0, 1fr)` gives the container a zero min-content
// size, which would collapse such a box rather than contain it. The one live
// `inline-grid` in the sidebar declares its own columns and wants nothing from
// this rule. An accidental exclusion on a silent-failure guard reads exactly
// like a hole, so this one is stated rather than left to be rediscovered.

// A `grid` whose variant retargets another element, answered only by a track
// scoped the same way.
const RETARGETED_GRID =
  "^(?=[\\s\\S]*(?:^|\\s)(\\S*&\\S*:)grid(?=\\s|$))(?![\\s\\S]*(?:^|\\s)\\1grid-cols-)";

// A `grid` on the element itself, answered by that element's own track under
// the same prefix or by an unprefixed one.
const OWN_GRID =
  "^(?=[\\s\\S]*(?:^|\\s)((?:[^\\s&]*:)|)grid(?=\\s|$))(?![\\s\\S]*(?:^|\\s)\\2grid-cols-)(?![\\s\\S]*(?:^|\\s)grid-cols-)";

const GRID_TRACK_PATTERN = `/(?:${RETARGETED_GRID}|${OWN_GRID})/`;

// Where a class string can live. Reading every string literal instead would
// report a Tailwind column-track error on prose - an error message or a label
// that happens to contain the word - so the fence looks only at `className`
// values and at the places a class string is handed over: declared as a
// constant, returned from a helper, or listed in an array. The alternative,
// asking whether a string looks like a class list, cannot be written without
// either losing `className="grid"` or carrying a list of bare utilities that
// goes stale.
//
// Each handover point is read one level deep rather than as a whole subtree.
// A helper's block body holds its error messages and labels too, so reading
// every string beneath it would put the prose back in scope; reading the
// string it hands over does not.
const classStringsIn = (host) =>
  `${host} :matches(Literal[value=${GRID_TRACK_PATTERN}], TemplateElement[value.raw=${GRID_TRACK_PATTERN}])`;

const CLASS_STRING_EXPRESSIONS =
  "TemplateLiteral, BinaryExpression, ConditionalExpression, ObjectExpression, ArrayExpression, TSAsExpression";

const classStringsHandedOverBy = (host) => [
  `${host} > Literal[value=${GRID_TRACK_PATTERN}]`,
  classStringsIn(`${host} > :matches(${CLASS_STRING_EXPRESSIONS})`),
];

const GRID_TRACK_SELECTOR = {
  selector: [
    classStringsIn('JSXAttribute[name.name="className"]'),
    ...classStringsHandedOverBy("VariableDeclarator"),
    ...classStringsHandedOverBy("ReturnStatement"),
    ...classStringsHandedOverBy("ArrowFunctionExpression"),
  ].join(", "),
  message:
    "A grid container must declare its column track (grid-cols-[minmax(0,1fr)] on a one-column surface); an implicit track is floored at the widest item's min-content width and overflows its panel.",
};

export default tseslint.config(
  {
    ignores: [
      // Runtime artifacts written by local agent runs, never authored source.
      ".agent-runs/",
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
          "src/components/wireframe/wireframe-fit*.ts",
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
          "**/components/wireframe/wireframe-fit.js",
        ],
        mayImport: ["planVocabulary"],
      },
      escapeHtml: {
        files: ["src/render/escape-html.ts"],
        imports: ["**/escape-html.js"],
        mayImport: [],
      },
      // POSIX-shell argument quoting, shared by every surface that hands a
      // person a command to run. It sits at the bottom because it is a pure
      // string rule with no product concept in it, and because a second copy
      // is exactly what a command that silently fails to run comes from.
      shellQuoting: {
        files: ["src/shell-quoting/**/*.ts"],
        imports: ["**/shell-quoting/**"],
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
      // Never-authorable shared React building blocks are browser-safe seams
      // consumed by both component views and the review interaction island.
      sharedUi: {
        files: [
          "src/components/_shared/**/*.ts",
          "src/components/_shared/**/*.tsx",
        ],
        imports: ["**/components/_shared/**"],
        mayImport: ["model", "icons"],
      },
      // Component React views consume compiled models and shared visual
      // building blocks without owning static serialization.
      ui: {
        files: ["src/components/*/view*.ts", "src/components/*/view*.tsx"],
        imports: ["**/components/*/view*.js"],
        mayImport: ["model", "icons", "sharedUi"],
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
        mayImport: ["components", "icons", "model", "planVocabulary", "ui"],
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
          "src/render/service-page*.ts",
        ],
        imports: [
          "**/compile-plan-model.js",
          "**/plan-id.js",
          "**/render-document.js",
          "**/serialize-html.js",
        ],
        mayImport: ["markdown", "shell", "page"],
      },
      // The pages the service serves in its own right. They are the one
      // renderer surface built from the product's recipes without a plan
      // behind them, so they compose escaped prose, the icon catalog, and the
      // shared figure-control vocabulary directly. That grant stays on this
      // file rather than widening what every composer file may reach.
      servicePage: {
        files: ["src/render/service-page*.ts"],
        imports: ["**/service-page.js"],
        mayImport: [
          "escapeHtml",
          "icons",
          "markdown",
          "model",
          "shell",
          "page",
          "shellQuoting",
        ],
      },
      // Browser-safe review models. These modules must stay usable by both the
      // browser island and the local review runtime.
      reviewShared: {
        files: ["src/review/shared/**/*.ts", "src/review/shared/**/*.tsx"],
        imports: ["**/review/shared/**"],
        mayImport: ["shellQuoting"],
        blockedImports: ["node:*"],
        // Blocks the server-owned review modules one level up while leaving
        // the bottom-tier layers above `src/review/` reachable, which the
        // allow-list still gates.
        blockedImportRegex: ["^\\.\\./(?!\\.)"],
      },
      // The browser island may use only browser-owned presentation code,
      // browser-safe review models, shared visual building blocks,
      // framework-free component models, and framework-neutral icons.
      reviewBrowser: {
        files: ["src/review/browser/**/*.ts", "src/review/browser/**/*.tsx"],
        imports: ["**/review/browser/**"],
        mayImport: ["icons", "model", "reviewShared", "sharedUi"],
        blockedImports: ["node:*"],
        blockedImportRegex: ["^\\.\\./(?!\\.|shared/)"],
      },
      // The local review runtime: loopback transport, session identity, the
      // reviewer's on-disk state, and the feedback package. It renders through
      // the composer's public entry points and owns no command I/O. It reads
      // compiled component models because the runtime, not the browser, decides
      // which stored answers the plan still asks for.
      review: {
        files: ["src/review/**/*.ts", "src/review/**/*.tsx"],
        ignores: [
          "src/review/browser/**/*.ts",
          "src/review/browser/**/*.tsx",
          "src/review/shared/**/*.ts",
          "src/review/shared/**/*.tsx",
        ],
        imports: ["**/review/**"],
        mayImport: [
          "composer",
          "icons",
          "model",
          "planLint",
          "reviewShared",
          "servicePage",
          "shellQuoting",
        ],
      },
      cli: {
        files: ["src/cli/**/*.ts"],
        imports: ["**/cli/**"],
        // The composer files are the renderer's public entry points; granting
        // only them keeps the CLI out of the renderer's internals.
        mayImport: [
          "composer",
          "planLint",
          "review",
          "reviewShared",
          "shellQuoting",
        ],
      },
    };

    // Bottom to top; a layer's grants must point strictly downward.
    const TIERS = [
      ["planVocabulary", "escapeHtml", "icons", "preferences", "shellQuoting"],
      ["model", "planLint"],
      ["page", "sharedUi"],
      ["ui"],
      ["components"],
      ["markdown", "shell"],
      ["composer", "servicePage", "reviewShared"],
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
    // The review island and the shell are the two scopes both fences cover, so
    // both ride in a single `no-restricted-syntax` declaration. The identity
    // resolver is exempt because it is the one owner of the selectors the
    // identity fence forbids; it has no class strings, so the grid fence's
    // ride-along exemption is unreachable rather than a hole in a layout it
    // could author. Embedded shell scripts are exempt from the grid fence
    // only (identity stays on them below): they are JavaScript source in a
    // template, and the grid predicate would read the whole body as one
    // class-string handover and report `grid` in comments and identifiers.
    // Plan-component views stay outside this glob: see the grid-fence comment
    // above.
    files: [
      "src/review/browser/**/*.ts",
      "src/review/browser/**/*.tsx",
      "src/render/shell/**/*.ts",
    ],
    ignores: [
      "src/review/browser/live-target.browser.ts",
      "src/render/shell/*-script.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        PLAN_IDENTITY_SELECTOR,
        GRID_TRACK_SELECTOR,
      ],
    },
  },
  {
    // Embedded viewer scripts still take the identity fence. A plan-identity
    // lookup in a shell script is the case that fence exists to force a
    // deliberate answer for; they are out of the grid fence only.
    files: ["src/render/shell/*-script.ts"],
    rules: {
      "no-restricted-syntax": ["error", PLAN_IDENTITY_SELECTOR],
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
