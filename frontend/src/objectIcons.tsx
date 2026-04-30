import {
  Braces,
  Database,
  Eye,
  FileCode2,
  Folder,
  Hash,
  Layers,
  Plug,
  Sigma,
  Table2,
  Tags,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { type ReactElement, type SVGProps } from 'react';
import { type ExplorerTreeNodeKind } from './types';

export function iconForExplorerKind(kind: ExplorerTreeNodeKind): LucideIcon {
  switch (kind) {
    case 'connection':
      return Plug;
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
    case 'type':
      return Tags;
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

type LayoutPane = 'left' | 'right' | 'bottom';

export function LayoutPaneIcon({
  pane,
  open,
  size = 16,
  strokeWidth = 1.8,
  ...props
}: SVGProps<SVGSVGElement> & {
  pane: LayoutPane;
  open?: boolean;
  size?: number;
  strokeWidth?: number;
}) {
  const fills: Record<LayoutPane, ReactElement> = {
    left: <rect x="4" y="4" width="5" height="16" rx="1" />,
    right: <rect x="15" y="4" width="5" height="16" rx="1" />,
    bottom: <rect x="4" y="15" width="16" height="5" rx="1" />,
  };
  const dividers: Record<LayoutPane, ReactElement> = {
    left: <path d="M9 3v18" />,
    right: <path d="M15 3v18" />,
    bottom: <path d="M3 15h18" />,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {open && (
        <g className="layout-pane-icon-fill" fill="currentColor" stroke="none">
          {fills[pane]}
        </g>
      )}
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {dividers[pane]}
    </svg>
  );
}

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
    'type',
  ].includes(kind);
}
