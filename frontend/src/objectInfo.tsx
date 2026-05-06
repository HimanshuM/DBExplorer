import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, LoaderCircle, RefreshCw } from 'lucide-react';
import { ClipboardSetText } from '../wailsjs/runtime/runtime';
import { ClearableInput } from './components/ClearableInput';
import {
  isDataExplorerObject,
} from './explorerTree';
import { quoteIdentifier } from './format';
import { ResultTable, resultLabel } from './resultTable';
import {
  type ObjectInfoSection,
  type ObjectInfoState,
  type ObjectInfoTab,
  type ExplorerTreeNodeKind,
} from './types';

export type ObjectLinkTarget = {
  kind: Extract<ExplorerTreeNodeKind, 'table' | 'view' | 'materialized_view' | 'sequence' | 'function' | 'type'>;
  schema: string;
  name: string;
};

export function ObjectInfoWorkspace({
  tab,
  onSectionChange,
  onRefreshData,
  onDataFilterChange,
  onOpenObject,
}: {
  tab: ObjectInfoTab;
  onSectionChange: (section: ObjectInfoSection) => void;
  onRefreshData: () => void;
  onDataFilterChange: (filter: string) => void;
  onOpenObject: (target: ObjectLinkTarget) => void;
}) {
  const info = tab.state.info;
  const sections: { id: ObjectInfoSection; label: string; enabled: boolean }[] = [
    { id: 'overview', label: 'Overview', enabled: true },
    { id: 'ddl', label: 'DDL', enabled: Boolean(info?.ddl) },
    { id: 'columns', label: 'Columns', enabled: Boolean(info?.columns?.length) },
    { id: 'indexes', label: 'Indexes', enabled: Boolean(info?.indexes?.length) },
    { id: 'foreignKeys', label: 'Foreign Keys', enabled: Boolean(info?.foreignKeys?.length) },
    { id: 'references', label: 'References', enabled: Boolean(info?.referencedBy?.length) },
    { id: 'values', label: 'Values', enabled: Boolean(info?.type?.labels?.length || info?.type?.check) },
    { id: 'usedBy', label: 'Used By', enabled: Boolean(info?.type?.usages?.length) },
    { id: 'functions', label: 'Functions', enabled: Boolean(info?.functions?.length) },
    { id: 'data', label: 'Data', enabled: isDataExplorerObject(tab.node) },
  ];
  const visibleSection = sections.some((section) => section.id === tab.section && section.enabled)
    ? tab.section
    : 'overview';

  return (
    <div className="object-workspace">
      <header className="object-workspace-header">
        <div className="object-heading">
          <span>{objectKindLabel(tab.node.kind)}</span>
          <strong>
            {tab.node.schema ? `${tab.node.schema}.${tab.node.objectName ?? tab.node.label}` : tab.node.label}
          </strong>
        </div>
        <div className="object-section-tabs">
          {sections
            .filter((section) => section.enabled)
            .map((section) => (
              <button
                key={section.id}
                type="button"
                className={visibleSection === section.id ? 'section-tab active' : 'section-tab'}
                onClick={() => onSectionChange(section.id)}
              >
                {section.label}
              </button>
            ))}
        </div>
      </header>
      <ObjectInfoContent
        tab={tab}
        section={visibleSection}
        onRefreshData={onRefreshData}
        onDataFilterChange={onDataFilterChange}
        onOpenObject={onOpenObject}
      />
    </div>
  );
}

