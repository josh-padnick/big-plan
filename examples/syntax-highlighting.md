# Syntax Highlighting Preview

Use the theme control in the top-right corner to compare the light and dark palettes.

## SQL

```sql
SELECT users.id, users.email, COUNT(orders.id) AS order_count
FROM users
LEFT JOIN orders ON orders.user_id = users.id
WHERE users.active = true
GROUP BY users.id, users.email
ORDER BY order_count DESC;
```

## TypeScript

```typescript
type Plan = {
  readonly title: string;
  readonly approved: boolean;
};

export const summarize = (plan: Plan): string =>
  `${plan.title}: ${plan.approved ? "ready" : "needs review"}`;
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

for plan in examples/*.md; do
  node bin/grandplan.mjs render "$plan"
done
```

## JSON

```json
{
  "title": "Payments retry architecture",
  "status": "approved",
  "reviewers": ["platform", "payments"]
}
```

## Plain and unknown code

An undeclared fence remains plain:

```
No language was declared here.
```

An unknown language also degrades gracefully:

```grandplan-example
This remains readable even without a matching grammar.
```
