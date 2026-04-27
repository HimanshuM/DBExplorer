import {
  isDataExplorerObject,
} from './explorerTree';
import { ResultTable, resultLabel } from './resultTable';
import {
  type ObjectInfoSection,
  type ObjectInfoState,
  type ObjectInfoTab,
} from './types';

export function ObjectInfoWorkspace({
  tab,
  onSectionChange,
  onRefreshData,
}: {
  tab: ObjectInfoTab;
  onSectionChange: (section: ObjectInfoSection) => void;
  onRefreshData: () => void;
}) {
  const info = tab.state.info;
  const sections: { id: ObjectInfoSection; label: string; enabled: boolean }[] = [
    { id: 'overview', label: 'Overview', enabled: true },
    { id: 'columns', label: 'Columns', enabled: Boolean(info?.columns?.length) },
    { id: 'indexes', label: 'Indexes', enabled: Boolean(info?.indexes?.length) },
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
      <ObjectInfoContent tab={tab} section={visibleSection} onRefreshData={onRefreshData} />
    </div>
  );
}

function ObjectInfoContent({
  tab,
  section,
  onRefreshData,
}: {
  tab: ObjectInfoTab;
  section: ObjectInfoSection;
  onRefreshData: () => void;
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
          <span>{tab.data.rows ? resultLabel(tab.data.rows) : 'Data preview'}</span>
          <button type="button" onClick={onRefreshData} disabled={tab.dataRunning}>
            {tab.dataRunning ? 'Loading' : 'Refresh'}
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

  return <ObjectInfoPanel state={tab.state} section={section} />;
}

function ObjectInfoPanel({
  state,
  section = 'overview',
}: {
  state: ObjectInfoState;
  section?: ObjectInfoSection;
}) {
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
  return (
    <div className="object-info">
      <section className="object-summary">
        {info.details?.map((detail) => (
          <div key={detail.name} className="object-summary-item">
            <span>{detail.name}</span>
            <strong>{detail.value}</strong>
          </div>
        ))}
      </section>

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
                </tr>
              </thead>
              <tbody>
                {info.columns.map((column) => (
                  <tr key={column.name}>
                    <td>{column.position}</td>
                    <td>{column.name}</td>
                    <td>{column.dataType}</td>
                    <td>{column.nullable ? 'Yes' : 'No'}</td>
                    <td>{column.primaryKey ? 'PK' : ''}</td>
                    <td>{column.default}</td>
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
                  <th>Name</th>
                  <th>Columns</th>
                  <th>Primary</th>
                  <th>Unique</th>
                  <th>Partial</th>
                  <th>Valid</th>
                </tr>
              </thead>
              <tbody>
                {info.indexes.map((index) => (
                  <tr key={index.name}>
                    <td>{index.name}</td>
                    <td>{index.columns?.join(', ')}</td>
                    <td>{index.primary ? 'Yes' : 'No'}</td>
                    <td>{index.unique ? 'Yes' : 'No'}</td>
                    <td>{index.partial ? 'Yes' : 'No'}</td>
                    <td>{index.valid ? 'Yes' : 'No'}</td>
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
    default:
      return 'Table';
  }
}
