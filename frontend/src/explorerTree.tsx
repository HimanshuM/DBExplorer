import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { domain } from '../wailsjs/go/models';
import { iconForExplorerKind } from './objectIcons';
import { type ExplorerTreeNode, type ExplorerTreeNodeKind } from './types';

export function ExplorerTree({
  nodes,
  selectedProfileID,
  selectedNodeID,
  onNodeClick,
}: {
  nodes: ExplorerTreeNode[];
  selectedProfileID: string;
  selectedNodeID: string;
  onNodeClick: (node: ExplorerTreeNode) => void;
}) {
  return (
    <div className="explorer-tree">
      {nodes.map((node) => (
        <ExplorerTreeNodeView
          key={node.id}
          node={node}
          depth={0}
          selectedProfileID={selectedProfileID}
          selectedNodeID={selectedNodeID}
          onNodeClick={onNodeClick}
        />
      ))}
    </div>
  );
}

function ExplorerTreeNodeView({
  node,
  depth,
  selectedProfileID,
  selectedNodeID,
  onNodeClick,
}: {
  node: ExplorerTreeNode;
  depth: number;
  selectedProfileID: string;
  selectedNodeID: string;
  onNodeClick: (node: ExplorerTreeNode) => void;
}) {
  const canExpand = canExpandExplorerNode(node);
  const active = node.id === selectedNodeID || (node.kind === 'connection' && node.profileID === selectedProfileID);
  const Icon = iconForExplorerKind(node.kind);

  return (
    <div className="explorer-tree-item">
      <button
        type="button"
        className={active ? 'explorer-node active' : 'explorer-node'}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onNodeClick(node)}
      >
        <span className="explorer-toggle">
          {node.loading ? (
            <LoaderCircle size={14} strokeWidth={2} />
          ) : canExpand ? (
            node.expanded ? (
              <ChevronDown size={14} strokeWidth={2} />
            ) : (
              <ChevronRight size={14} strokeWidth={2} />
            )
          ) : null}
        </span>
        <span className={`explorer-icon ${node.kind}`}><Icon size={15} strokeWidth={1.8} /></span>
        <span className="explorer-label">
          <span>{node.label}</span>
        </span>
      </button>
      {node.error && <div className="explorer-error">{node.error}</div>}
      {node.expanded &&
        node.children.map((child) => (
          <ExplorerTreeNodeView
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedProfileID={selectedProfileID}
            selectedNodeID={selectedNodeID}
            onNodeClick={onNodeClick}
          />
        ))}
    </div>
  );
}

export function updateExplorerNodeList(
  nodes: ExplorerTreeNode[],
  nodeID: string,
  updater: (node: ExplorerTreeNode) => ExplorerTreeNode,
): ExplorerTreeNode[] {
  return nodes.map((node) => {
    if (node.id === nodeID) {
      return updater(node);
    }
    if (node.children.length === 0) {
      return node;
    }
    return { ...node, children: updateExplorerNodeList(node.children, nodeID, updater) };
  });
}

export function collapseExplorerNodes(nodes: ExplorerTreeNode[]): ExplorerTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    expanded: false,
    children: node.children.length > 0 ? collapseExplorerNodes(node.children) : node.children,
  }));
}

export function groupExplorerObjects(
  parent: ExplorerTreeNode,
  objects: domain.ExplorerObject[],
): ExplorerTreeNode[] {
  const groupLabels: Record<string, string> = {
    table: 'Tables',
    view: 'Views',
    materialized_view: 'Materialized Views',
    sequence: 'Sequences',
    function: 'Functions',
  };
  const order = ['table', 'view', 'materialized_view', 'sequence', 'function'];

  return order.flatMap((kind) => {
    const groupedObjects = objects.filter((object) => object.kind === kind);
    if (groupedObjects.length === 0) {
      return [];
    }

    const children = groupedObjects.map((object) => ({
      id: explorerNodeID(
        'object',
        parent.profileID,
        parent.database ?? '',
        object.schema,
        object.kind,
        object.name,
      ),
      label: object.name,
      kind: object.kind as ExplorerTreeNodeKind,
      profileID: parent.profileID,
      database: parent.database,
      schema: object.schema,
      objectName: object.name,
      expanded: false,
      loaded: true,
      loading: false,
      children: [],
    }));

    return [
      {
        id: explorerNodeID('group', parent.profileID, parent.database ?? '', parent.schema ?? '', kind),
        label: groupLabels[kind],
        kind: 'group' as const,
        profileID: parent.profileID,
        database: parent.database,
        schema: parent.schema,
        expanded: true,
        loaded: true,
        loading: false,
        children,
      },
    ];
  });
}

export function isDataExplorerObject(node: ExplorerTreeNode) {
  return ['table', 'view', 'materialized_view', 'sequence'].includes(node.kind);
}

export function isInspectableExplorerObject(node: ExplorerTreeNode) {
  return ['table', 'view', 'materialized_view', 'sequence', 'function'].includes(node.kind);
}

export function explorerNodeID(...parts: string[]) {
  return parts.map((part) => encodeURIComponent(part)).join(':');
}

export function objectInfoTabID(node: ExplorerTreeNode) {
  return explorerNodeID(
    'object-tab',
    node.profileID,
    node.database ?? '',
    node.schema ?? '',
    node.kind,
    node.objectName ?? node.label,
  );
}

function canExpandExplorerNode(node: ExplorerTreeNode) {
  return ['connection', 'database', 'schema', 'group'].includes(node.kind);
}
