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
import {
  GetObjectInfo,
  ListDatabases as ListExplorerDatabases,
  ListSchemaObjects as ListExplorerSchemaObjects,
  ListSchemas as ListExplorerSchemas,
} from '../wailsjs/go/api/ExplorerAPI';
import { domain } from '../wailsjs/go/models';
import {
  EventsOn,
  Quit,
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
} from '../wailsjs/runtime/runtime';
import { ConnectionForm, buildProfile, defaultProfileForm } from './connectionForm';
import {
  ExplorerTree,
  explorerNodeID,
  groupExplorerObjects,
  isDataExplorerObject,
  isInspectableExplorerObject,
  objectInfoTabID,
  updateExplorerNodeList,
} from './explorerTree';
import { formatError, jobStatusError, quoteIdentifier } from './format';
import { ObjectInfoWorkspace, objectKindLabel } from './objectInfo';
import { createEditorTab, terminalStatuses } from './queryTabs';
import { ResultTable, resultLabel } from './resultTable';
import { getSQLExecutionTarget } from './sqlSelection';
import { StatusBar, collectRunningJobStatusItems } from './statusBar';
import {
  type EditorTab,
  type ExplorerTreeNode,
  type JobResultSetEvent,
  type ObjectInfoTab,
  type ProfileFormState,
} from './types';

