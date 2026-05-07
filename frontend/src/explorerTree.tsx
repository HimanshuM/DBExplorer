import { ChevronDown, ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { domain } from '../wailsjs/go/models';
import { iconForExplorerKind } from './objectIcons';
import { type ExplorerTreeNode, type ExplorerTreeNodeKind } from './types';

const CONNECTION_DRAG_MIME = 'application/x-dbx-connection-profile';

export function ExplorerTree({
  nodes,
  selectedProfileID,
  selectedNodeID,
  onNodeClick,
  onMoveConnectionToFolder,
  onMoveConnectionToRoot,
  renderNodeActions,
}: {
  nodes: ExplorerTreeNode[];
  selectedProfileID: string;
  selectedNodeID: string;
  onNodeClick: (node: ExplorerTreeNode) => void;
  onMoveConnectionToFolder?: (profileID: string, folder: string) => void;
  onMoveConnectionToRoot?: (profileID: string) => void;
  renderNodeActions?: (node: ExplorerTreeNode) => React.ReactNode;
}) {
  const [draggedProfileID, setDraggedProfileID] = useState('');
  const [dropTargetNodeID, setDropTargetNodeID] = useState('');
  const rootDropActive = Boolean(draggedProfileID && dropTargetNodeID === 'root');

  return (
    <div
      className={rootDropActive ? 'explorer-tree root-drop-active' : 'explorer-tree'}
      onDragOver={(event) => {
        if (!draggedProfileID) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTargetNodeID !== 'root') {
          setDropTargetNodeID('root');
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTargetNodeID('');
        }
      }}
      onDrop={(event) => {
        if (!draggedProfileID) {
          return;
        }
        event.preventDefault();
        const profileID = event.dataTransfer.getData(CONNECTION_DRAG_MIME) || draggedProfileID;
        setDropTargetNodeID('');
        if (profileID) {
          onMoveConnectionToRoot?.(profileID);
        }
      }}
    >
      {nodes.map((node) => (
        <ExplorerTreeNodeView
          key={node.id}
          node={node}
          depth={0}
          selectedProfileID={selectedProfileID}
          selectedNodeID={selectedNodeID}
          onNodeClick={onNodeClick}
          draggedProfileID={draggedProfileID}
          dropTargetNodeID={dropTargetNodeID}
          onDragConnectionStart={setDraggedProfileID}
          onDragConnectionEnd={() => {
            setDraggedProfileID('');
            setDropTargetNodeID('');
          }}
          onDropTargetChange={setDropTargetNodeID}
          onMoveConnectionToFolder={onMoveConnectionToFolder}
          renderNodeActions={renderNodeActions}
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
  draggedProfileID,
  dropTargetNodeID,
  onDragConnectionStart,
  onDragConnectionEnd,
  onDropTargetChange,
  onMoveConnectionToFolder,
  renderNodeActions,
}: {
  node: ExplorerTreeNode;
  depth: number;
  selectedProfileID: string;
  selectedNodeID: string;
  onNodeClick: (node: ExplorerTreeNode) => void;
  draggedProfileID: string;
  dropTargetNodeID: string;
  onDragConnectionStart: (profileID: string) => void;
  onDragConnectionEnd: () => void;
  onDropTargetChange: (nodeID: string) => void;
  onMoveConnectionToFolder?: (profileID: string, folder: string) => void;
  renderNodeActions?: (node: ExplorerTreeNode) => React.ReactNode;
}) {
  const canExpand = canExpandExplorerNode(node);
  const active = node.id === selectedNodeID || (node.kind === 'connection' && node.profileID === selectedProfileID);
  const connectionFailed = node.kind === 'connection' && Boolean(node.error);
  const Icon = connectionFailed ? CircleAlert : iconForExplorerKind(node.kind);
  const draggable = node.kind === 'connection';
  const dropTarget = Boolean(draggedProfileID && node.kind === 'folder');
  const dropActive = dropTarget && dropTargetNodeID === node.id;
  const rowClassName = [
    'explorer-node-row',
    active ? 'active' : '',
    draggable ? 'draggable' : '',
    dropTarget ? 'drop-target' : '',
    dropActive ? 'drop-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="explorer-tree-item">
      <div
        className={rowClassName}
        onDragOver={(event) => {
          if (!dropTarget) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          onDropTargetChange(node.id);
        }}
        onDragLeave={() => {
          if (dropTargetNodeID === node.id) {
            onDropTargetChange('');
          }
        }}
        onDrop={(event) => {
          if (!dropTarget) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const profileID = event.dataTransfer.getData(CONNECTION_DRAG_MIME) || draggedProfileID;
          onDropTargetChange('');
          if (profileID) {
            onMoveConnectionToFolder?.(profileID, node.label);
          }
        }}
      >
        <button
          type="button"
          className="explorer-node"
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={draggable}
          onDragStart={(event) => {
            if (!draggable) {
              return;
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(CONNECTION_DRAG_MIME, node.profileID);
            event.dataTransfer.setData('text/plain', node.label);
            onDragConnectionStart(node.profileID);
          }}
          onDragEnd={onDragConnectionEnd}
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
          <span className={`explorer-icon ${node.kind}${connectionFailed ? ' failing' : ''}`}>
            <Icon size={15} strokeWidth={1.8} />
          </span>
          <span className="explorer-label">
            <span>{node.label}</span>
          </span>
        </button>
        <span className="explorer-actions">{renderNodeActions?.(node)}</span>
      </div>
      {node.error && node.kind !== 'connection' && <div className="explorer-error">{node.error}</div>}
      {node.expanded &&
        node.children.map((child) => (
          <ExplorerTreeNodeView
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedProfileID={selectedProfileID}
            selectedNodeID={selectedNodeID}
            onNodeClick={onNodeClick}
            draggedProfileID={draggedProfileID}
            dropTargetNodeID={dropTargetNodeID}
            onDragConnectionStart={onDragConnectionStart}
            onDragConnectionEnd={onDragConnectionEnd}
            onDropTargetChange={onDropTargetChange}
            onMoveConnectionToFolder={onMoveConnectionToFolder}
            renderNodeActions={renderNodeActions}
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

export function findExplorerNode(nodes: ExplorerTreeNode[], nodeID: string): ExplorerTreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeID) {
      return node;
    }
    const child = findExplorerNode(node.children, nodeID);
    if (child) {
      return child;
    }
  }
  return null;
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
    type: 'Types',
  };
  const order = ['table', 'view', 'materialized_view', 'sequence', 'function', 'type'];

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
  return ['table', 'view', 'materialized_view', 'sequence', 'function', 'type'].includes(node.kind);
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
  return ['folder', 'connection', 'database', 'schema', 'group'].includes(node.kind);
}
