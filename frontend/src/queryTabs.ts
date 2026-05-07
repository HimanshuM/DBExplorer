import { type EditorTab } from './types';

export const initialSQL = `SELECT *
FROM pg_catalog.pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
LIMIT 100;`;

export const terminalStatuses = new Set(['succeeded', 'failed', 'canceled']);

export function createEditorTab(index: number, profileID = '', database = ''): EditorTab {
  const sql = initialSQL;
  return {
    id: `query_${index}`,
    title: `Query ${index}`,
    path: '',
    profileID,
    database,
    sql,
    savedSQL: sql,
    job: null,
    activeJobID: '',
    result: { schema: null, rows: null },
    running: false,
    error: '',
  };
}
