import { domain } from '../wailsjs/go/models';

export type ResultState = {
  schema: domain.ResultSchema | null;
  rows: domain.GetRowsResponse | null;
};

export type QueryResultTab = {
  id: string;
  title: string;
  profileID: string;
  database: string;
  sql: string;
  job: domain.JobSummary | null;
  activeJobID: string;
  result: ResultState;
  running: boolean;
  error: string;
};

export type SQLExecutionTarget = {
  sql: string;
  mode: 'selection' | 'statement';
  startOffset: number;
  endOffset: number;
  cursorEndOffset?: number;
};

export type JobResultSetEvent = {
  summary: domain.JobSummary;
  schema: domain.ResultSchema;
};

export type EditorTab = {
  id: string;
  title: string;
  path: string;
  profileID: string;
  database: string;
  sql: string;
  savedSQL: string;
  job: domain.JobSummary | null;
  activeJobID: string;
  result: ResultState;
  resultTabs: QueryResultTab[];
  activeResultTabID: string;
  running: boolean;
  error: string;
};

export type ObjectInfoSection = 'overview' | 'ddl' | 'columns' | 'indexes' | 'foreignKeys' | 'references' | 'values' | 'usedBy' | 'functions' | 'data';

export type ObjectInfoTab = {
  id: string;
  title: string;
  node: ExplorerTreeNode;
  section: ObjectInfoSection;
  state: ObjectInfoState;
  data: ResultState;
  dataFilter: string;
  dataJob: domain.JobSummary | null;
  dataActiveJobID: string;
  dataRunning: boolean;
  dataError: string;
};

export type JobStatusItem = {
  id: string;
  label: string;
  status: string;
  database?: string;
  profileID?: string;
  profileName?: string;
  jobID: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  resultSetCount?: number;
  active: boolean;
};

export type ExplorerTreeNodeKind =
  | 'folder'
  | 'connection'
  | 'database'
  | 'schema'
  | 'group'
  | 'table'
  | 'view'
  | 'materialized_view'
  | 'sequence'
  | 'function'
  | 'type';

export type ExplorerTreeNode = {
  id: string;
  label: string;
  detail?: string;
  kind: ExplorerTreeNodeKind;
  profileID: string;
  database?: string;
  schema?: string;
  objectName?: string;
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  error?: string;
  children: ExplorerTreeNode[];
};

export type ObjectInfoState = {
  loading: boolean;
  error: string;
  info: domain.ObjectInfo | null;
};

export type ProfileFormState = {
  id: string;
  name: string;
  folder: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslMode: string;
};
