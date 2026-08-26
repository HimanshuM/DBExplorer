import { domain } from '../../wailsjs/go/models';
import { type EditorTab } from '../types';

export const SCRIPT_AUTOSAVE_DELAY_MS = 500;

export function editorTabFromScript(script: domain.ScriptTabState, fallbackIndex: number): EditorTab {
  const sql = script.sql || '';
  return {
    id: script.id || `query_${fallbackIndex}`,
    title: script.title || `Query ${fallbackIndex}`,
    path: script.path || '',
    profileID: script.profileId || '',
    database: script.database || '',
    sql,
    savedSQL: script.savedSql ?? sql,
    job: null,
    activeJobID: '',
    result: { schema: null, rows: null },
    resultTabs: [],
    activeResultTabID: '',
    running: false,
    error: '',
  };
}

export function scriptStateFromTab(tab: EditorTab): domain.ScriptTabState {
  return domain.ScriptTabState.createFrom({
    id: tab.id,
    title: tab.title,
    path: tab.path,
    sql: tab.sql,
    savedSql: tab.savedSQL,
    profileId: tab.profileID,
    database: tab.database,
  });
}

export function scriptDefaultFilename(tab: EditorTab) {
  const base = tab.path.split(/[\\/]/).pop() || tab.title || 'query';
  return /\.[^./\\]+$/.test(base) ? base : `${base}.sql`;
}

export function queryTabIndex(tabID: string) {
  const match = /^query_(\d+)$/.exec(tabID);
  return match ? Number(match[1]) : 0;
}