export default function App() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const objectTabsRef = useRef<ObjectInfoTab[]>([]);
  const tabCounterRef = useRef(1);
  const selectedProfileIDRef = useRef('');
  const [tabs, setTabs] = useState<EditorTab[]>(() => [createEditorTab(1)]);
  const [activeTabID, setActiveTabID] = useState('query_1');
  const [objectTabs, setObjectTabs] = useState<ObjectInfoTab[]>([]);
  const [activeWorkspaceTabID, setActiveWorkspaceTabID] = useState('query_1');
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
  const [explorerNodes, setExplorerNodes] = useState<ExplorerTreeNode[]>([]);
  const [selectedExplorerNodeID, setSelectedExplorerNodeID] = useState('');
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const handleRunRef = useRef<() => void>(() => {});

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileID) ?? null,
    [profiles, selectedProfileID],
  );

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabID) ?? tabs[0],
    [activeTabID, tabs],
  );

  const activeObjectTab = useMemo(
    () => objectTabs.find((tab) => tab.id === activeWorkspaceTabID) ?? null,
    [activeWorkspaceTabID, objectTabs],
  );

  const activeWorkspaceIsQuery = !activeObjectTab;

  const visibleResult = activeTab?.result ?? { schema: null, rows: null };
  const visibleError = activeTab?.error || activeTab?.job?.error?.message || globalError;
  const status = activeTab?.job?.status ?? 'idle';
  const runningJobItems = useMemo(
    () => collectRunningJobStatusItems(tabs, objectTabs),
    [tabs, objectTabs],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    objectTabsRef.current = objectTabs;
  }, [objectTabs]);

  useEffect(() => {
    selectedProfileIDRef.current = selectedProfileID;
  }, [selectedProfileID]);

  useEffect(() => {
    setExplorerNodes((current) =>
      profiles.map((profile) => {
        const existing = current.find((node) => node.id === explorerNodeID('profile', profile.id));
        return {
          id: explorerNodeID('profile', profile.id),
          label: profile.name || profile.id,
          detail: profile.database || profile.host,
          kind: 'connection',
          profileID: profile.id,
          expanded: existing?.expanded ?? false,
          loaded: existing?.loaded ?? false,
          loading: existing?.loading ?? false,
          error: existing?.error,
          children: existing?.children ?? [],
        };
      }),
    );
  }, [profiles]);

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

    function findObjectTabByJobID(jobID: string) {
      return objectTabsRef.current.find(
        (tab) => tab.dataActiveJobID === jobID || tab.dataJob?.jobId === jobID,
      );
    }

    function applyJobSummary(rawSummary: unknown) {
      const summary = domain.JobSummary.createFrom(rawSummary);
      const tab = findTabByJobID(summary.jobId);
      if (tab) {
        updateTab(tab.id, {
          job: summary,
          running: !terminalStatuses.has(summary.status),
          activeJobID: terminalStatuses.has(summary.status) ? '' : tab.activeJobID,
        });
        return;
      }

      const objectTab = findObjectTabByJobID(summary.jobId);
      if (objectTab) {
        updateObjectTab(objectTab.id, {
          dataJob: summary,
          dataRunning: !terminalStatuses.has(summary.status),
          dataActiveJobID: terminalStatuses.has(summary.status) ? '' : objectTab.dataActiveJobID,
        });
      }
    }

    function applyCompletedJob(rawSummary: unknown) {
      const summary = domain.JobSummary.createFrom(rawSummary);
      const tab = findTabByJobID(summary.jobId);
      if (tab) {
        updateTab(tab.id, {
          job: summary,
          running: false,
          activeJobID: '',
        });

        if (summary.status === 'succeeded') {
          void loadFirstResultPage(summary.profileId || selectedProfileIDRef.current, summary, tab.id);
        }
        return;
      }

      const objectTab = findObjectTabByJobID(summary.jobId);
      if (objectTab) {
        updateObjectTab(objectTab.id, {
          dataJob: summary,
          dataRunning: false,
          dataActiveJobID: '',
          dataError: summary.status === 'succeeded' ? '' : jobStatusError(summary),
        });

        if (summary.status === 'succeeded') {
          void loadFirstObjectDataPage(summary.profileId || objectTab.node.profileID, summary, objectTab.id);
        }
      }
    }

    function applyResultSet(rawEvent: unknown) {
      const event = rawEvent as JobResultSetEvent;
      const summary = domain.JobSummary.createFrom(event.summary);
      const tab = findTabByJobID(summary.jobId);
      if (tab) {
        updateTab(tab.id, (current) => ({
          ...current,
          job: summary,
          result: {
            ...current.result,
            schema: domain.ResultSchema.createFrom(event.schema),
          },
        }));
        return;
      }

      const objectTab = findObjectTabByJobID(summary.jobId);
      if (objectTab) {
        updateObjectTab(objectTab.id, (current) => ({
          ...current,
          dataJob: summary,
          data: {
            ...current.data,
            schema: domain.ResultSchema.createFrom(event.schema),
          },
        }));
      }
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

  function updateObjectTab(
    tabID: string,
    patch: Partial<ObjectInfoTab> | ((tab: ObjectInfoTab) => ObjectInfoTab),
  ) {
    setObjectTabs((current) =>
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
    setActiveWorkspaceTabID(nextTab.id);
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
    if (activeWorkspaceTabID === tabID) {
      setActiveWorkspaceTabID(remainingTabs[0]?.id ?? objectTabsRef.current[0]?.id ?? '');
    }
  }

  function closeObjectTab(tabID: string) {
    const remainingTabs = objectTabsRef.current.filter((candidate) => candidate.id !== tabID);
    setObjectTabs(remainingTabs);
    if (activeWorkspaceTabID === tabID) {
      setActiveWorkspaceTabID(activeTabID || remainingTabs[0]?.id || '');
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
    const cancelProfileID = tab?.job?.profileId || selectedProfileID;
    if (!cancelProfileID || !tab?.activeJobID) {
      return;
    }

    try {
      await CancelJob(cancelProfileID, tab.activeJobID);
    } catch (err) {
      updateTab(tab.id, { error: formatError(err) });
    }
  }

  async function handleExplorerNodeClick(node: ExplorerTreeNode) {
    setSelectedExplorerNodeID(node.id);

    if (node.kind === 'connection') {
      setSelectedProfileID(node.profileID);
    }

    if (isInspectableExplorerObject(node)) {
      setSelectedProfileID(node.profileID);
      openObjectInfoTab(node);
      return;
    }

    await toggleExplorerNode(node);
  }

  function openObjectInfoTab(node: ExplorerTreeNode) {
    const tabID = objectInfoTabID(node);
    const existing = objectTabsRef.current.find((tab) => tab.id === tabID);

    if (!existing) {
      const tab: ObjectInfoTab = {
        id: tabID,
        title: `${objectKindLabel(node.kind)}: ${node.objectName ?? node.label}`,
        node,
        section: 'overview',
        state: { loading: true, error: '', info: null },
        data: { schema: null, rows: null },
        dataJob: null,
        dataActiveJobID: '',
        dataRunning: false,
        dataError: '',
      };
      setObjectTabs((current) => [...current, tab]);
    } else {
      updateObjectTab(tabID, { node });
    }

    setActiveWorkspaceTabID(tabID);
    void loadObjectInfo(tabID, node);
  }

  async function loadObjectInfo(tabID: string, node: ExplorerTreeNode) {
    updateObjectTab(tabID, { state: { loading: true, error: '', info: null } });

    try {
      const info = await GetObjectInfo(
        node.profileID,
        node.database ?? '',
        node.schema ?? '',
        node.objectName ?? node.label,
        node.kind as never,
      );
      updateObjectTab(tabID, {
        state: { loading: false, error: '', info: domain.ObjectInfo.createFrom(info) },
      });
    } catch (err) {
      updateObjectTab(tabID, { state: { loading: false, error: formatError(err), info: null } });
    }
  }

  async function loadObjectData(tab: ObjectInfoTab) {
    if (!isDataExplorerObject(tab.node) || tab.dataRunning) {
      return;
    }

    updateObjectTab(tab.id, {
      section: 'data',
      data: { schema: null, rows: null },
      dataJob: null,
      dataActiveJobID: '',
      dataRunning: true,
      dataError: '',
    });

    try {
      const sql = `select *\nfrom ${quoteIdentifier(tab.node.schema ?? 'public')}.${quoteIdentifier(tab.node.objectName ?? tab.node.label)}\nlimit 100;`;
      const response = await RunQuery(domain.RunQueryRequest.createFrom({
        profileId: tab.node.profileID,
        database: tab.node.database ?? '',
        sql,
        statements: [{ startOffset: 0, endOffset: sql.length, text: sql }],
        mode: 'statement',
        readOnly: true,
      }));

      updateObjectTab(tab.id, {
        dataActiveJobID: response.jobId,
        dataJob: domain.JobSummary.createFrom({
          jobId: response.jobId,
          profileId: tab.node.profileID,
          database: tab.node.database,
          status: 'queued',
          startedAt: 0,
          endedAt: 0,
          resultSets: [],
        }),
      });
      void syncObjectDataJob(tab.id, tab.node.profileID, response.jobId);
    } catch (err) {
      updateObjectTab(tab.id, {
        dataRunning: false,
        dataError: formatError(err),
      });
    }
  }

  async function syncObjectDataJob(tabID: string, profileID: string, jobID: string) {
    try {
      const nextJob = await GetJob(profileID, jobID);

      if (terminalStatuses.has(nextJob.status)) {
        updateObjectTab(tabID, {
          dataJob: nextJob,
          dataRunning: false,
          dataActiveJobID: '',
          dataError: nextJob.status === 'succeeded' ? '' : jobStatusError(nextJob),
        });

        if (nextJob.status === 'succeeded') {
          await loadFirstObjectDataPage(nextJob.profileId || profileID, nextJob, tabID);
        }
        return;
      }

      updateObjectTab(tabID, {
        dataJob: nextJob,
        dataRunning: true,
        dataActiveJobID: jobID,
      });
    } catch (err) {
      updateObjectTab(tabID, {
        dataRunning: false,
        dataActiveJobID: '',
        dataError: formatError(err),
      });
    }
  }

  async function toggleExplorerNode(node: ExplorerTreeNode) {
    if (node.kind === 'group') {
      updateExplorerNode(node.id, (current) => ({ ...current, expanded: !current.expanded }));
      return;
    }

    if (node.loaded) {
      updateExplorerNode(node.id, (current) => ({ ...current, expanded: !current.expanded }));
      return;
    }

    updateExplorerNode(node.id, (current) => ({
      ...current,
      expanded: true,
      loading: true,
      error: '',
    }));

    try {
      const children = await loadExplorerChildren(node);
      updateExplorerNode(node.id, (current) => ({
        ...current,
        children,
        loaded: true,
        loading: false,
        error: '',
      }));
    } catch (err) {
      updateExplorerNode(node.id, (current) => ({
        ...current,
        loading: false,
        error: formatError(err),
      }));
    }
  }

  function updateExplorerNode(
    nodeID: string,
    updater: (node: ExplorerTreeNode) => ExplorerTreeNode,
  ) {
    setExplorerNodes((current) => updateExplorerNodeList(current, nodeID, updater));
  }

  async function loadExplorerChildren(node: ExplorerTreeNode): Promise<ExplorerTreeNode[]> {
    if (node.kind === 'connection') {
      const databases = await ListExplorerDatabases(node.profileID);
      return databases.map((database) => ({
        id: explorerNodeID('database', node.profileID, database.name),
        label: database.name,
        kind: 'database',
        profileID: node.profileID,
        database: database.name,
        expanded: false,
        loaded: false,
        loading: false,
        children: [],
      }));
    }

    if (node.kind === 'database') {
      const schemas = await ListExplorerSchemas(node.profileID, node.database ?? '');
      return schemas.map((schema) => ({
        id: explorerNodeID('schema', node.profileID, node.database ?? '', schema.name),
        label: schema.name,
        kind: 'schema',
        profileID: node.profileID,
        database: node.database,
        schema: schema.name,
        expanded: false,
        loaded: false,
        loading: false,
        children: [],
      }));
    }

    if (node.kind === 'schema') {
      const objects = await ListExplorerSchemaObjects(node.profileID, node.database ?? '', node.schema ?? '');
      return groupExplorerObjects(node, objects);
    }

    return [];
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

  async function loadFirstObjectDataPage(
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

      updateObjectTab(tabID, { data: { schema, rows } });
    } catch (err) {
      updateObjectTab(tabID, { dataError: formatError(err) });
    }
  }

  useEffect(() => {
    if (!tabs.some((tab) => tab.activeJobID) && !objectTabs.some((tab) => tab.dataActiveJobID)) {
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

      const runningObjectTabs = objectTabsRef.current.filter((tab) => tab.dataActiveJobID);
      await Promise.all(
        runningObjectTabs.map(async (tab) => {
          try {
            const nextJob = await GetJob(tab.dataJob?.profileId || tab.node.profileID, tab.dataActiveJobID);
            if (canceled) {
              return;
            }

            if (terminalStatuses.has(nextJob.status)) {
              updateObjectTab(tab.id, {
                dataJob: nextJob,
                dataRunning: false,
                dataActiveJobID: '',
                dataError: nextJob.status === 'succeeded' ? '' : jobStatusError(nextJob),
              });

              if (nextJob.status === 'succeeded') {
                await loadFirstObjectDataPage(nextJob.profileId, nextJob, tab.id);
              }
              return;
            }

            updateObjectTab(tab.id, { dataJob: nextJob, dataRunning: true });
          } catch (err) {
            if (!canceled) {
              updateObjectTab(tab.id, {
                dataRunning: false,
                dataActiveJobID: '',
                dataError: formatError(err),
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
  }, [tabs, objectTabs]);

  return (
    <main className="app-shell">
      <header className="app-titlebar">
        <div className="titlebar-left">
          <div className="app-title">DB Explorer</div>
        </div>
        <div className="titlebar-center titlebar-control">
          <ConnectionDropdown
            profiles={profiles}
            selectedProfileID={activeProfileID}
            disabled={connectionPickerDisabled}
            onChange={updateActiveConnection}
          />
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
              <ExplorerTree
                nodes={explorerNodes}
                selectedProfileID={selectedProfileID}
                selectedNodeID={selectedExplorerNodeID}
                onNodeClick={(node) => void handleExplorerNodeClick(node)}
              />
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
                  className={tab.id === activeWorkspaceTabID ? 'tab active' : 'tab'}
                  onClick={() => {
                    setActiveTabID(tab.id);
                    setActiveWorkspaceTabID(tab.id);
                  }}
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
              {objectTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  className={tab.id === activeWorkspaceTabID ? 'tab active object-tab' : 'tab object-tab'}
                  onClick={() => setActiveWorkspaceTabID(tab.id)}
                >
                  <span>{tab.title}</span>
                  {tab.dataRunning && <span className="tab-dot" />}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${tab.title}`}
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeObjectTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeObjectTab(tab.id);
                      }
                    }}
                  >
                    x
                  </span>
                </button>
              ))}
              <button type="button" className="new-tab" onClick={addEditorTab} aria-label="New query tab">
                +
              </button>
            </div>
            <div className="toolbar">
              <button
                type="button"
                onClick={handleRun}
                disabled={!activeWorkspaceIsQuery || activeTab?.running || profiles.length === 0}
              >
                Run
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={!activeWorkspaceIsQuery || !activeTab?.running || !activeTab.activeJobID}
              >
                Cancel
              </button>
            </div>
          </header>

          <section className="editor-region">
            {activeObjectTab ? (
              <ObjectInfoWorkspace
                tab={activeObjectTab}
                onSectionChange={(section) => {
                  updateObjectTab(activeObjectTab.id, { section });
                  if (section === 'data' && !activeObjectTab.data.schema && !activeObjectTab.dataRunning) {
                    void loadObjectData(activeObjectTab);
                  }
                }}
                onRefreshData={() => void loadObjectData(activeObjectTab)}
              />
            ) : (
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
            )}
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
      <StatusBar
        jobs={runningJobItems}
        open={statusPanelOpen}
        onToggle={() => setStatusPanelOpen((current) => !current)}
      />
    </main>
  );
}