function ObjectInfoContent({
  tab,
  section,
  onRefreshData,
  onDataFilterChange,
  onOpenObject,
}: {
  tab: ObjectInfoTab;
  section: ObjectInfoSection;
  onRefreshData: () => void;
  onDataFilterChange: (filter: string) => void;
  onOpenObject: (target: ObjectLinkTarget) => void;
}) {
  if (tab.state.loading) {
    return <div className="result-placeholder">Loading object info</div>;
  }

  if (tab.state.error) {
    return <div className="message error">{tab.state.error}</div>;
  }

  if (!tab.state.info) {
    return <div className="result-placeholder">Select an object in the explorer</div>;
  }

  if (section === 'data') {
    return (
      <div className="object-info object-data">
        <div className="object-data-toolbar">
          <span>{tab.data.rows ? resultLabel(tab.data.rows, tab.dataJob) : 'Data preview'}</span>
          <ClearableInput
            value={tab.dataFilter}
            onChange={onDataFilterChange}
            onEnter={onRefreshData}
            placeholder="Filter, e.g. status = 'active'"
            ariaLabel="data filter"
            title="WHERE clause only, without the WHERE keyword"
            disabled={tab.dataRunning}
            inputClassName="object-data-filter"
          />
          <button
            type="button"
            className="icon-button object-data-refresh"
            onClick={onRefreshData}
            disabled={tab.dataRunning}
            aria-label={tab.dataRunning ? 'Loading data' : 'Refresh data'}
            title={tab.dataRunning ? 'Loading data' : 'Refresh data'}
          >
            {tab.dataRunning ? <LoaderCircle size={14} strokeWidth={2} /> : <RefreshCw size={14} strokeWidth={2} />}
          </button>
        </div>
        {tab.dataError ? (
          <div className="message error">{tab.dataError}</div>
        ) : tab.data.schema && tab.data.rows ? (
          <ResultTable schema={tab.data.schema} rows={tab.data.rows} />
        ) : (
          <div className="result-placeholder">
            {tab.dataRunning ? 'Waiting for data' : 'Open the data tab to load a preview'}
          </div>
        )}
      </div>
    );
  }

  return <ObjectInfoPanel state={tab.state} section={section} onOpenObject={onOpenObject} />;
}

