export const qualifiedTableName = (
  schemaName: string | undefined,
  tableName: string,
): string => (schemaName === undefined ? tableName : `${schemaName}${tableName}`);
