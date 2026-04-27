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
