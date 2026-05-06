import { terminalStatuses } from './queryTabs';
import { domain } from '../wailsjs/go/models';
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
  const activeJobs = jobs.filter((job) => !terminalStatuses.has(job.status));
  const label =
    activeJobs.length > 0
      ? activeJobs.length === 1
        ? `${activeJobs[0].label}: ${activeJobs[0].status}`
        : `${activeJobs.length} queries running`
      : jobs.length > 0
        ? `${jobs[0].label}: ${jobs[0].status}`
        : 'No query activity';

  return (
    <footer className="status-bar">
      <button
        type="button"
        className="status-bar-button"
        onClick={onToggle}
        aria-expanded={open}
        // title="Query status"
      >
        <span className={activeJobs.length > 0 ? 'status-indicator active' : 'status-indicator'} />
        <span>{label}</span>
      </button>
      <div className={open ? 'status-popover open' : 'status-popover'} role="status">
        {jobs.length === 0 ? (
          <div className="status-popover-empty">No queries have run in this workspace.</div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className={job.active ? 'status-popover-row active' : 'status-popover-row'}>
              <div className="status-popover-row-main">
                <span className={`status-pill ${job.status}`}>{job.status}</span>
                <span className="status-popover-label">{job.label}</span>
                <span className="status-popover-meta">{job.database || 'No database'}</span>
              </div>
              <dl className="status-details">
                <div>
                  <dt>Job</dt>
                  <dd>{job.jobID}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{job.profileName || job.profileID || 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatJobTime(job.startedAt)}</dd>
                </div>
                <div>
                  <dt>Ended</dt>
                  <dd>{formatJobTime(job.endedAt)}</dd>
                </div>
                <div>
                  <dt>Results</dt>
                  <dd>{job.resultSetCount ?? 0}</dd>
                </div>
              </dl>
              {job.error && <div className="status-popover-error">{job.error}</div>}
            </div>
          ))
        )}
      </div>
    </footer>
  );
}

export function collectJobStatusItems(
  tabs: EditorTab[],
  objectTabs: ObjectInfoTab[],
  profiles: domain.ConnProfile[],
  activeWorkspaceTabID: string,
): JobStatusItem[] {
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name || profile.id]));
  const queryJobs = tabs.flatMap((tab) => {
    const job = tab.job;
    if (!job) {
      return [];
    }
    return [{
      id: `query:${job.jobId}`,
      label: tab.title,
      status: job.status,
      database: job.database,
      profileID: job.profileId || tab.profileID,
      profileName: profileNames.get(job.profileId || tab.profileID),
      jobID: job.jobId,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      error: job.error?.message,
      resultSetCount: job.resultSets?.length ?? 0,
      active: tab.id === activeWorkspaceTabID,
    }];
  });

  const dataJobs = objectTabs.flatMap((tab) => {
    const job = tab.dataJob;
    if (!job) {
      return [];
    }
    return [{
      id: `object:${job.jobId}`,
      label: `Data: ${qualifiedObjectLabel(tab.node)}`,
      status: job.status,
      database: job.database,
      profileID: job.profileId || tab.node.profileID,
      profileName: profileNames.get(job.profileId || tab.node.profileID),
      jobID: job.jobId,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      error: job.error?.message,
      resultSetCount: job.resultSets?.length ?? 0,
      active: tab.id === activeWorkspaceTabID,
    }];
  });

  return [...queryJobs, ...dataJobs];
}

function formatJobTime(value?: number) {
  if (!value) {
    return 'Not set';
  }

  const milliseconds = value < 1000000000000 ? value * 1000 : value;
  return new Date(milliseconds).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function qualifiedObjectLabel(node: ExplorerTreeNode) {
  return node.schema ? `${node.schema}.${node.objectName ?? node.label}` : node.objectName ?? node.label;
}
