import { useMemo } from 'react';
import { domain } from '../wailsjs/go/models';
import { Select } from './components/Select';

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
      <span>Connection</span>
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
