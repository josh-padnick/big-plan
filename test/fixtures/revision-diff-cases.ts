// Catalogs the commissioned revision-lens matrix as authored MDX pairs. The
// browser spec owns gestures; this fixture owns only readable scenario data.

export type RevisionDiffCase = {
  readonly name: string;
  readonly before: string;
  readonly after: string;
  readonly expected: "changed" | "added" | "removed";
};

const plan = (body: string): string => `# Revision lens fixture

${body.trim()}
`;

export const revisionDiffCases: ReadonlyArray<RevisionDiffCase> = [
  {
    name: "paragraph rich text",
    before: plan("## Approach\n\nUse **careful** retries with `jitter`."),
    after: plan("## Approach\n\nUse **bounded** retries with `jitter`."),
    expected: "changed",
  },
  {
    name: "wholesale rewrite",
    before: plan(
      "## Approach\n\nThe first strategy retries every operation immediately and trusts the network.",
    ),
    after: plan(
      "## Approach\n\nQueue failed work, apply a bounded backoff, and surface exhausted attempts to an operator.",
    ),
    expected: "changed",
  },
  {
    name: "list",
    before: plan("## Steps\n\n- Read\n- Decide\n- Ship"),
    after: plan("## Steps\n\n- Read\n- Prototype\n- Verify\n- Ship"),
    expected: "changed",
  },
  {
    name: "wide table",
    before: plan(
      "## Matrix\n\n| Service | Owner | Timeout | Retries |\n| --- | --- | ---: | ---: |\n| Checkout | Core | 2s | 2 |",
    ),
    after: plan(
      "## Matrix\n\n| Service | Owner | Timeout | Retries |\n| --- | --- | ---: | ---: |\n| Checkout | Reliability | 5s | 4 |",
    ),
    expected: "changed",
  },
  {
    name: "code",
    before: plan("## Worker\n\n```ts\nretry(2);\n```"),
    after: plan(
      "## Worker\n\n```ts\nretry({ attempts: 4, jitter: true });\n```",
    ),
    expected: "changed",
  },
  {
    name: "added section",
    before: plan("## Existing\n\nKeep this section."),
    after: plan(
      "## Existing\n\nKeep this section.\n\n## Security\n\nRotate the credential after deployment.",
    ),
    expected: "added",
  },
  {
    name: "removed section",
    before: plan(
      "## Existing\n\nKeep this section.\n\n## Temporary\n\nDelete this migration note.",
    ),
    after: plan("## Existing\n\nKeep this section."),
    expected: "removed",
  },
  {
    name: "slide rename",
    before: plan("## Delivery\n\nShip behind a flag."),
    after: plan("## Rollout\n\nShip behind a flag."),
    expected: "changed",
  },
  {
    name: "split and merge",
    before: plan(
      "## Operations\n\nRetry failed work and alert the operator when attempts are exhausted.",
    ),
    after: plan(
      "## Retry policy\n\nRetry failed work with bounded backoff.\n\n## Escalation\n\nAlert the operator when attempts are exhausted.",
    ),
    expected: "changed",
  },
  {
    name: "multi-slide chat",
    before: plan(
      "## API\n\nUse a synchronous request.\n\n## Worker\n\nRun one worker.\n\n## Rollout\n\nDeploy immediately.",
    ),
    after: plan(
      "## API\n\nAccept work asynchronously.\n\n## Worker\n\nRun three workers.\n\n## Rollout\n\nDeploy behind a flag.",
    ),
    expected: "changed",
  },
];

export const associationCases = [
  "two comments on different blocks",
  "two comments on the same block",
  "a later revision of the same thread",
] as const;
