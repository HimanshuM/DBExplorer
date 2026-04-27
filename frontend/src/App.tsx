import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { KeyCode, KeyMod } from 'monaco-editor';
import {
  CancelJob,
  GetJob,
  GetResultSchema,
  GetRows,
  RunQuery,
} from '../wailsjs/go/api/QueryAPI';
import { ListProfiles, SaveProfile, TestConnection } from '../wailsjs/go/api/ConnectionAPI';
import { domain } from '../wailsjs/go/models';
import {
  EventsOn,
  Quit,
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
} from '../wailsjs/runtime/runtime';

const initialSQL = `select *
from pg_catalog.pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename
limit 100;`;

const terminalStatuses = new Set(['succeeded', 'failed', 'canceled']);

type ResultState = {
  schema: domain.ResultSchema | null;
  rows: domain.GetRowsResponse | null;
};

type SQLExecutionTarget = {
  sql: string;
  mode: 'selection' | 'statement';
  startOffset: number;
  endOffset: number;
  cursorEndOffset?: number;
};

type JobResultSetEvent = {
  summary: domain.JobSummary;
  schema: domain.ResultSchema;
};

type EditorTab = {
  id: string;
  title: string;
  sql: string;
  job: domain.JobSummary | null;
  activeJobID: string;
  result: ResultState;
  running: boolean;
  error: string;
};

type ProfileFormState = {
  id: string;
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslMode: string;
};

const defaultProfileForm: ProfileFormState = {
  id: 'local_pg',
  name: 'Local Postgres',
  host: 'localhost',
  port: '5432',
  user: 'postgres',
  password: '',
  database: 'postgres',
  sslMode: 'disable',
};

