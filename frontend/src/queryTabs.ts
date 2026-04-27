import { type EditorTab } from './types';

export const initialSQL = `select *
from pg_catalog.pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename
limit 100;`;

export const terminalStatuses = new Set(['succeeded', 'failed', 'canceled']);

export function createEditorTab(index: number): EditorTab {
  return {
    id: `query_${index}`,
    title: `Query ${index}`,
    sql: initialSQL,
    job: null,
    activeJobID: '',
    result: { schema: null, rows: null },
    running: false,
    error: '',
  };
}
