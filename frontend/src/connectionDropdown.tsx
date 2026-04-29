import { useMemo } from 'react';
import { domain } from '../wailsjs/go/models';
import { Select } from './components/Select';
import { Database, Plug } from 'lucide-react';

type ConnectionDropdownProps = {
  profiles: domain.ConnProfile[];
  selectedProfileID: string;
  disabled: boolean;
  onChange: (profileID: string) => void;
};

export function ConnectionDropdown({
  profiles,
  selectedProfileID,
  disabled,
  onChange,
}: ConnectionDropdownProps) {
  const options = useMemo(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name || profile.id,
      })),
    [profiles],
  );

  return (
    <div className="profile-picker">
      <span className="profile-picker-icon connection"><Plug size={18} strokeWidth={2} /></span>
      <Select
        options={options}
        value={selectedProfileID}
        disabled={disabled}
        emptyLabel="No profiles"
        ariaLabel="Connection profiles"
        onChange={onChange}
      />
    </div>
  );
}

type DatabaseDropdownProps = {
  databases: string[];
  selectedDatabase: string;
  disabled: boolean;
  loading: boolean;
  error: string;
  onChange: (database: string) => void;
};

export function DatabaseDropdown({
  databases,
  selectedDatabase,
  disabled,
  loading,
  error,
  onChange,
}: DatabaseDropdownProps) {
  const options = useMemo(
    () =>
      databases.map((database) => ({
        value: database,
        label: database,
      })),
    [databases],
  );

  const emptyLabel = loading ? 'Loading DBs' : error ? 'DBs unavailable' : 'No databases';

  return (
    <div className="profile-picker database-picker" title={error || undefined}>
      <span className="profile-picker-icon database"><Database size={18} strokeWidth={2} /></span>
      <Select
        options={options}
        value={selectedDatabase}
        disabled={disabled}
        emptyLabel={emptyLabel}
        ariaLabel="Databases"
        className="database-menu"
        onChange={onChange}
      />
    </div>
  );
}
