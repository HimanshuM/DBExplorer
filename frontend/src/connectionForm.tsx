import { domain } from '../wailsjs/go/models';
import { type ProfileFormState } from './types';

export const defaultProfileForm: ProfileFormState = {
  id: 'local_pg',
  name: 'Local Postgres',
  host: 'localhost',
  port: '5432',
  user: 'postgres',
  password: '',
  database: 'postgres',
  sslMode: 'disable',
};

export function ConnectionForm({
  form,
  saving,
  testing,
  onChange,
  onSave,
  onTest,
}: {
  form: ProfileFormState;
  saving: boolean;
  testing: boolean;
  onChange: <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const busy = saving || testing;

  return (
    <form className="connection-form" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span>Name</span>
        <input
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>ID</span>
        <input
          value={form.id}
          onChange={(event) => onChange('id', event.target.value)}
          disabled={busy}
        />
      </label>
      <div className="form-row">
        <label>
          <span>Host</span>
          <input
            value={form.host}
            onChange={(event) => onChange('host', event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          <span>Port</span>
          <input
            inputMode="numeric"
            value={form.port}
            onChange={(event) => onChange('port', event.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <label>
        <span>User</span>
        <input
          value={form.user}
          onChange={(event) => onChange('user', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          value={form.password}
          onChange={(event) => onChange('password', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>Database</span>
        <input
          value={form.database}
          onChange={(event) => onChange('database', event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        <span>SSL Mode</span>
        <select
          value={form.sslMode}
          onChange={(event) => onChange('sslMode', event.target.value)}
          disabled={busy}
        >
          <option value="disable">disable</option>
          <option value="prefer">prefer</option>
          <option value="require">require</option>
          <option value="verify-ca">verify-ca</option>
          <option value="verify-full">verify-full</option>
        </select>
      </label>
      <div className="form-actions">
        <button type="button" onClick={onTest} disabled={busy}>
          {testing ? 'Testing' : 'Test'}
        </button>
        <button type="button" onClick={onSave} disabled={busy}>
          {saving && !testing ? 'Saving' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export function buildProfile(form: ProfileFormState) {
  const id = form.id.trim();
  const port = Number.parseInt(form.port, 10);

  if (!id) {
    throw new Error('Connection ID is required.');
  }
  if (!form.name.trim()) {
    throw new Error('Connection name is required.');
  }
  if (!form.host.trim()) {
    throw new Error('Host is required.');
  }
  if (!form.user.trim()) {
    throw new Error('User is required.');
  }
  if (!form.database.trim()) {
    throw new Error('Database is required.');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Port must be a valid TCP port.');
  }

  return domain.ConnProfile.createFrom({
    id,
    name: form.name.trim(),
    kind: 'postgres',
    host: form.host.trim(),
    port,
    user: form.user.trim(),
    database: form.database.trim(),
    sslMode: form.sslMode,
    options: form.password ? { password: form.password } : {},
  });
}
