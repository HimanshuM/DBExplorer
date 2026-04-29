import {
  Braces,
  Database,
  Eye,
  FileCode2,
  Folder,
  Hash,
  Layers,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Sigma,
  Table2,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { type ExplorerTreeNodeKind } from './types';

export function iconForExplorerKind(kind: ExplorerTreeNodeKind): LucideIcon {
  switch (kind) {
    case 'connection':
    case 'database':
      return Database;
    case 'schema':
      return Braces;
    case 'group':
      return Folder;
    case 'table':
      return Table2;
    case 'view':
      return Eye;
    case 'materialized_view':
      return Layers;
    case 'sequence':
      return Hash;
    case 'function':
      return Sigma;
    default:
      return FileCode2;
  }
}

export function iconForObjectTabKind(kind: string): LucideIcon {
  if (isExplorerKind(kind)) {
    return iconForExplorerKind(kind);
  }
  return FileCode2;
}

export const LayoutIcons = {
  left: PanelLeft,
  right: PanelRight,
  bottom: PanelBottom,
};

function isExplorerKind(kind: string): kind is ExplorerTreeNodeKind {
  return [
    'connection',
    'database',
    'schema',
    'group',
    'table',
    'view',
    'materialized_view',
    'sequence',
    'function',
  ].includes(kind);
}
