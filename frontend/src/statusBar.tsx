import { terminalStatuses } from './queryTabs';
import {
  type EditorTab,
  type ExplorerTreeNode,
  type JobStatusItem,
  type ObjectInfoTab,
} from './types';

export function StatusBar({
  jobs,
  open,
  onToggle,
}: {
  jobs: JobStatusItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const label =
    jobs.length === 0
      ? 'Idle'
      : jobs.length === 1
        ? `${jobs[0].label}: ${jobs[0].status}`
        : `${jobs.length} queries running`;

  return (
    <footer className="status-bar">
      <button
        type="button"
        className="status-bar-button"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={jobs.length > 0 ? 'status-indicator active' : 'status-indicator'} />
        <span>{label}</span>
      </button>
      <div className={open ? 'status-popover open' : 'status-popover'} role="status">
        {jobs.length === 0 ? (
          <div className="status-popover-empty">No queries running</div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="status-popover-row">
              <span className={`status-pill ${job.status}`}>{job.status}</span>
              <span className="status-popover-label">{job.label}</span>
              <span className="status-popover-meta">{job.database || job.jobID}</span>
            </div>
          ))
        )}
      </div>
    </footer>
  );
}

export function collectRunningJobStatusItems(
  tabs: EditorTab[],
  objectTabs: ObjectInfoTab[],
): JobStatusItem[] {
  const queryJobs = tabs.flatMap((tab) => {
    const job = tab.job;
    if (!job || terminalStatuses.has(job.status)) {
      return [];
    }
    return [{
      id: `query:${job.jobId}`,
      label: tab.title,
      status: job.status,
      database: job.database,
      jobID: job.jobId,
    }];
  });

  const dataJobs = objectTabs.flatMap((tab) => {
    const job = tab.dataJob;
    if (!job || terminalStatuses.has(job.status)) {
      return [];
    }
    return [{
      id: `object:${job.jobId}`,
      label: `Data: ${qualifiedObjectLabel(tab.node)}`,
      status: job.status,
      database: job.database,
      jobID: job.jobId,
    }];
  });

  return [...queryJobs, ...dataJobs];
}

function qualifiedObjectLabel(node: ExplorerTreeNode) {
  return node.schema ? `${node.schema}.${node.objectName ?? node.label}` : node.objectName ?? node.label;
}