function ObjectInfoPanel({
  state,
  section = 'overview',
  onOpenObject,
}: {
  state: ObjectInfoState;
  section?: ObjectInfoSection;
  onOpenObject: (target: ObjectLinkTarget) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expandedIndexDDL, setExpandedIndexDDL] = useState<Record<string, boolean>>({});
  const [expandedForeignKeyDDL, setExpandedForeignKeyDDL] = useState<Record<string, boolean>>({});
  const [expandedReferenceDDL, setExpandedReferenceDDL] = useState<Record<string, boolean>>({});
  const [copiedIndexDDL, setCopiedIndexDDL] = useState('');
  const [copiedForeignKeyDDL, setCopiedForeignKeyDDL] = useState('');
  const [copiedReferenceDDL, setCopiedReferenceDDL] = useState('');

  if (state.loading) {
    return <div className="result-placeholder">Loading object info</div>;
  }

  if (state.error) {
    return <div className="message error">{state.error}</div>;
  }

  if (!state.info) {
    return <div className="result-placeholder">Select an object in the explorer</div>;
  }

  const info = state.info;

  async function copyDDL() {
    if (!info.ddl) {
      return;
    }
    const copiedToClipboard = await ClipboardSetText(info.ddl);
    if (copiedToClipboard) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  }

  async function copyIndexDDL(indexName: string, ddl: string) {
    const copiedToClipboard = await ClipboardSetText(ddl);
    if (copiedToClipboard) {
      setCopiedIndexDDL(indexName);
      window.setTimeout(() => setCopiedIndexDDL(''), 1400);
    }
  }

  async function copyForeignKeyDDL(foreignKeyName: string, ddl: string) {
    const copiedToClipboard = await ClipboardSetText(ddl);
    if (copiedToClipboard) {
      setCopiedForeignKeyDDL(foreignKeyName);
      window.setTimeout(() => setCopiedForeignKeyDDL(''), 1400);
    }
  }

  async function copyReferenceDDL(referenceName: string, ddl: string) {
    const copiedToClipboard = await ClipboardSetText(ddl);
    if (copiedToClipboard) {
      setCopiedReferenceDDL(referenceName);
      window.setTimeout(() => setCopiedReferenceDDL(''), 1400);
    }
  }

  function toggleIndexDDL(indexName: string) {
    setExpandedIndexDDL((current) => ({
      ...current,
      [indexName]: !current[indexName],
    }));
  }

  function toggleForeignKeyDDL(foreignKeyName: string) {
    setExpandedForeignKeyDDL((current) => ({
      ...current,
      [foreignKeyName]: !current[foreignKeyName],
    }));
  }

  function toggleReferenceDDL(referenceID: string) {
    setExpandedReferenceDDL((current) => ({
      ...current,
      [referenceID]: !current[referenceID],
    }));
  }

  function foreignKeyDDL(foreignKey: {
    name: string;
    definition: string;
  }) {
    return [
      `ALTER TABLE ${quoteIdentifier(info.schema)}.${quoteIdentifier(info.name)}`,
      `ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} ${foreignKey.definition};`,
    ].join('\n');
  }

  function referenceDDL(reference: {
    name: string;
    schema: string;
    table: string;
    definition: string;
  }) {
    return [
      `ALTER TABLE ${quoteIdentifier(reference.schema)}.${quoteIdentifier(reference.table)}`,
      `ADD CONSTRAINT ${quoteIdentifier(reference.name)} ${reference.definition};`,
    ].join('\n');
  }

  function canLinkColumnType(column: { typeSchema?: string; typeName?: string }) {
    return Boolean(column.typeSchema && column.typeName && !['pg_catalog', 'information_schema'].includes(column.typeSchema));
  }

  function openTable(schema: string, name: string) {
    onOpenObject({ kind: 'table', schema, name });
  }

  function openType(schema: string, name: string) {
    onOpenObject({ kind: 'type', schema, name });
  }

  const focusedSection = section !== 'overview';

  return (
    <div className={focusedSection ? 'object-info focused' : 'object-info'}>
      <section className="object-summary">
        {info.details?.map((detail) => (
          <div key={detail.name} className="object-summary-item">
            <span>{detail.name}</span>
            <strong>{detail.value}</strong>
          </div>
        ))}
      </section>

      {section === 'ddl' && info.ddl && (
        <section className="object-section object-ddl-section">
          <div className="object-section-header">
            <h3>DDL</h3>
            <button type="button" className="icon-text-button" onClick={() => void copyDDL()}>
              <Copy size={14} strokeWidth={1.8} />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="object-ddl"><code>{info.ddl}</code></pre>
        </section>
      )}

      {(section === 'columns' || section === 'overview') && info.columns?.length > 0 && (
        <section className="object-section">
          <h3>Columns</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Nullable</th>
                  <th>Key</th>
                  <th>Default</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {info.columns.map((column) => (
                  <tr key={column.name}>
                    <td>{column.position}</td>
                    <td>{column.name}</td>
                    <td>
                      {canLinkColumnType(column) ? (
                        <button
                          type="button"
                          className="table-link"
                          onClick={() => openType(column.typeSchema, column.typeName)}
                        >
                          {column.dataType}
                        </button>
                      ) : (
                        column.dataType
                      )}
                    </td>
                    <td>{column.nullable ? 'Yes' : 'No'}</td>
                    <td>{column.primaryKey ? 'PK' : ''}</td>
                    <td>{column.default}</td>
                    <td>{column.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(section === 'indexes' || section === 'overview') && info.indexes?.length > 0 && (
        <section className="object-section">
          <h3>Indexes</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>DDL</th>
                  <th>Name</th>
                  <th>Columns</th>
                  <th>Primary</th>
                  <th>Unique</th>
                  <th>Partial</th>
                  <th>Valid</th>
                </tr>
              </thead>
              <tbody>
                {info.indexes.map((index) => {
                  const expanded = Boolean(expandedIndexDDL[index.name]);
                  return (
                    <Fragment key={index.name}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="icon-button table-icon-button"
                            onClick={() => toggleIndexDDL(index.name)}
                            disabled={!index.definition}
                            aria-label={`${expanded ? 'Hide' : 'Show'} DDL for ${index.name}`}
                            title={`${expanded ? 'Hide' : 'Show'} DDL`}
                          >
                            {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                          </button>
                        </td>
                        <td>{index.name}</td>
                        <td>{index.columns?.join(', ')}</td>
                        <td>{index.primary ? 'Yes' : 'No'}</td>
                        <td>{index.unique ? 'Yes' : 'No'}</td>
                        <td>{index.partial ? 'Yes' : 'No'}</td>
                        <td>{index.valid ? 'Yes' : 'No'}</td>
                      </tr>
                      {expanded && index.definition && (
                        <tr className="index-ddl-row">
                          <td colSpan={7}>
                            <div className="index-ddl">
                              <div className="index-ddl-toolbar">
                                <span>{index.name} DDL</span>
                                <button type="button" className="icon-text-button" onClick={() => void copyIndexDDL(index.name, index.definition)}>
                                  <Copy size={14} strokeWidth={1.8} />
                                  <span>{copiedIndexDDL === index.name ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                              <pre className="object-ddl index-ddl-code"><code>{index.definition}</code></pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(section === 'foreignKeys' || section === 'overview') && info.foreignKeys?.length > 0 && (
        <section className="object-section">
          <h3>Foreign Keys</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>DDL</th>
                  <th>Name</th>
                  <th>Columns</th>
                  <th>References</th>
                  <th>Referenced Columns</th>
                  <th>On Update</th>
                  <th>On Delete</th>
                  <th>Deferrable</th>
                </tr>
              </thead>
              <tbody>
                {info.foreignKeys.map((foreignKey) => {
                  const expanded = Boolean(expandedForeignKeyDDL[foreignKey.name]);
                  const ddl = foreignKey.definition ? foreignKeyDDL(foreignKey) : '';
                  return (
                    <Fragment key={foreignKey.name}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="icon-button table-icon-button"
                            onClick={() => toggleForeignKeyDDL(foreignKey.name)}
                            disabled={!ddl}
                            aria-label={`${expanded ? 'Hide' : 'Show'} DDL for ${foreignKey.name}`}
                            title={`${expanded ? 'Hide' : 'Show'} DDL`}
                          >
                            {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                          </button>
                        </td>
                        <td>{foreignKey.name}</td>
                        <td>{foreignKey.columns?.join(', ')}</td>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => openTable(foreignKey.referencedSchema, foreignKey.referencedTable)}
                          >
                            {`${foreignKey.referencedSchema}.${foreignKey.referencedTable}`}
                          </button>
                        </td>
                        <td>{foreignKey.referencedColumns?.join(', ')}</td>
                        <td>{foreignKey.updateAction}</td>
                        <td>{foreignKey.deleteAction}</td>
                        <td>{foreignKey.deferrable ? (foreignKey.initiallyDeferred ? 'Initially deferred' : 'Yes') : 'No'}</td>
                      </tr>
                      {expanded && ddl && (
                        <tr className="index-ddl-row">
                          <td colSpan={8}>
                            <div className="index-ddl">
                              <div className="index-ddl-toolbar">
                                <span>{foreignKey.name} DDL</span>
                                <button type="button" className="icon-text-button" onClick={() => void copyForeignKeyDDL(foreignKey.name, ddl)}>
                                  <Copy size={14} strokeWidth={1.8} />
                                  <span>{copiedForeignKeyDDL === foreignKey.name ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                              <pre className="object-ddl index-ddl-code"><code>{ddl}</code></pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(section === 'references' || section === 'overview') && info.referencedBy?.length > 0 && (
        <section className="object-section">
          <h3>References</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>DDL</th>
                  <th>Name</th>
                  <th>Table</th>
                  <th>Columns</th>
                  <th>Referenced Columns</th>
                  <th>On Update</th>
                  <th>On Delete</th>
                  <th>Deferrable</th>
                </tr>
              </thead>
              <tbody>
                {info.referencedBy.map((reference) => {
                  const referenceID = `${reference.schema}.${reference.table}.${reference.name}`;
                  const expanded = Boolean(expandedReferenceDDL[referenceID]);
                  const ddl = reference.definition ? referenceDDL(reference) : '';
                  return (
                    <Fragment key={referenceID}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="icon-button table-icon-button"
                            onClick={() => toggleReferenceDDL(referenceID)}
                            disabled={!ddl}
                            aria-label={`${expanded ? 'Hide' : 'Show'} DDL for ${reference.name}`}
                            title={`${expanded ? 'Hide' : 'Show'} DDL`}
                          >
                            {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                          </button>
                        </td>
                        <td>{reference.name}</td>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => openTable(reference.schema, reference.table)}
                          >
                            {`${reference.schema}.${reference.table}`}
                          </button>
                        </td>
                        <td>{reference.columns?.join(', ')}</td>
                        <td>{reference.referencedColumns?.join(', ')}</td>
                        <td>{reference.updateAction}</td>
                        <td>{reference.deleteAction}</td>
                        <td>{reference.deferrable ? (reference.initiallyDeferred ? 'Initially deferred' : 'Yes') : 'No'}</td>
                      </tr>
                      {expanded && ddl && (
                        <tr className="index-ddl-row">
                          <td colSpan={8}>
                            <div className="index-ddl">
                              <div className="index-ddl-toolbar">
                                <span>{reference.name} DDL</span>
                                <button type="button" className="icon-text-button" onClick={() => void copyReferenceDDL(referenceID, ddl)}>
                                  <Copy size={14} strokeWidth={1.8} />
                                  <span>{copiedReferenceDDL === referenceID ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                              <pre className="object-ddl index-ddl-code"><code>{ddl}</code></pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(section === 'values' || section === 'overview') && (info.type?.labels?.length > 0 || info.type?.check) && (
        <section className="object-section">
          <h3>Values</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{info.type?.labels?.length > 0 ? 'Value' : 'Constraint'}</th>
                </tr>
              </thead>
              <tbody>
                {info.type?.labels?.length > 0 ? (
                  info.type.labels.map((label, index) => (
                    <tr key={label}>
                      <td>{index + 1}</td>
                      <td>{label}</td>
                    </tr>
                  ))
                ) : (
                  info.type.check.split('\n').filter(Boolean).map((constraint, index) => (
                    <tr key={constraint}>
                      <td>{index + 1}</td>
                      <td>{constraint}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === 'usedBy' && info.type?.usages?.length > 0 && (
        <section className="object-section">
          <h3>Used By</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Kind</th>
                  <th>Column</th>
                  <th>Column Type</th>
                  <th>Nullable</th>
                  <th>Default</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {info.type.usages.map((usage) => (
                  <tr key={`${usage.schema}.${usage.object}.${usage.column}`}>
                    <td>
                      <button
                        type="button"
                        className="table-link"
                        onClick={() => onOpenObject({ kind: usage.kind as ObjectLinkTarget['kind'], schema: usage.schema, name: usage.object })}
                      >
                        {`${usage.schema}.${usage.object}`}
                      </button>
                    </td>
                    <td>{objectKindLabel(usage.kind)}</td>
                    <td>{usage.column}</td>
                    <td>{usage.dataType}</td>
                    <td>{usage.nullable ? 'Yes' : 'No'}</td>
                    <td>{usage.default}</td>
                    <td>{usage.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(section === 'functions' || section === 'overview') && info.functions?.length > 0 && (
        <section className="object-section">
          <h3>Functions</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>Arguments</th>
                  <th>Returns</th>
                  <th>Language</th>
                  <th>Volatility</th>
                  <th>Set</th>
                </tr>
              </thead>
              <tbody>
                {info.functions.map((fn) => (
                  <tr key={`${fn.name}(${fn.arguments})`}>
                    <td>{fn.arguments}</td>
                    <td>{fn.resultType}</td>
                    <td>{fn.language}</td>
                    <td>{fn.volatility}</td>
                    <td>{fn.returnsSet ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === 'overview' && info.ddl && (
        <section className="object-section object-ddl-section">
          <div className="object-section-header">
            <h3>DDL</h3>
            <button type="button" className="icon-text-button" onClick={() => void copyDDL()}>
              <Copy size={14} strokeWidth={1.8} />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="object-ddl"><code>{info.ddl}</code></pre>
        </section>
      )}

      {section === 'overview' && info.type?.usages?.length > 0 && (
        <section className="object-section">
          <h3>Used By</h3>
          <div className="table-wrap inline">
            <table>
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Kind</th>
                  <th>Column</th>
                  <th>Column Type</th>
                  <th>Nullable</th>
                  <th>Default</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {info.type.usages.map((usage) => (
                  <tr key={`${usage.schema}.${usage.object}.${usage.column}`}>
                    <td>
                      <button
                        type="button"
                        className="table-link"
                        onClick={() => onOpenObject({ kind: usage.kind as ObjectLinkTarget['kind'], schema: usage.schema, name: usage.object })}
                      >
                        {`${usage.schema}.${usage.object}`}
                      </button>
                    </td>
                    <td>{objectKindLabel(usage.kind)}</td>
                    <td>{usage.column}</td>
                    <td>{usage.dataType}</td>
                    <td>{usage.nullable ? 'Yes' : 'No'}</td>
                    <td>{usage.default}</td>
                    <td>{usage.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export function objectKindLabel(kind: string) {
  switch (kind) {
    case 'materialized_view':
      return 'Materialized View';
    case 'view':
      return 'View';
    case 'sequence':
      return 'Sequence';
    case 'function':
      return 'Function';
    case 'type':
      return 'Type';
    default:
      return 'Table';
  }
}
