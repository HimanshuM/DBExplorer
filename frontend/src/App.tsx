import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import {
  ChevronsDownUp,
  Copy,
  FileCode2,
  Pencil,
  Minus,
  Play,
  Plus,
  Save,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { editor, languages } from 'monaco-editor';
import { KeyCode, KeyMod } from 'monaco-editor';
import {
  CancelJob,
  GetJob,
  GetResultSchema,
  GetRows,
  RunQuery,
} from '../wailsjs/go/api/QueryAPI';
import {
  DeleteProfile,
  ListProfiles,
  SaveProfile,
  TestConnectionProfile,
} from '../wailsjs/go/api/ConnectionAPI';
import {
  GetObjectInfo,
  GetTableInfo,
  ListDatabases as ListExplorerDatabases,
  ListSchemaObjects as ListExplorerSchemaObjects,
  ListSchemas as ListExplorerSchemas,
} from '../wailsjs/go/api/ExplorerAPI';
import {
  LoadWorkspace,
  SaveScript,
  SaveWorkspace,
} from '../wailsjs/go/api/ScriptAPI';
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
  collapseExplorerNodes,
  ExplorerTree,
  explorerNodeID,
  groupExplorerObjects,
  isDataExplorerObject,
  isInspectableExplorerObject,
  objectInfoTabID,
  updateExplorerNodeList,
} from './explorerTree';
import { formatError, jobStatusError, quoteIdentifier } from './format';
import { ObjectInfoWorkspace, objectKindLabel, type ObjectLinkTarget } from './objectInfo';
import { createEditorTab, terminalStatuses } from './queryTabs';
import { ResultTable, resultLabel } from './resultTable';
import { getSQLExecutionTarget } from './sqlSelection';
import { StatusBar, collectJobStatusItems } from './statusBar';
import { ConnectionDropdown, DatabaseDropdown } from './connectionDropdown';
import { LayoutPaneIcon, iconForObjectTabKind } from './objectIcons';
import {
  type EditorTab,
  type ExplorerTreeNode,
  type ExplorerTreeNodeKind,
  type JobResultSetEvent,
  type ObjectInfoTab,
  type ProfileFormState,
} from './types';
import { appIconURL } from './app/appAssets';
import { type DatabaseOptionsState, type ToastState, uniqueStrings } from './app/appState';
import {
  collectExplorerDatabaseSources,
  filterObjectQuickOpenItems,
  quickOpenObjectID,
  type ObjectQuickOpenItem,
  type ObjectQuickOpenSource,
} from './app/objectQuickOpen';
import { preferredDatabase, profileToForm } from './app/profileHelpers';
import {
  editorTabFromScript,
  queryTabIndex,
  SCRIPT_AUTOSAVE_DELAY_MS,
  scriptDefaultFilename,
  scriptStateFromTab,
} from './app/scriptWorkspace';
import {
  buildSQLIdentifierDecorations,
  getSQLCompletionContext,
  getSQLReferencedRelations,
  isSQLKeywordDelimiter,
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
  type SQLCompletionColumn,
  type SQLCompletionData,
  type SQLCompletionObject,
  type SQLReferencedRelation,
  uppercaseSQLKeywordBeforePosition,
} from './app/sqlLanguage';

const RESULT_PREVIEW_ROW_LIMIT = 100;

