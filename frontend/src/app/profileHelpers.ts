import { domain } from '../../wailsjs/go/models';
import { type ProfileFormState } from '../types';

export function preferredDatabase(current: string, profileDatabase: string, databases: string[]) {
  if (current && (databases.length === 0 || databases.includes(current))) {
    return current;
  }
  if (profileDatabase && (databases.length === 0 || databases.includes(profileDatabase))) {
    return profileDatabase;
  }
  return databases[0] ?? profileDatabase ?? current;
}

export function profileToForm(profile: domain.ConnProfile): ProfileFormState {
  return {
    id: profile.id,
    name: profile.name,
    folder: profile.folder ?? '',
    host: profile.host,
    port: String(profile.port || ''),
    user: profile.user,
    password: profile.options?.password ?? '',
    database: profile.database,
    sslMode: profile.sslMode || 'disable',
  };
}
