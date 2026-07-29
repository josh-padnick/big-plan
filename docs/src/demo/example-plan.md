# Rate limiting for the public API

Per-key rate limiting with a fixed monthly quota and a burst allowance, enforced at the gateway.

## Summary

Our public API has no rate limiting.
One misbehaving client can degrade the service for everyone, and we have no way to offer usage tiers.
Per-key limits at the gateway, with a fixed monthly quota and a burst allowance, close both gaps.

## Current state

- `api-gateway` (Node 22, Fastify) terminates all public traffic.
- API keys live in Postgres (`api_keys` table) and are validated by `key-auth` middleware.
- No request accounting exists anywhere in the stack.
- p99 latency budget at the gateway is 12 ms; any solution must stay inside it.

## Options considered

| Option                  | Latency | Accuracy             | Operational cost     | Verdict    |
| ----------------------- | ------- | -------------------- | -------------------- | ---------- |
| In-process token bucket | ~0 ms   | Poor across replicas | None                 | Rejected   |
| Redis sliding window    | ~1 ms   | Exact                | One new dependency   | **Chosen** |
| API management vendor   | ~5 ms   | Exact                | New vendor, new bill | Rejected   |

The in-process bucket fails because the gateway runs six replicas and clients would get six independent budgets.
The vendor option solves problems we do not have yet.

## Chosen design

Redis-backed sliding window, one key per API key per window.

```ts
// rate-limit.ts
export const checkLimit = async ({
  redis,
  apiKey,
  limit,
  windowSeconds,
}: CheckLimitArgs): Promise<LimitResult> => {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1_000;
  const key = `rl:${apiKey}`;

  const [, , count] = await redis
    .multi()
    .zremrangebyscore(key, 0, windowStart)
    .zadd(key, now, `${now}:${crypto.randomUUID()}`)
    .zcard(key)
    .expire(key, windowSeconds)
    .exec();

  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
};
```

Limits are read from the existing `api_keys` row so plans can differ per customer:

```sql
ALTER TABLE api_keys
  ADD COLUMN rate_limit_per_minute integer NOT NULL DEFAULT 600,
  ADD COLUMN rate_limit_burst integer NOT NULL DEFAULT 100;
```

## Code diff

The gateway change is small; the middleware slots in right after key auth:

<CodeDiff file="api-gateway/src/app.ts" showLineNumbers showLineCounts>

```diff
@@ -41,4 +41,9 @@
 // api-gateway/src/app.ts
 app.addHook("preHandler", keyAuth);
+app.addHook("preHandler", rateLimit({
+  redis,
+  limits: limitsFromApiKey,
+  onDegraded: metrics.rateLimitDegraded,
+}));
 app.register(publicRoutes);
-app.setErrorHandler(defaultErrorHandler);
+app.setErrorHandler(rateLimitAwareErrorHandler);
```

<Annotation lines="43-47" side="new">
  Keep this hook immediately after authentication so the rate-limit key always
  comes from a validated API key.
</Annotation>

</CodeDiff>

## HTTP endpoint

Rejected requests receive `429 Too Many Requests` with `Retry-After` and the standard `RateLimit-*` headers.
Clients can also inspect their budget directly:

| Method | Path             | Auth    | Returns                         |
| ------ | ---------------- | ------- | ------------------------------- |
| `GET`  | `/v1/rate-limit` | API key | Current window usage and limits |

```json
{
  "limit": 600,
  "remaining": 483,
  "resetSeconds": 21,
  "burst": 100
}
```

## Rollout plan

1. Ship the middleware dark: measure, log, never reject.
2. Watch one week of production traffic; tune default limits so fewer than 0.1% of legitimate requests would be rejected.
3. Enable enforcement for internal keys only; verify alerts and dashboards.
4. Enable enforcement globally behind the `rate-limiting` feature flag.
5. Remove the flag after two quiet weeks.

## Risks and mitigations

<Callout type="warning" title="Fail-open dependency">

If Redis is unreachable, allow the request and increment a `rate_limit_degraded` counter that pages on-call.

</Callout>

- **Clock skew between replicas.** The window uses Redis server time via `TIME`, not gateway clocks.
- **Hot keys for very large customers.** Shard the sorted set by minute bucket if any single key exceeds 50k requests per minute; not built now, documented as the known upgrade path.

## Testing

- Unit tests for `checkLimit` covering boundary counts, expiry, and the fail-open path.
- An integration test that runs 1,000 concurrent requests against two gateway replicas and asserts a single shared budget.
- A load test proving the middleware adds less than 1.5 ms at p99.

## Open questions

1. Should unauthenticated endpoints (`/health`, `/docs`) share a per-IP limit, or stay unlimited?
2. Do we owe existing enterprise customers notice before enforcement, and how much?
3. Is `429` plus `Retry-After` enough, or do we also want a usage dashboard in this iteration?
