// The single source of the small MDX fixtures the docs render for each
// component, shared by the screenshot capture script and the live-embed
// generation script so the static and interactive presentations of a
// component can never drift apart.

export const CALLOUTS_FIXTURE = `<Callout type="note" title="Review decision">

Approving this plan green-lights the cache rewrite; the rollout plan ships separately.

</Callout>

<Callout type="tip">

Render this plan locally with \`npx big-plan render plan.mdx\` to review it in your own browser.

</Callout>

<Callout type="warning" title="Deploy ordering">

Enable the worker before raising the stale-read window, or reads serve stale data with no refresh running.

</Callout>

<Callout type="danger">

Skipping the backfill drops rows written during the migration window; there is no recovery path.

</Callout>
`;

export const DIFF_FIXTURE = `<CodeDiff file="src/catalog/read-through-cache.ts" showLineNumbers showLineCounts>

\`\`\`diff
@@ -18,4 +18,7 @@ export const readCatalog = async (key: string) => {
   const cached = await cache.get(key);
-  if (cached !== null && cached.ageSeconds <= 60) {
+  if (cached !== null && cached.ageSeconds <= 150) {
+    if (cached.ageSeconds > 60) {
+      await refreshQueue.enqueueOnce(key);
+    }
     return cached.value;
   }
\`\`\`

</CodeDiff>
`;

export const ANNOTATION_FIXTURE = `<CodeDiff file="src/catalog/read-through-cache.ts" showLineNumbers>

\`\`\`diff
@@ -18,4 +18,7 @@ export const readCatalog = async (key: string) => {
   const cached = await cache.get(key);
-  if (cached !== null && cached.ageSeconds <= 60) {
+  if (cached !== null && cached.ageSeconds <= 150) {
+    if (cached.ageSeconds > 60) {
+      await refreshQueue.enqueueOnce(key);
+    }
     return cached.value;
   }
\`\`\`

<Annotation lines="19-22" side="new">
This range turns the cache-age check into a stale-while-revalidate policy: entries under 60 seconds serve directly, entries between 60 and 150 serve stale while a background refresh runs, and older entries fall through to the origin.
</Annotation>

</CodeDiff>
`;

export const SNIPPET_FIXTURE = `<CodeSnippet file="src/catalog/refresh-worker.ts" startLine="42" showLineNumbers>

\`\`\`ts
export const refreshCatalog = async (key: string): Promise<void> => {
  const current = await catalogOrigin.read(key);
  await cache.put(key, current, { ttlSeconds: 300 });
  metrics.increment("catalog_cache.refresh_success");
};
\`\`\`

<Annotation lines="43">

Resolve through \`catalogOrigin\` so refreshes use the same retries and tracing as synchronous fallbacks.

</Annotation>

<Annotation lines="44-45">

The cache write must complete before success is recorded; otherwise dashboards can report a refresh that readers cannot observe.

</Annotation>

</CodeSnippet>
`;

export const FILE_TREE_FIXTURE = `<FileTree title="Worker pool layout">

\`\`\`tree
worker-pool/
  refresh-worker.ts - Consumes deduplicated catalog refresh jobs.
  worker-config.ts - Owns concurrency and timeout settings.
\`\`\`

</FileTree>
`;

export const TREE_DIFF_FIXTURE = `<FileTreeDiff title="Planned changes">

\`\`\`tree
src/
  catalog/
    catalog-origin.ts
    refresh-worker.ts [modified] - Move refresh work behind the queue.
    refresh-queue.ts [added] - Deduplicate refresh jobs by cache key.
  metrics/ [removed] - The legacy metrics module retires with its counter.
    legacy-cache-counter.ts [removed]
  queue/ [added] - New home for queue worker configuration.
    queue-config.ts [added]
ops/ -> deploy/ [renamed] - Match the platform team's naming.
  runbook.md
README.md [modified]
\`\`\`

</FileTreeDiff>
`;
