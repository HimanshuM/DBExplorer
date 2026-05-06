export type DatabaseOptionsState = {
  databases: string[];
  loading: boolean;
  error: string;
};

export type ToastState = {
  id: number;
  message: string;
  kind: 'error';
} | null;

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
