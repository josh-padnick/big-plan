# Using DatabaseTableSchema well

One table's schema as structured columns, keys, indexes, and titled verbatim DDL.

- Reach for it whenever a plan proposes or changes a table; reviewers catch schema mistakes in structure, not in prose.
- One component per table; a plan touching three tables shows three schemas.
- Put constraints and indexes in the structured schema, and reserve the DDL band for what the subset cannot express, such as row security or triggers.