export default function App() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const sqlCompletionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const sqlColumnCompletionCacheRef = useRef<Map<string, SQLCompletionColumn[]>>(new Map());
  const sqlCompletionDataRef = useRef<SQLCompletionData>({
    profileID: '',
    database: '',
    objects: [],
    schemas: [],
  });
  const tabsRef = useRef<EditorTab[]>([]);
  const objectTabsRef = useRef<ObjectInfoTab[]>([]);
  const tabCounterRef = useRef(1);
  const toastCounterRef = useRef(0);
  const workspaceLoadedRef = useRef(false);
  const workspaceSaveTimeoutRef = useRef<number | null>(null);
  const scriptAutosaveTimeoutRef = useRef<number | null>(null);
  const selectedProfileIDRef = useRef('');
  const quickOpenInputRef = useRef<HTMLInputElement | null>(null);
  const quickOpenListRef = useRef<HTMLDivElement | null>(null);
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
  const [deletingProfileID, setDeletingProfileID] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [toast, setToast] = useState<ToastState>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [explorerPaneOpen, setExplorerPaneOpen] = useState(true);
  const [resultsPaneOpen, setResultsPaneOpen] = useState(true);
  const [explorerNodes, setExplorerNodes] = useState<ExplorerTreeNode[]>([]);
  const [selectedExplorerNodeID, setSelectedExplorerNodeID] = useState('');
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [databaseOptionsByProfileID, setDatabaseOptionsByProfileID] = useState<Record<string, DatabaseOptionsState>>({});
  const [objectQuickOpenOpen, setObjectQuickOpenOpen] = useState(false);
  const [objectQuickOpenQuery, setObjectQuickOpenQuery] = useState('');
  const [objectQuickOpenItems, setObjectQuickOpenItems] = useState<ObjectQuickOpenItem[]>([]);
  const [objectQuickOpenLoading, setObjectQuickOpenLoading] = useState(false);
  const [objectQuickOpenError, setObjectQuickOpenError] = useState('');
  const [sqlCompletionData, setSQLCompletionData] = useState<SQLCompletionData>({
    profileID: '',
    database: '',
    objects: [],
    schemas: [],
  });
  const [objectQuickOpenActiveIndex, setObjectQuickOpenActiveIndex] = useState(0);
  const [objectQuickOpenInteractionMode, setObjectQuickOpenInteractionMode] = useState<'keyboard' | 'mouse'>('keyboard');
  const [savingScriptID, setSavingScriptID] = useState('');
  const handleRunRef = useRef<() => void>(() => { });

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabID) ?? tabs[0],
    [activeTabID, tabs],
  );

  const activeObjectTab = useMemo(
    () => objectTabs.find((tab) => tab.id === activeWorkspaceTabID) ?? null,
    [activeWorkspaceTabID, objectTabs],
  );

  const activeWorkspaceIsQuery = !activeObjectTab;
  const activeProfileID = activeObjectTab?.node.profileID || activeTab?.profileID || selectedProfileID;

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileID) ?? null,
    [activeProfileID, profiles],
  );
  const connectionPickerDisabled = !activeWorkspaceIsQuery || activeTab?.running || profiles.length === 0;
  const databaseOptionsState = activeProfileID ? databaseOptionsByProfileID[activeProfileID] : undefined;
  const selectedDatabase = activeObjectTab?.node.database || activeTab?.database || selectedProfile?.database || '';
  const databaseOptions = useMemo(() => {
    const databaseNames = databaseOptionsState?.databases ?? [];
    return uniqueStrings([selectedDatabase, selectedProfile?.database ?? '', ...databaseNames]);
  }, [databaseOptionsState?.databases, selectedDatabase, selectedProfile?.database]);
  const databasePickerDisabled =
    connectionPickerDisabled ||
    !activeProfileID ||
    (databaseOptionsState?.loading && databaseOptions.length === 0) ||
    databaseOptions.length === 0;
  const connectionStatus = useMemo(() => {
    if (loadingProfiles) {
      return {
        label: 'Loading',
        detail: 'Loading saved connections',
        kind: 'pending',
      };
    }

    if (!selectedProfile) {
      return {
        label: 'No connection',
        detail: 'Select a connection profile',
        kind: 'idle',
      };
    }

    if (databaseOptionsState?.loading || (!databaseOptionsState && activeWorkspaceIsQuery)) {
      return {
        label: 'Connecting',
        detail: `Setting up ${selectedProfile.name || selectedProfile.id}`,
        kind: 'pending',
      };
    }

    if (databaseOptionsState?.error) {
      return {
        label: 'Connection error',
        detail: databaseOptionsState.error,
        kind: 'error',
      };
    }

    return {
      label: 'Connected',
      detail: `${selectedProfile.name || selectedProfile.id}${selectedDatabase ? ` / ${selectedDatabase}` : ''}`,
      kind: 'connected',
    };
  }, [activeWorkspaceIsQuery, databaseOptionsState, loadingProfiles, selectedDatabase, selectedProfile]);
  const runDisabledReason = useMemo(() => {
    if (!activeWorkspaceIsQuery) {
      return 'Open a query tab to run SQL.';
    }
    if (!activeTab) {
      return 'Open a query tab to run SQL.';
    }
    if (activeTab.running) {
      return 'A query is already running in this tab.';
    }
    if (connectionStatus.kind !== 'connected') {
      return connectionStatus.detail || 'Connection is not active.';
    }
    if (!selectedDatabase) {
      return 'Select a database before running a query.';
    }
    return '';
  }, [activeTab, activeWorkspaceIsQuery, connectionStatus, selectedDatabase]);
  const runButtonDisabled = Boolean(runDisabledReason);

  const visibleResult = activeTab?.result ?? { schema: null, rows: null };
  const visibleError = activeTab?.error || activeTab?.job?.error?.message || globalError;
  const status = activeTab?.job?.status ?? 'idle';
  const jobStatusItems = useMemo(
    () => collectJobStatusItems(tabs, objectTabs, profiles, activeWorkspaceTabID),
    [tabs, objectTabs, profiles, activeWorkspaceTabID],
  );
  const filteredObjectQuickOpenItems = useMemo(
    () => filterObjectQuickOpenItems(objectQuickOpenItems, objectQuickOpenQuery),
    [objectQuickOpenItems, objectQuickOpenQuery],
  );
  const visibleObjectQuickOpenItems = useMemo(
    () => filteredObjectQuickOpenItems.slice(0, 80),
    [filteredObjectQuickOpenItems],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    objectTabsRef.current = objectTabs;
  }, [objectTabs]);

  useEffect(() => {
    selectedProfileIDRef.current = activeProfileID;
  }, [activeProfileID]);

  useEffect(() => () => {
    sqlCompletionProviderRef.current?.dispose();
    sqlCompletionProviderRef.current = null;
  }, []);

  useEffect(() => {
    sqlCompletionDataRef.current = sqlCompletionData;
    sqlColumnCompletionCacheRef.current.clear();
  }, [sqlCompletionData]);

  useEffect(() => {
    if (!activeWorkspaceIsQuery || !activeProfileID || !selectedDatabase) {
      setSQLCompletionData({ profileID: activeProfileID, database: selectedDatabase, objects: [], schemas: [] });
      return;
    }

    let canceled = false;

    async function loadSQLCompletionData() {
      try {
        const schemas = await ListExplorerSchemas(activeProfileID, selectedDatabase);
        const objectGroups = await Promise.all(
          schemas.map(async (schema) => {
            const objects = await ListExplorerSchemaObjects(activeProfileID, selectedDatabase, schema.name);
            return objects
              .filter((object): object is domain.ExplorerObject & { kind: SQLCompletionObject['kind'] } =>
                ['table', 'view', 'materialized_view', 'sequence', 'function', 'type'].includes(object.kind),
              )
              .map((object) => ({
                schema: object.schema,
                name: object.name,
                kind: object.kind,
              }));
          }),
        );

        if (!canceled) {
          setSQLCompletionData({
            profileID: activeProfileID,
            database: selectedDatabase,
            objects: objectGroups.flat().sort((left, right) =>
              left.schema.localeCompare(right.schema) ||
              left.name.localeCompare(right.name) ||
              objectKindLabel(left.kind).localeCompare(objectKindLabel(right.kind)),
            ),
            schemas: schemas.map((schema) => schema.name).sort((left, right) => left.localeCompare(right)),
          });
        }
      } catch {
        if (!canceled) {
          setSQLCompletionData({ profileID: activeProfileID, database: selectedDatabase, objects: [], schemas: [] });
        }
      }
    }

    void loadSQLCompletionData();

    return () => {
      canceled = true;
    };
  }, [activeWorkspaceIsQuery, activeProfileID, selectedDatabase]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    let canceled = false;

    async function loadWorkspace() {
      try {
        const workspace = await LoadWorkspace();
        if (canceled) {
          return;
        }

        const restoredTabs = workspace.tabs
          .map((script, index) => editorTabFromScript(domain.ScriptTabState.createFrom(script), index + 1))
          .filter((tab) => tab.id);
        if (restoredTabs.length > 0) {
          const activeID = restoredTabs.some((tab) => tab.id === workspace.activeTabId)
            ? workspace.activeTabId
            : restoredTabs[0].id;
          setTabs(restoredTabs);
          setActiveTabID(activeID);
          setActiveWorkspaceTabID(activeID);
          tabCounterRef.current = Math.max(1, ...restoredTabs.map((tab) => queryTabIndex(tab.id)));
        }
      } catch (err) {
        showErrorToast(`Could not restore saved scripts: ${formatError(err)}`);
      } finally {
        if (!canceled) {
          workspaceLoadedRef.current = true;
        }
      }
    }

    void loadWorkspace();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceLoadedRef.current) {
      return;
    }

    if (workspaceSaveTimeoutRef.current !== null) {
      window.clearTimeout(workspaceSaveTimeoutRef.current);
    }

    workspaceSaveTimeoutRef.current = window.setTimeout(() => {
      const workspace = domain.ScriptWorkspace.createFrom({
        tabs: tabsRef.current.map(scriptStateFromTab),
        activeTabId: activeTabID,
      });
      void SaveWorkspace(workspace).catch((err) => {
        showErrorToast(`Could not remember open scripts: ${formatError(err)}`);
      });
      workspaceSaveTimeoutRef.current = null;
    }, 400);

    return () => {
      if (workspaceSaveTimeoutRef.current !== null) {
        window.clearTimeout(workspaceSaveTimeoutRef.current);
        workspaceSaveTimeoutRef.current = null;
      }
    };
  }, [tabs, activeTabID]);

  useEffect(() => {
    if (!workspaceLoadedRef.current) {
      return;
    }

    const dirtyTabs = tabs.filter((tab) => tab.sql !== tab.savedSQL);
    if (dirtyTabs.length === 0) {
      if (scriptAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(scriptAutosaveTimeoutRef.current);
        scriptAutosaveTimeoutRef.current = null;
      }
      return;
    }

    if (scriptAutosaveTimeoutRef.current !== null) {
      window.clearTimeout(scriptAutosaveTimeoutRef.current);
    }

    scriptAutosaveTimeoutRef.current = window.setTimeout(() => {
      const currentDirtyTabs = tabsRef.current.filter((tab) => tab.sql !== tab.savedSQL);
      void Promise.all(currentDirtyTabs.map((tab) => saveEditorTab(tab, false)));
      scriptAutosaveTimeoutRef.current = null;
    }, SCRIPT_AUTOSAVE_DELAY_MS);

    return () => {
      if (scriptAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(scriptAutosaveTimeoutRef.current);
        scriptAutosaveTimeoutRef.current = null;
      }
    };
  }, [tabs]);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        event.stopPropagation();
        setObjectQuickOpenOpen(true);
        setObjectQuickOpenQuery('');
        setObjectQuickOpenActiveIndex(0);
        setObjectQuickOpenInteractionMode('keyboard');
        return;
      }

      if (event.key === 'Escape') {
        setObjectQuickOpenOpen(false);
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  useEffect(() => {
    if (!objectQuickOpenOpen) {
      return;
    }

    window.setTimeout(() => {
      quickOpenInputRef.current?.focus();
      quickOpenInputRef.current?.select();
    }, 0);
  }, [objectQuickOpenOpen]);

  useEffect(() => {
    setObjectQuickOpenActiveIndex(0);
    setObjectQuickOpenInteractionMode('keyboard');
  }, [objectQuickOpenQuery, objectQuickOpenItems]);

  useEffect(() => {
    if (objectQuickOpenActiveIndex >= visibleObjectQuickOpenItems.length) {
      setObjectQuickOpenActiveIndex(Math.max(0, visibleObjectQuickOpenItems.length - 1));
    }
  }, [visibleObjectQuickOpenItems.length, objectQuickOpenActiveIndex]);

  useEffect(() => {
    if (!objectQuickOpenOpen || objectQuickOpenInteractionMode !== 'keyboard') {
      return;
    }

    const activeOption = quickOpenListRef.current?.querySelector<HTMLElement>(
      `[data-quick-open-index="${objectQuickOpenActiveIndex}"]`,
    );
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [objectQuickOpenOpen, objectQuickOpenActiveIndex, objectQuickOpenInteractionMode]);

  useEffect(() => {
    if (!objectQuickOpenOpen) {
      return;
    }

    const sourcesByKey = new Map<string, ObjectQuickOpenSource>();
    const addSource = (profileID: string, database: string) => {
      if (!profileID || !database) {
        return;
      }
      const profile = profiles.find((candidate) => candidate.id === profileID);
      if (!profile) {
        return;
      }
      sourcesByKey.set(`${profileID}:${database}`, {
        profileID,
        profileName: profile.name || profile.id,
        database,
      });
    };

    addSource(activeProfileID, selectedDatabase);
    tabs.forEach((tab) => addSource(tab.profileID, tab.database));
    objectTabs.forEach((tab) => addSource(tab.node.profileID, tab.node.database ?? ''));
    collectExplorerDatabaseSources(explorerNodes).forEach((source) => {
      addSource(source.profileID, source.database);
    });

    const sources = Array.from(sourcesByKey.values());

    if (sources.length === 0) {
      setObjectQuickOpenItems([]);
      setObjectQuickOpenLoading(false);
      setObjectQuickOpenError('Open or select a connection and database to open objects.');
      return;
    }

    let canceled = false;
    setObjectQuickOpenLoading(true);
    setObjectQuickOpenError('');

    async function loadQuickOpenObjects() {
      try {
        const sourceResults = await Promise.allSettled(
          sources.map(async (source) => {
            const schemas = await ListExplorerSchemas(source.profileID, source.database);
            const objectGroups = await Promise.all(
              schemas.map(async (schema) => {
                const objects = await ListExplorerSchemaObjects(source.profileID, source.database, schema.name);
                return objects
                  .filter((object): object is domain.ExplorerObject & { kind: ObjectQuickOpenItem['kind'] } =>
                    isInspectableExplorerObject({
                      id: '',
                      label: object.name,
                      kind: object.kind as ExplorerTreeNodeKind,
                      profileID: source.profileID,
                      database: source.database,
                      schema: object.schema,
                      objectName: object.name,
                      expanded: false,
                      loaded: true,
                      loading: false,
                      children: [],
                    }),
                  )
                  .map((object) => ({
                    id: quickOpenObjectID(source.profileID, source.database, object.schema, object.kind, object.name),
                    profileID: source.profileID,
                    profileName: source.profileName,
                    database: source.database,
                    schema: object.schema,
                    name: object.name,
                    kind: object.kind,
                  }));
              }),
            );
            return objectGroups.flat();
          }),
        );

        if (canceled) {
          return;
        }

        const items = sourceResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        const failedCount = sourceResults.filter((result) => result.status === 'rejected').length;
        setObjectQuickOpenItems(
          items
            .sort((left, right) =>
              left.profileName.localeCompare(right.profileName) ||
              left.database.localeCompare(right.database) ||
              left.schema.localeCompare(right.schema) ||
              left.name.localeCompare(right.name) ||
              objectKindLabel(left.kind).localeCompare(objectKindLabel(right.kind)),
            ),
        );
        setObjectQuickOpenError(
          items.length === 0 && failedCount > 0
            ? 'Objects could not be loaded from the open connections.'
            : '',
        );
      } catch (err) {
        if (!canceled) {
          setObjectQuickOpenItems([]);
          setObjectQuickOpenError(formatError(err));
        }
      } finally {
        if (!canceled) {
          setObjectQuickOpenLoading(false);
        }
      }
    }

    void loadQuickOpenObjects();

    return () => {
      canceled = true;
    };
  }, [objectQuickOpenOpen, activeProfileID, selectedDatabase, tabs, objectTabs, explorerNodes, profiles]);

  useEffect(() => {
    if (!activeWorkspaceIsQuery || !activeProfileID || databaseOptionsByProfileID[activeProfileID]?.loading) {
      return;
    }

    let canceled = false;
    setDatabaseOptionsByProfileID((current) => ({
      ...current,
      [activeProfileID]: {
        databases: current[activeProfileID]?.databases ?? [],
        loading: true,
        error: '',
      },
    }));
    updateExplorerNode(explorerNodeID('profile', activeProfileID), (current) => ({
      ...current,
      loading: true,
      error: '',
    }));

    async function loadDatabases() {
      try {
        const databases = await ListExplorerDatabases(activeProfileID);
        if (canceled) {
          return;
        }

        const databaseNames = databases.map((database) => database.name);
        const profileDatabase = profiles.find((profile) => profile.id === activeProfileID)?.database ?? '';
        const fallbackDatabase = preferredDatabase(activeTab?.database ?? '', profileDatabase, databaseNames);
        setDatabaseOptionsByProfileID((current) => ({
          ...current,
          [activeProfileID]: { databases: databaseNames, loading: false, error: '' },
        }));
        updateExplorerNode(explorerNodeID('profile', activeProfileID), (current) => ({
          ...current,
          loading: false,
          error: '',
        }));
        if (activeTab && fallbackDatabase !== activeTab.database) {
          updateTab(activeTab.id, { database: fallbackDatabase });
        }
      } catch (err) {
        if (!canceled) {
          const message = formatError(err);
          const profileName = profiles.find((profile) => profile.id === activeProfileID)?.name || activeProfileID;
          setDatabaseOptionsByProfileID((current) => ({
            ...current,
            [activeProfileID]: {
              databases: current[activeProfileID]?.databases ?? [],
              loading: false,
              error: message,
            },
          }));
          updateExplorerNode(explorerNodeID('profile', activeProfileID), (current) => ({
            ...current,
            expanded: false,
            loaded: false,
            loading: false,
            error: message,
            children: [],
          }));
          showErrorToast(`Could not set up connection "${profileName}": ${message}`);
          if (activeTab?.profileID === activeProfileID) {
            updateTab(activeTab.id, { profileID: '', database: '' });
          }
          if (selectedProfileID === activeProfileID) {
            setSelectedProfileID('');
          }
        }
      }
    }

    void loadDatabases();

    return () => {
      canceled = true;
    };
  }, [activeWorkspaceIsQuery, activeProfileID]);

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
          void loadFirstResultPage(summary.profileId || tab.profileID || selectedProfileIDRef.current, summary, tab.id);
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
    const nextSelectedID = selectID && nextProfiles.some((profile) => profile.id === selectID) ? selectID : '';
    const nextSelectedProfile = nextProfiles.find((profile) => profile.id === nextSelectedID);
    setProfiles(nextProfiles);
    setSelectedProfileID((current) =>
      nextSelectedID || (nextProfiles.some((profile) => profile.id === current) ? current : ''),
    );
    setTabs((current) =>
      current.map((tab) => {
        const profile = nextProfiles.find((candidate) => candidate.id === tab.profileID);
        if (profile) {
          return { ...tab, database: tab.database || profile.database };
        }
        return {
          ...tab,
          profileID: nextSelectedID,
          database: nextSelectedProfile?.database ?? '',
        };
      }),
    );
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

  async function loadSQLColumnCompletions(
    completionData: SQLCompletionData,
    relations: SQLReferencedRelation[],
  ) {
    const uniqueRelations = Array.from(
      new Map(relations.map((relation) => [`${relation.schema}.${relation.name}`, relation])).values(),
    );
    const columnGroups = await Promise.all(
      uniqueRelations.map(async (relation) => {
        const cacheKey = [
          completionData.profileID,
          completionData.database,
          relation.schema,
          relation.name,
        ].join(':');
        const cachedColumns = sqlColumnCompletionCacheRef.current.get(cacheKey);
        if (cachedColumns) {
          return cachedColumns;
        }

        const tableInfo = await GetTableInfo(
          completionData.profileID,
          completionData.database,
          relation.schema,
          relation.name,
        );
        const columns = tableInfo.columns.map((column) => ({
          table: relation.alias || relation.name,
          schema: relation.schema,
          name: column.name,
          dataType: column.dataType,
        }));
        sqlColumnCompletionCacheRef.current.set(cacheKey, columns);
        return columns;
      }),
    );

    const dedupedColumns = new Map<string, SQLCompletionColumn>();
    columnGroups.flat().forEach((column) => {
      const key = `${column.table}.${column.name}.${column.dataType}`;
      if (!dedupedColumns.has(key)) {
        dedupedColumns.set(key, column);
      }
    });
    return Array.from(dedupedColumns.values()).sort((left, right) =>
      left.name.localeCompare(right.name) ||
      left.table.localeCompare(right.table),
    );
  }

  const handleEditorBeforeMount: BeforeMount = (monaco) => {
    sqlCompletionProviderRef.current?.dispose();
    sqlCompletionProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: async (model, position) => {
        const context = getSQLCompletionContext(model, position);
        if (!context) {
          return { suggestions: [] };
        }

        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const completionData = sqlCompletionDataRef.current;
        const keywordSuggestions = Array.from(SQL_KEYWORDS)
          .sort((left, right) => left.localeCompare(right))
          .map<languages.CompletionItem>((keyword) => ({
            label: keyword.toUpperCase(),
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword.toUpperCase(),
            range,
          }));
        const functionSuggestions = SQL_FUNCTIONS.map<languages.CompletionItem>((functionName) => ({
          label: functionName,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${functionName}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        }));
        const schemaSuggestions = completionData.schemas.map<languages.CompletionItem>((schema) => ({
          label: schema,
          kind: monaco.languages.CompletionItemKind.Module,
          detail: 'schema',
          insertText: quoteIdentifier(schema),
          range,
        }));
        const buildObjectSuggestions = (objects: SQLCompletionObject[]) => objects.map<languages.CompletionItem>((object) => ({
          label: object.name,
          kind:
            object.kind === 'function'
              ? monaco.languages.CompletionItemKind.Function
              : object.kind === 'type'
                ? monaco.languages.CompletionItemKind.Class
                : monaco.languages.CompletionItemKind.Struct,
          detail: `${object.schema} - ${objectKindLabel(object.kind).toLowerCase()}`,
          insertText: quoteIdentifier(object.name),
          range,
        }));
        const objectSuggestions = buildObjectSuggestions(completionData.objects);
        const relations = getSQLReferencedRelations(model, position, completionData);
        const qualifier = context.qualifier.toLowerCase();
        const qualifiedRelations = qualifier
          ? relations.filter((relation) =>
            relation.alias.toLowerCase() === qualifier ||
            relation.name.toLowerCase() === qualifier,
          )
          : relations;
        const columnSuggestions = context.kind === 'column'
          ? (await loadSQLColumnCompletions(completionData, qualifiedRelations)).map<languages.CompletionItem>((column) => ({
            label: column.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `${column.table} - ${column.dataType}`,
            insertText: quoteIdentifier(column.name),
            range,
          }))
          : [];

        if (context.kind === 'object') {
          if (qualifier) {
            const childObjects = completionData.objects.filter((object) => object.schema.toLowerCase() === qualifier);
            return { suggestions: buildObjectSuggestions(childObjects) };
          }
          return { suggestions: [...schemaSuggestions, ...objectSuggestions] };
        }

        if (context.kind === 'column') {
          if (qualifier) {
            if (qualifiedRelations.length > 0) {
              return { suggestions: columnSuggestions };
            }
            const childObjects = completionData.objects.filter((object) => object.schema.toLowerCase() === qualifier);
            return { suggestions: buildObjectSuggestions(childObjects) };
          }
          return { suggestions: [...columnSuggestions, ...functionSuggestions, ...keywordSuggestions] };
        }

        if (context.kind === 'function') {
          return { suggestions: [...functionSuggestions, ...keywordSuggestions] };
        }

        return { suggestions: keywordSuggestions };
      },
    });

    monaco.editor.defineTheme('db-explorer-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'abb2bf', background: '101318' },
        { token: 'keyword', foreground: 'c678dd' },
        { token: 'keyword.control', foreground: 'c678dd' },
        { token: 'keyword.operator', foreground: 'abb2bf' },
        { token: 'operator', foreground: '56b6c2' },
        { token: 'operator.sql', foreground: '56b6c2' },
        { token: 'string', foreground: '98c379' },
        { token: 'string.sql', foreground: '98c379' },
        { token: 'number', foreground: 'd19a66' },
        { token: 'comment', foreground: '7f848e' },
        { token: 'predefined', foreground: '61afef' },
        { token: 'predefined.sql', foreground: '61afef' },
        { token: 'type', foreground: '56b6c2' },
        { token: 'variable', foreground: 'e06c75' },
        { token: 'identifier', foreground: 'abb2bf' },
        { token: 'delimiter', foreground: 'abb2bf' },
      ],
      colors: {
        'editor.background': '#101318',
        'editor.foreground': '#abb2bf',
        'editorGutter.background': '#101318',
        'editorLineNumber.foreground': '#667187',
        'editorLineNumber.activeForeground': '#abb2bf',
        'editorCursor.foreground': '#528bff',
        'editor.selectionBackground': '#67769660',
        'editor.inactiveSelectionBackground': '#2c313c',
        'editor.lineHighlightBackground': '#2c313c',
        'editorIndentGuide.background1': '#3a4250',
        'editorIndentGuide.activeBackground1': '#667187',
        'menu.background': '#171d26',
        'menu.foreground': '#cbd3df',
        'menu.selectionBackground': '#222a35',
        'menu.selectionForeground': '#eef3fb',
        'menu.separatorBackground': '#323946',
        'menu.border': '#323946',
        'editorWidget.background': '#171d26',
        'editorWidget.foreground': '#cbd3df',
        'editorWidget.border': '#323946',
      },
    });
  };

  const handleEditorMount: OnMount = (mountedEditor) => {
    editorRef.current = mountedEditor;
    const identifierDecorations = mountedEditor.createDecorationsCollection();
    const refreshIdentifierDecorations = () => {
      const model = mountedEditor.getModel();
      identifierDecorations.set(model ? buildSQLIdentifierDecorations(model.getValue()) : []);
    };

    refreshIdentifierDecorations();
    mountedEditor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => {
      handleRunRef.current();
    });
    mountedEditor.onDidChangeModelContent((event) => {
      const model = mountedEditor.getModel();
      if (!model || event.isFlush) {
        return;
      }

      event.changes.forEach((change) => {
        if (!change.text || !isSQLKeywordDelimiter(change.text[change.text.length - 1] ?? '')) {
          return;
        }

        uppercaseSQLKeywordBeforePosition(
          mountedEditor,
          model.getPositionAt(change.rangeOffset + change.text.length),
        );
      });
      refreshIdentifierDecorations();
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

  function showErrorToast(message: string) {
    toastCounterRef.current += 1;
    setToast({ id: toastCounterRef.current, message, kind: 'error' });
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

  function updateActiveConnection(profileID: string) {
    const profile = profiles.find((candidate) => candidate.id === profileID);
    const databaseNames = databaseOptionsByProfileID[profileID]?.databases ?? [];
    const database = preferredDatabase('', profile?.database ?? '', databaseNames);
    setGlobalError('');
    setToast(null);
    setSelectedProfileID(profileID);
    if (activeWorkspaceIsQuery && activeTab) {
      updateTab(activeTab.id, { profileID, database });
    }
  }

  function updateActiveDatabase(database: string) {
    if (activeWorkspaceIsQuery && activeTab) {
      updateTab(activeTab.id, { database });
    }
  }

  async function saveEditorTab(tab: EditorTab, chooseLocation: boolean) {
    if (!chooseLocation && tab.sql === tab.savedSQL) {
      return;
    }

    if (scriptAutosaveTimeoutRef.current !== null) {
      window.clearTimeout(scriptAutosaveTimeoutRef.current);
      scriptAutosaveTimeoutRef.current = null;
    }

    setSavingScriptID(tab.id);
    try {
      const response = await SaveScript(domain.SaveScriptRequest.createFrom({
        path: chooseLocation ? '' : tab.path,
        title: tab.title,
        sql: tab.sql,
        profileId: tab.profileID,
        database: tab.database,
        chooseLocation,
        defaultFilename: scriptDefaultFilename(tab),
      }));

      if (!response.path && chooseLocation) {
        return;
      }

      updateTab(tab.id, {
        path: response.path || tab.path,
        title: response.title || tab.title,
        savedSQL: tab.sql,
        error: '',
      });
    } catch (err) {
      updateTab(tab.id, { error: formatError(err) });
    } finally {
      setSavingScriptID('');
    }
  }

  function handleSaveActiveScriptAs() {
    if (activeWorkspaceIsQuery && activeTab) {
      void saveEditorTab(activeTab, true);
    }
  }

  function addEditorTab() {
    const nextIndex = tabCounterRef.current + 1;
    tabCounterRef.current = nextIndex;
    const nextTab = createEditorTab(nextIndex, activeProfileID, selectedDatabase);
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

  function handleAddConnection() {
    setProfileForm({ ...defaultProfileForm });
    setConnectionMessage('');
    setShowProfileForm((current) => !current || Boolean(profileForm.id));
  }

  function handleEditProfile(profile: domain.ConnProfile) {
    setProfileForm(profileToForm(profile));
    setConnectionMessage('');
    setShowProfileForm(true);
  }

  async function handleSaveProfile() {
    setSavingProfile(true);
    setConnectionMessage('');
    setGlobalError('');

    try {
      const profile = buildProfile(profileForm);
      await SaveProfile(profile);
      await refreshProfiles(profile.id);
      setShowProfileForm(false);
      setProfileForm({ ...defaultProfileForm });
      setConnectionMessage('Connection saved');
    } catch (err) {
      setGlobalError(formatError(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleTestProfile() {
    setTestingProfile(true);
    setConnectionMessage('');
    setGlobalError('');

    try {
      const profile = buildProfile(profileForm);
      const testResult = await TestConnectionProfile(profile);
      setConnectionMessage(testResult.message || (testResult.ok ? 'Connection test passed' : 'Connection test failed'));
    } catch (err) {
      setGlobalError(formatError(err));
    } finally {
      setTestingProfile(false);
    }
  }

  async function handleDeleteProfile(profile: domain.ConnProfile) {
    if (!window.confirm(`Delete connection "${profile.name || profile.id}"?`)) {
      return;
    }

    setDeletingProfileID(profile.id);
    setConnectionMessage('');
    setGlobalError('');

    try {
      await DeleteProfile(profile.id);
      await refreshProfiles();
      setDatabaseOptionsByProfileID((current) => {
        const next = { ...current };
        delete next[profile.id];
        return next;
      });
      setObjectTabs((current) => current.filter((tab) => tab.node.profileID !== profile.id));
      if (activeObjectTab?.node.profileID === profile.id) {
        setActiveWorkspaceTabID(activeTabID);
      }
      if (profileForm.id === profile.id) {
        setShowProfileForm(false);
        setProfileForm({ ...defaultProfileForm });
      }
      setConnectionMessage('Connection deleted');
    } catch (err) {
      setGlobalError(formatError(err));
    } finally {
      setDeletingProfileID('');
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

    const database = tab.database || profile.database;

    if (!database) {
      updateTab(tab.id, { error: 'Select a database before running a query.' });
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
        database,
        sql: target.sql,
        statements: [
          {
            startOffset: target.startOffset,
            endOffset: target.endOffset,
            text: target.sql,
          },
        ],
        mode: target.mode,
        limit: RESULT_PREVIEW_ROW_LIMIT,
        readOnly: true,
      }));

      updateTab(tab.id, {
        activeJobID: response.jobId,
        job: domain.JobSummary.createFrom({
          jobId: response.jobId,
          profileId: profile.id,
          database,
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
    const cancelProfileID = tab?.job?.profileId || tab?.profileID || activeProfileID;
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
      updateActiveConnection(node.profileID);
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
        title: node.objectName ?? node.label,
        node,
        section: 'overview',
        state: { loading: true, error: '', info: null },
        data: { schema: null, rows: null },
        dataFilter: '',
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

  function openQuickOpenObject(item: ObjectQuickOpenItem) {
    const node: ExplorerTreeNode = {
      id: explorerNodeID(
        'object',
        item.profileID,
        item.database,
        item.schema,
        item.kind,
        item.name,
      ),
      label: item.name,
      kind: item.kind,
      profileID: item.profileID,
      database: item.database,
      schema: item.schema,
      objectName: item.name,
      expanded: false,
      loaded: true,
      loading: false,
      children: [],
    };

    setObjectQuickOpenOpen(false);
    setSelectedProfileID(item.profileID);
    setSelectedExplorerNodeID(node.id);
    openObjectInfoTab(node);
  }

  function openLinkedObjectInfo(tab: ObjectInfoTab, target: ObjectLinkTarget) {
    const node: ExplorerTreeNode = {
      id: explorerNodeID(
        'object',
        tab.node.profileID,
        tab.node.database ?? '',
        target.schema,
        target.kind,
        target.name,
      ),
      label: target.name,
      kind: target.kind,
      profileID: tab.node.profileID,
      database: tab.node.database,
      schema: target.schema,
      objectName: target.name,
      expanded: false,
      loaded: true,
      loading: false,
      children: [],
    };
    setSelectedProfileID(tab.node.profileID);
    setSelectedExplorerNodeID(node.id);
    openObjectInfoTab(node);
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
      const filter = tab.dataFilter.trim();
      const sql = [
        `select *`,
        `from ${quoteIdentifier(tab.node.schema ?? 'public')}.${quoteIdentifier(tab.node.objectName ?? tab.node.label)}`,
        ...(filter ? [`where ${filter}`] : []),
        `limit 100;`,
      ].join('\n');
      const response = await RunQuery(domain.RunQueryRequest.createFrom({
        profileId: tab.node.profileID,
        database: tab.node.database ?? '',
        sql,
        statements: [{ startOffset: 0, endOffset: sql.length, text: sql }],
        mode: 'statement',
        limit: RESULT_PREVIEW_ROW_LIMIT,
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
      const message = formatError(err);
      updateExplorerNode(node.id, (current) => ({
        ...current,
        loading: false,
        error: message,
      }));
      if (node.kind === 'connection') {
        showErrorToast(`Could not set up connection "${node.label}": ${message}`);
      }
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
          count: RESULT_PREVIEW_ROW_LIMIT,
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
          count: RESULT_PREVIEW_ROW_LIMIT,
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
            const nextJob = await GetJob(tab.job?.profileId || tab.profileID || selectedProfileIDRef.current, tab.activeJobID);
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
          <img className="app-title-icon" src={appIconURL} alt="DB Explorer" />
        </div>
        <div className="titlebar-center titlebar-control titlebar-tabs">
          <div className="tab-strip">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                title={tab.title}
                className={tab.id === activeWorkspaceTabID ? 'tab active' : 'tab'}
                onClick={() => {
                  setActiveTabID(tab.id);
                  setActiveWorkspaceTabID(tab.id);
                }}
              >
                <span className="tab-icon"><FileCode2 size={15} strokeWidth={1.8} /></span>
                <span>{tab.title}{tab.sql !== tab.savedSQL ? ' *' : ''}</span>
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
                    <X size={13} strokeWidth={2} />
                  </span>
                )}
              </button>
            ))}
            {objectTabs.map((tab) => {
              const Icon = iconForObjectTabKind(tab.node.kind);
              const tooltip = `${tab.title} (${objectKindLabel(tab.node.kind).toLowerCase()})`;
              return (
                <button
                  type="button"
                  key={tab.id}
                  title={tooltip}
                  className={tab.id === activeWorkspaceTabID ? 'tab active object-tab' : 'tab object-tab'}
                  onClick={() => setActiveWorkspaceTabID(tab.id)}
                >
                  <span className={`tab-icon ${tab.node.kind}`}><Icon size={15} strokeWidth={1.8} /></span>
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
                    <X size={13} strokeWidth={2} />
                  </span>
                </button>
              );
            })}
            <button type="button" className="new-tab" onClick={addEditorTab} aria-label="New query tab">
              <Plus size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="titlebar-right titlebar-control">
          <div className="layout-controls" aria-label="Layout controls">
            <button
              type="button"
              aria-label="Toggle explorer pane"
              aria-pressed={explorerPaneOpen}
              title="Toggle explorer pane"
              className={explorerPaneOpen ? 'active' : undefined}
              onClick={() => setExplorerPaneOpen((current) => !current)}
            >
              <LayoutPaneIcon pane="left" open={explorerPaneOpen} size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Toggle results pane"
              aria-pressed={resultsPaneOpen}
              title="Toggle results pane"
              className={resultsPaneOpen ? 'active' : undefined}
              onClick={() => setResultsPaneOpen((current) => !current)}
            >
              <LayoutPaneIcon pane="bottom" open={resultsPaneOpen} size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Right pane unavailable"
              title="Right pane unavailable"
              disabled
            >
              <LayoutPaneIcon pane="right" size={16} strokeWidth={1.8} />
            </button>
          </div>
          <div className="window-controls">
            <button type="button" aria-label="Minimize window" onClick={WindowMinimise}>
              <Minus size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
              onClick={() => void handleToggleMaximize()}
            >
              {windowMaximized ? <Copy size={15} strokeWidth={1.8} style={{ transform: 'scaleX(-1)' }} /> : <Square size={15} strokeWidth={1.8} />}
            </button>
            <button type="button" aria-label="Close window" className="window-close" onClick={Quit}>
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      <div className={explorerPaneOpen ? 'app-body' : 'app-body explorer-collapsed'}>
        {explorerPaneOpen && (
          <aside className="explorer-pane">
            <header className="pane-header">
              <span>Connections</span>
              <div className="pane-header-actions">
                <button
                  type="button"
                  aria-label="Collapse all"
                  title="Collapse all"
                  onClick={() => setExplorerNodes((current) => collapseExplorerNodes(current))}
                  disabled={explorerNodes.length === 0}
                >
                  <ChevronsDownUp size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label="Add connection"
                  title="Add connection"
                  onClick={handleAddConnection}
                >
                  <Plus size={15} strokeWidth={2} />
                </button>
              </div>
            </header>
            <div className="explorer-content">
              {showProfileForm && (
                <ConnectionForm
                  form={profileForm}
                  saving={savingProfile}
                  testing={testingProfile}
                  onChange={updateProfileField}
                  onSave={() => void handleSaveProfile()}
                  onTest={() => void handleTestProfile()}
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
                  selectedProfileID={activeProfileID}
                  selectedNodeID={selectedExplorerNodeID}
                  onNodeClick={(node) => void handleExplorerNodeClick(node)}
                  renderNodeActions={(node) => {
                    if (node.kind !== 'connection') {
                      return null;
                    }
                    const profile = profiles.find((candidate) => candidate.id === node.profileID);
                    if (!profile) {
                      return null;
                    }
                    const busy = savingProfile || testingProfile || deletingProfileID === profile.id;
                    return (
                      <>
                        <button
                          type="button"
                          aria-label={`Edit ${profile.name || profile.id}`}
                          title="Edit connection"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEditProfile(profile);
                          }}
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${profile.name || profile.id}`}
                          title="Delete connection"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteProfile(profile);
                          }}
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </>
                    );
                  }}
                />
              )}
            </div>
          </aside>
        )}

        <section className={resultsPaneOpen ? 'workspace' : 'workspace results-collapsed'}>
          <header className="top-bar">
            <div className="toolbar">
              <button
                type="button"
                onClick={handleRun}
                disabled={runButtonDisabled}
                title={runDisabledReason || 'Run query'}
              >
                <Play size={15} strokeWidth={2} />
                <span>Run</span>
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={!activeWorkspaceIsQuery || !activeTab?.running || !activeTab.activeJobID}
              >
                <Square size={14} strokeWidth={2} />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                onClick={handleSaveActiveScriptAs}
                disabled={!activeWorkspaceIsQuery || !activeTab || savingScriptID === activeTab.id}
                title="Save script to another location"
              >
                <Save size={15} strokeWidth={2} />
                <span>Save As</span>
              </button>
            </div>
            <div className="top-bar-connection">
              <ConnectionDropdown
                profiles={profiles}
                selectedProfileID={activeProfileID}
                disabled={connectionPickerDisabled}
                onChange={updateActiveConnection}
              />
              <DatabaseDropdown
                databases={databaseOptions}
                selectedDatabase={selectedDatabase}
                disabled={databasePickerDisabled}
                loading={databaseOptionsState?.loading ?? false}
                error={databaseOptionsState?.error ?? ''}
                onChange={updateActiveDatabase}
              />
              <div className={`connection-status ${connectionStatus.kind}`} title={connectionStatus.detail}>
                <span className="connection-status-dot" />
                <span>{connectionStatus.label}</span>
              </div>
            </div>
            <div className="top-bar-spacer" />
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
                onDataFilterChange={(dataFilter) => updateObjectTab(activeObjectTab.id, { dataFilter })}
                onOpenObject={(target) => openLinkedObjectInfo(activeObjectTab, target)}
              />
            ) : (
              <Editor
                key={activeTab?.id}
                defaultLanguage="sql"
                value={activeTab?.sql ?? ''}
                onChange={(value) => updateActiveTabSQL(value ?? '')}
                beforeMount={handleEditorBeforeMount}
                onMount={handleEditorMount}
                theme="db-explorer-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineHeight: 22,
                  fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            )}
          </section>

          {resultsPaneOpen && (
            <section className="results-region">
              <header className="pane-header">
                <span>{visibleResult.rows ? resultLabel(visibleResult.rows, activeTab?.job) : 'Results'}</span>
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
          )}
        </section>
      </div>
      {objectQuickOpenOpen && (
        <div className="quick-open-backdrop" onMouseDown={() => setObjectQuickOpenOpen(false)}>
          <section
            className="quick-open"
            role="dialog"
            aria-modal="true"
            aria-label="Open object"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="quick-open-input-row">
              <Search size={16} strokeWidth={2} />
              <input
                ref={quickOpenInputRef}
                value={objectQuickOpenQuery}
                onChange={(event) => setObjectQuickOpenQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setObjectQuickOpenOpen(false);
                    return;
                  }

                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setObjectQuickOpenInteractionMode('keyboard');
                    setObjectQuickOpenActiveIndex((current) =>
                      visibleObjectQuickOpenItems.length === 0
                        ? 0
                        : Math.min(current + 1, visibleObjectQuickOpenItems.length - 1),
                    );
                    return;
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setObjectQuickOpenInteractionMode('keyboard');
                    setObjectQuickOpenActiveIndex((current) => Math.max(0, current - 1));
                    return;
                  }

                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const selectedItem = visibleObjectQuickOpenItems[objectQuickOpenActiveIndex];
                    if (selectedItem) {
                      openQuickOpenObject(selectedItem);
                    }
                  }
                }}
                placeholder="Search objects by name, schema, or type"
                aria-label="Search database objects"
              />
            </div>
            <div
              ref={quickOpenListRef}
              className={
                objectQuickOpenInteractionMode === 'keyboard'
                  ? 'quick-open-list keyboard-nav'
                  : 'quick-open-list'
              }
              role="listbox"
            >
              {objectQuickOpenLoading ? (
                <div className="quick-open-empty">Loading objects</div>
              ) : objectQuickOpenError ? (
                <div className="quick-open-empty error">{objectQuickOpenError}</div>
              ) : visibleObjectQuickOpenItems.length === 0 ? (
                <div className="quick-open-empty">No objects found</div>
              ) : (
                visibleObjectQuickOpenItems.map((item, index) => {
                  const Icon = iconForObjectTabKind(item.kind);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      data-quick-open-index={index}
                      aria-selected={index === objectQuickOpenActiveIndex}
                      className={index === objectQuickOpenActiveIndex ? 'quick-open-item active' : 'quick-open-item'}
                      onMouseMove={() => {
                        setObjectQuickOpenInteractionMode('mouse');
                        setObjectQuickOpenActiveIndex(index);
                      }}
                      onClick={() => openQuickOpenObject(item)}
                    >
                      <span className={`quick-open-icon ${item.kind}`}>
                        <Icon size={16} strokeWidth={1.8} />
                      </span>
                      <span className="quick-open-label">
                        <strong>{item.name}</strong>
                        <span>{item.schema} - {item.profileName} / {item.database}</span>
                      </span>
                      <span className="quick-open-kind">{objectKindLabel(item.kind)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}
      <StatusBar
        jobs={jobStatusItems}
        open={statusPanelOpen}
        onToggle={() => setStatusPanelOpen((current) => !current)}
      />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </main>
  );
}
