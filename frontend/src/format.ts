import { domain } from '../wailsjs/go/models';

export function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function jobStatusError(job: domain.JobSummary) {
  return job.error?.message || `Job ${job.status}.`;
}

export function formatError(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'Unexpected error';
}

export function formatDuration(startedAt?: number, endedAt?: number) {
  if (!startedAt || !endedAt || endedAt < startedAt) {
    return '';
  }

  const durationMs = endedAt - startedAt;
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