function createEditorTab(index: number): EditorTab {
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

export default function App() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const tabCounterRef = useRef(1);
  const selectedProfileIDRef = useRef('');
  const [tabs, setTabs] = useState<EditorTab[]>(() => [createEditorTab(1)]);
  const [activeTabID, setActiveTabID] = useState('query_1');
  const [profiles, setProfiles] = useState<domain.ConnProfile[]>([]);
  const [selectedProfileID, setSelectedProfileID] = useState('');
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [globalError, setGlobalError] = useState('');
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(defaultProfileForm);
  const [savingProfile, setSavingProfile] = useState(false);
  const [testingProfile, setTestingProfile] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const handleRunRef = useRef<() => void>(() => {});

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileID) ?? null,
    [profiles, selectedProfileID],
  );

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabID) ?? tabs[0],
    [activeTabID, tabs],
  );

  const visibleResult = activeTab?.result ?? { schema: null, rows: null };
  const visibleError = activeTab?.error || activeTab?.job?.error?.message || globalError;
  const status = activeTab?.job?.status ?? 'idle';

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    selectedProfileIDRef.current = selectedProfileID;
  }, [selectedProfileID]);

  useEffect(() => {
    let canceled = false;

    async function refreshWindowState() {
      try {
        const maximized = await WindowIsMaximised();
        if (!canceled) {
          setWindowMaximized(maximized);
        }
      } catch {
        // Window state is cosmetic; ignore runtime lookup failures.
      }
    }

    void refreshWindowState();
    window.addEventListener('resize', refreshWindowState);

    return () => {
      canceled = true;
      window.removeEventListener('resize', refreshWindowState);
    };
  }, []);

  useEffect(() => {
    function findTabByJobID(jobID: string) {
      return tabsRef.current.find((tab) => tab.activeJobID === jobID || tab.job?.jobId === jobID);
    }

    function applyJobSummary(rawSummary: unknown) {
      const summary = domain.JobSummary.createFrom(rawSummary);
      const tab = findTabByJobID(summary.jobId);
      if (!tab) {
        return;
      }

      updateTab(tab.id, {
        job: summary,
        running: !terminalStatuses.has(summary.status),
        activeJobID: terminalStatuses.has(summary.status) ? '' : tab.activeJobID,
      });
    }

    function applyCompletedJob(rawSummary: unknown) {
      const summary = domain.JobSummary.createFrom(rawSummary);
      const tab = findTabByJobID(summary.jobId);
      if (!tab) {
        return;
      }

      updateTab(tab.id, {
        job: summary,
        running: false,
        activeJobID: '',
      });

      if (summary.status === 'succeeded') {
        void loadFirstResultPage(summary.profileId || selectedProfileIDRef.current, summary, tab.id);
      }
    }

    function applyResultSet(rawEvent: unknown) {
      const event = rawEvent as JobResultSetEvent;
      const summary = domain.JobSummary.createFrom(event.summary);
      const tab = findTabByJobID(summary.jobId);
      if (!tab) {
        return;
      }

      updateTab(tab.id, (current) => ({
        ...current,
        job: summary,
        result: {
          ...current.result,
          schema: domain.ResultSchema.createFrom(event.schema),
        },
      }));
    }

    const unsubscribe = [
      EventsOn('job:queued', applyJobSummary),
      EventsOn('job:started', applyJobSummary),
      EventsOn('job:resultset', applyResultSet),
      EventsOn('job:completed', applyCompletedJob),
      EventsOn('job:failed', applyCompletedJob),
      EventsOn('job:canceled', applyCompletedJob),
    ];

    return () => {
      unsubscribe.forEach((off) => off());
    };
  }, []);

  async function refreshProfiles(selectID?: string) {
    const nextProfiles = await ListProfiles();
    setProfiles(nextProfiles);
    setSelectedProfileID((current) => selectID || current || nextProfiles[0]?.id || '');
    return nextProfiles;
  }

  useEffect(() => {
    let canceled = false;

    async function loadProfiles() {
      setLoadingProfiles(true);
      setGlobalError('');

      try {
        const nextProfiles = await refreshProfiles();
        if (canceled) {
          return;
        }

        if (nextProfiles.length === 0) {
          setShowProfileForm(true);
        }
      } catch (err) {
        if (!canceled) {
          setGlobalError(formatError(err));
        }
      } finally {
        if (!canceled) {
          setLoadingProfiles(false);
        }
      }
    }

    void loadProfiles();

    return () => {
      canceled = true;
    };
  }, []);

  const handleEditorMount: OnMount = (mountedEditor) => {
    editorRef.current = mountedEditor;
    mountedEditor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => {
      handleRunRef.current();
    });
  };

  function updateTab(tabID: string, patch: Partial<EditorTab> | ((tab: EditorTab) => EditorTab)) {
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== tabID) {
          return tab;
        }
        return typeof patch === 'function' ? patch(tab) : { ...tab, ...patch };
      }),
    );
  }

  function updateActiveTabSQL(value: string) {
    if (activeTab) {
      updateTab(activeTab.id, { sql: value });
    }
  }

  function addEditorTab() {
    const nextIndex = tabCounterRef.current + 1;
    tabCounterRef.current = nextIndex;
    const nextTab = createEditorTab(nextIndex);
    setTabs((current) => [...current, nextTab]);
    setActiveTabID(nextTab.id);
  }

  function closeEditorTab(tabID: string) {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabID);
    if (!tab || tab.running || tabsRef.current.length <= 1) {
      return;
    }

    const remainingTabs = tabsRef.current.filter((candidate) => candidate.id !== tabID);
    setTabs(remainingTabs);
    if (activeTabID === tabID) {
      setActiveTabID(remainingTabs[0]?.id ?? '');
    }
  }

  async function handleToggleMaximize() {
    WindowToggleMaximise();
    window.setTimeout(() => {
      void WindowIsMaximised().then(setWindowMaximized).catch(() => undefined);
    }, 80);
  }

  function updateProfileField<K extends keyof ProfileFormState>(
    field: K,
    value: ProfileFormState[K],
  ) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSaveProfile({ testAfterSave }: { testAfterSave: boolean }) {
    setSavingProfile(true);
    setConnectionMessage('');
    setGlobalError('');

    try {
      const profile = buildProfile(profileForm);
      await SaveProfile(profile);
      await refreshProfiles(profile.id);
      setShowProfileForm(false);

      if (testAfterSave) {
        setTestingProfile(true);
        const testResult = await TestConnection(profile.id);
        setConnectionMessage(testResult.message || (testResult.ok ? 'Connection test passed' : 'Connection test failed'));
        if (!testResult.ok) {
          setShowProfileForm(true);
        }
      }
    } catch (err) {
      setGlobalError(formatError(err));
    } finally {
      setSavingProfile(false);
      setTestingProfile(false);
    }
  }

  async function handleRun() {
    const profile = selectedProfile;
    const tab = activeTab;
    const target = getSQLExecutionTarget(editorRef.current, tab?.sql ?? '');

    if (!profile) {
      if (tab) {
        updateTab(tab.id, { error: 'Select a connection profile before running a query.' });
      }
      return;
    }

    if (!target.sql.trim()) {
      if (tab) {
        updateTab(tab.id, { error: 'Enter a SQL statement before running.' });
      }
      return;
    }

    if (!tab) {
      return;
    }

    updateTab(tab.id, {
      error: '',
      result: { schema: null, rows: null },
      job: null,
      running: true,
    });

    try {
      const response = await RunQuery(domain.RunQueryRequest.createFrom({
        profileId: profile.id,
        database: profile.database,
        sql: target.sql,
        statements: [
          {
            startOffset: target.startOffset,
            endOffset: target.endOffset,
            text: target.sql,
          },
        ],
        mode: target.mode,
        readOnly: true,
      }));

      updateTab(tab.id, {
        activeJobID: response.jobId,
        job: domain.JobSummary.createFrom({
          jobId: response.jobId,
          profileId: profile.id,
          database: profile.database,
          status: 'queued',
          startedAt: 0,
          endedAt: 0,
          resultSets: [],
        }),
      });
    } catch (err) {
      updateTab(tab.id, {
        running: false,
        error: formatError(err),
      });
    }
  }

  handleRunRef.current = () => {
    if (!activeTab?.running) {
      void handleRun();
    }
  };

  async function handleCancel() {
    const tab = activeTab;
    if (!selectedProfileID || !tab?.activeJobID) {
      return;
    }

    try {
      await CancelJob(selectedProfileID, tab.activeJobID);
    } catch (err) {
      updateTab(tab.id, { error: formatError(err) });
    }
  }

  async function loadFirstResultPage(
    profileID: string,
    completedJob: domain.JobSummary,
    tabID: string,
  ) {
    const resultSetID = completedJob.resultSets[0]?.resultSetId || 'rs_1';

    try {
      const [schema, rows] = await Promise.all([
        GetResultSchema(profileID, domain.GetResultSchemaRequest.createFrom({
          jobId: completedJob.jobId,
          resultSetId: resultSetID,
        })),
        GetRows(profileID, domain.GetRowsRequest.createFrom({
          jobId: completedJob.jobId,
          resultSetId: resultSetID,
          start: 0,
          count: 100,
        })),
      ]);

      updateTab(tabID, { result: { schema, rows } });
    } catch (err) {
      updateTab(tabID, { error: formatError(err) });
    }
  }

  useEffect(() => {
    if (!tabs.some((tab) => tab.activeJobID)) {
      return;
    }

    let canceled = false;

    async function pollRunningJobs() {
      const runningTabs = tabsRef.current.filter((tab) => tab.activeJobID);
      await Promise.all(
        runningTabs.map(async (tab) => {
          try {
            const nextJob = await GetJob(tab.job?.profileId || selectedProfileIDRef.current, tab.activeJobID);
            if (canceled) {
              return;
            }

            if (terminalStatuses.has(nextJob.status)) {
              updateTab(tab.id, {
                job: nextJob,
                running: false,
                activeJobID: '',
              });

              if (nextJob.status === 'succeeded') {
                await loadFirstResultPage(nextJob.profileId, nextJob, tab.id);
              }
              return;
            }

            updateTab(tab.id, { job: nextJob, running: true });
          } catch (err) {
            if (!canceled) {
              updateTab(tab.id, {
                running: false,
                activeJobID: '',
                error: formatError(err),
              });
            }
          }
        }),
      );
    }

    const interval = window.setInterval(() => {
      void pollRunningJobs();
    }, 1000);

    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [tabs]);

  return (
    <main className="app-shell">
      <header className="app-titlebar">
        <div className="titlebar-left">
          <div className="app-title">DB Explorer</div>
        </div>
        <div className="titlebar-center titlebar-control">
          <label className="profile-picker">
            <span>Connection</span>
            <select
              value={selectedProfileID}
              onChange={(event) => setSelectedProfileID(event.target.value)}
              disabled={activeTab?.running || profiles.length === 0}
            >
              {profiles.length === 0 ? (
                <option value="">No profiles</option>
              ) : (
                profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name || profile.id}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
        <div className="titlebar-right titlebar-control">
          <div className="layout-controls" aria-label="Layout controls">
            <button type="button" aria-label="Toggle left pane" title="Toggle left pane">
              ◧
            </button>
            <button type="button" aria-label="Toggle right pane" title="Toggle right pane">
              ◨
            </button>
            <button type="button" aria-label="Toggle bottom pane" title="Toggle bottom pane">
              ▤
            </button>
          </div>
          <div className="window-controls">
            <button type="button" aria-label="Minimize window" onClick={WindowMinimise}>
              -
            </button>
            <button
              type="button"
              aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
              onClick={() => void handleToggleMaximize()}
            >
              {windowMaximized ? '❐' : '□'}
            </button>
            <button type="button" aria-label="Close window" className="window-close" onClick={Quit}>
              x
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <aside className="explorer-pane">
          <header className="pane-header">
            <span>Connections</span>
            <button
              type="button"
              aria-label="Add connection"
              onClick={() => setShowProfileForm((current) => !current)}
            >
              +
            </button>
        </header>
          <div className="explorer-content">
            {showProfileForm && (
              <ConnectionForm
                form={profileForm}
                saving={savingProfile}
                testing={testingProfile}
                onChange={updateProfileField}
                onSave={() => void handleSaveProfile({ testAfterSave: false })}
                onTest={() => void handleSaveProfile({ testAfterSave: true })}
              />
            )}

            {connectionMessage && <div className="message compact">{connectionMessage}</div>}

            {loadingProfiles ? (
              <div className="empty-tree">Loading profiles</div>
            ) : profiles.length === 0 ? (
              <div className="empty-tree">No saved connections</div>
            ) : (
              <div className="connection-list">
                {profiles.map((profile) => (
                  <button
                    type="button"
                    key={profile.id}
                    className={profile.id === selectedProfileID ? 'connection active' : 'connection'}
                    onClick={() => setSelectedProfileID(profile.id)}
                  >
                    <span>{profile.name || profile.id}</span>
                    <small>{profile.database || profile.host}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="workspace">
          <header className="top-bar">
            <div className="tab-strip">
              {tabs.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  className={tab.id === activeTab?.id ? 'tab active' : 'tab'}
                  onClick={() => setActiveTabID(tab.id)}
                >
                  <span>{tab.title}</span>
                  {tab.running && <span className="tab-dot" />}
                  {tabs.length > 1 && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Close ${tab.title}`}
                      className="tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeEditorTab(tab.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          closeEditorTab(tab.id);
                        }
                      }}
                  >
                    x
                  </span>
                  )}
                </button>
              ))}
              <button type="button" className="new-tab" onClick={addEditorTab} aria-label="New query tab">
                +
              </button>
            </div>
            <div className="toolbar">
              <button type="button" onClick={handleRun} disabled={activeTab?.running || profiles.length === 0}>
                Run
              </button>
              <button type="button" onClick={handleCancel} disabled={!activeTab?.running || !activeTab.activeJobID}>
                Cancel
              </button>
            </div>
          </header>

          <section className="editor-region">
            <Editor
              key={activeTab?.id}
              defaultLanguage="sql"
              value={activeTab?.sql ?? ''}
              onChange={(value) => updateActiveTabSQL(value ?? '')}
              onMount={handleEditorMount}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          </section>

          <section className="results-region">
            <header className="pane-header">
              <span>{visibleResult.rows ? resultLabel(visibleResult.rows) : 'Results'}</span>
              <span className={`status-pill ${status}`}>{status}</span>
            </header>
            {visibleError ? (
              <div className="message error">{visibleError}</div>
            ) : visibleResult.schema && visibleResult.rows ? (
              <ResultTable schema={visibleResult.schema} rows={visibleResult.rows} />
            ) : (
              <div className="result-placeholder">
                {activeTab?.running ? 'Waiting for query results' : 'Result grid mount point'}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function getSQLExecutionTarget(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  fallbackSQL: string,
): SQLExecutionTarget {
  const model = mountedEditor?.getModel();
  if (!mountedEditor || !model) {
    return {
      sql: fallbackSQL.trim(),
      mode: 'statement',
      startOffset: 0,
      endOffset: fallbackSQL.length,
    };
  }

  const selection = mountedEditor.getSelection();
  if (selection && !selection.isEmpty()) {
    const rawSelection = model.getValueInRange(selection);
    const leadingWhitespace = rawSelection.length - rawSelection.trimStart().length;
    const trailingWhitespace = rawSelection.length - rawSelection.trimEnd().length;
    const startOffset = model.getOffsetAt(selection.getStartPosition()) + leadingWhitespace;
    const endOffset = model.getOffsetAt(selection.getEndPosition()) - trailingWhitespace;

    return {
      sql: rawSelection.trim(),
      mode: 'selection',
      startOffset,
      endOffset,
    };
  }

  const position = mountedEditor.getPosition() ?? model.getPositionAt(0);
  return findStatementAtOffset(model.getValue(), model.getOffsetAt(position));
}

function findStatementAtOffset(source: string, cursorOffset: number): SQLExecutionTarget {
  const statements = splitSQLStatements(source);
  const containingStatement = statements.find(
    (statement) =>
      cursorOffset >= statement.startOffset &&
      cursorOffset <= (statement.cursorEndOffset ?? statement.endOffset),
  );
  const nextStatement = statements.find((statement) => statement.startOffset >= cursorOffset);
  const previousStatement = [...statements]
    .reverse()
    .find((statement) => statement.endOffset <= cursorOffset);
  const statement = containingStatement ?? nextStatement ?? previousStatement;

  if (!statement) {
    return {
      sql: '',
      mode: 'statement',
      startOffset: cursorOffset,
      endOffset: cursorOffset,
    };
  }

  return statement;
}

function splitSQLStatements(source: string): SQLExecutionTarget[] {
  const statements: SQLExecutionTarget[] = [];
  let statementStart = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "'") {
      index = skipSingleQuotedString(source, index + 1);
      continue;
    }
    if (char === '"') {
      index = skipDoubleQuotedIdentifier(source, index + 1);
      continue;
    }
    if (char === '-' && next === '-') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (char === '$') {
      const dollarQuoteEnd = skipDollarQuotedString(source, index);
      if (dollarQuoteEnd !== index) {
        index = dollarQuoteEnd;
        continue;
      }
    }
    if (char === ';') {
      const statementAdded = pushStatement(statements, source, statementStart, index, index + 1);
      if (!statementAdded) {
        extendPreviousStatementCursorBoundary(statements, index + 1);
      }
      statementStart = index + 1;
    }

    index += 1;
  }

  pushStatement(statements, source, statementStart, source.length, source.length);
  return statements;
}

function pushStatement(
  statements: SQLExecutionTarget[],
  source: string,
  rawStartOffset: number,
  rawEndOffset: number,
  cursorEndOffset: number,
): boolean {
  const raw = source.slice(rawStartOffset, rawEndOffset);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  const startOffset = rawStartOffset + leadingWhitespace;
  const endOffset = rawEndOffset - trailingWhitespace;
  const sql = source.slice(startOffset, endOffset);

  if (sql.trim()) {
    statements.push({ sql, mode: 'statement', startOffset, endOffset, cursorEndOffset });
    return true;
  }
  return false;
}

function extendPreviousStatementCursorBoundary(
  statements: SQLExecutionTarget[],
  cursorEndOffset: number,
) {
  const previousStatement = statements[statements.length - 1];
  if (previousStatement) {
    previousStatement.cursorEndOffset = Math.max(
      previousStatement.cursorEndOffset ?? previousStatement.endOffset,
      cursorEndOffset,
    );
  }
}

function skipSingleQuotedString(source: string, index: number) {
  while (index < source.length) {
    if (source[index] === "'" && source[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (source[index] === "'") {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipDoubleQuotedIdentifier(source: string, index: number) {
  while (index < source.length) {
    if (source[index] === '"' && source[index + 1] === '"') {
      index += 2;
      continue;
    }
    if (source[index] === '"') {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipLineComment(source: string, index: number) {
  while (index < source.length && source[index] !== '\n') {
    index += 1;
  }
  return index;
}

function skipBlockComment(source: string, index: number) {
  while (index < source.length) {
    if (source[index] === '*' && source[index + 1] === '/') {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

function skipDollarQuotedString(source: string, index: number) {
  const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  if (!match) {
    return index;
  }

  const tag = match[0];
  const closingIndex = source.indexOf(tag, index + tag.length);
  if (closingIndex === -1) {
    return source.length;
  }
  return closingIndex + tag.length;
}

function ConnectionForm({
  form,
  saving,
  testing,
  onChange,
  onSave,
  onTest,
}: {
  form: ProfileFormState;
  saving: boolean;
  testing: boolean;
  onChange: <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const busy = saving || testing;

  return (
    <form className="connection-form" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span>Name</span>
        <input
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>ID</span>
        <input
          value={form.id}
          onChange={(event) => onChange('id', event.target.value)}
          disabled={busy}
        />
      </label>
      <div className="form-row">
        <label>
          <span>Host</span>
          <input
            value={form.host}
            onChange={(event) => onChange('host', event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          <span>Port</span>
          <input
            inputMode="numeric"
            value={form.port}
            onChange={(event) => onChange('port', event.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <label>
        <span>User</span>
        <input
          value={form.user}
          onChange={(event) => onChange('user', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          value={form.password}
          onChange={(event) => onChange('password', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>Database</span>
        <input
          value={form.database}
          onChange={(event) => onChange('database', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>SSL Mode</span>
        <select
          value={form.sslMode}
          onChange={(event) => onChange('sslMode', event.target.value)}
          disabled={busy}
        >
          <option value="disable">disable</option>
          <option value="prefer">prefer</option>
          <option value="require">require</option>
          <option value="verify-ca">verify-ca</option>
          <option value="verify-full">verify-full</option>
        </select>
      </label>
      <div className="form-actions">
        <button type="button" onClick={onTest} disabled={busy}>
          {testing ? 'Testing' : 'Test'}
        </button>
        <button type="button" onClick={onSave} disabled={busy}>
          {saving && !testing ? 'Saving' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function ResultTable({
  schema,
  rows,
}: {
  schema: domain.ResultSchema;
  rows: domain.GetRowsResponse;
}) {
  if (schema.columns.length === 0) {
    return <div className="result-placeholder">Query completed without tabular results</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {schema.columns.map((column) => (
              <th key={column.name}>{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row, rowIndex) => (
            <tr key={rows.start + rowIndex}>
              <td>{rows.start + rowIndex + 1}</td>
              {schema.columns.map((column, columnIndex) => (
                <td key={column.name}>{formatCell(row[columnIndex])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resultLabel(rows: domain.GetRowsResponse) {
  if (rows.rowCountKnown) {
    return `Results: ${rows.rowCount} rows`;
  }
  return `Results: ${rows.rows.length} loaded`;
}

function buildProfile(form: ProfileFormState) {
  const id = form.id.trim();
  const port = Number.parseInt(form.port, 10);

  if (!id) {
    throw new Error('Connection ID is required.');
  }
  if (!form.name.trim()) {
    throw new Error('Connection name is required.');
  }
  if (!form.host.trim()) {
    throw new Error('Host is required.');
  }
  if (!form.user.trim()) {
    throw new Error('User is required.');
  }
  if (!form.database.trim()) {
    throw new Error('Database is required.');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Port must be a valid TCP port.');
  }

  return domain.ConnProfile.createFrom({
    id,
    name: form.name.trim(),
    kind: 'postgres',
    host: form.host.trim(),
    port,
    user: form.user.trim(),
    database: form.database.trim(),
    sslMode: form.sslMode,
    options: form.password ? { password: form.password } : {},
  });
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatError(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'Unexpected error';
}
