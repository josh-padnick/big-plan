// Owns the table identity shared by schema rendering and diff field matching.

export const qualifiedTableName = (
  schemaName: string | undefined,
  tableName: string,
): string =>
  schemaName === undefined ? tableName : `${schemaName}${tableName}`;
