import { explorerNodeID } from '../explorerTree';
import { objectKindLabel } from '../objectInfo';
import { type ExplorerTreeNode, type ExplorerTreeNodeKind } from '../types';

export type ObjectQuickOpenItem = {
  id: string;
  profileID: string;
  profileName: string;
  database: string;
  schema: string;
  name: string;
  kind: Extract<ExplorerTreeNodeKind, 'table' | 'view' | 'materialized_view' | 'sequence' | 'function' | 'type'>;
};

export type ObjectQuickOpenSource = {
  profileID: string;
  profileName: string;
  database: string;
};

export function quickOpenObjectID(
  profileID: string,
  database: string,
  schema: string,
  kind: string,
  name: string,
) {
  return explorerNodeID('quick-open-object', profileID, database, schema, kind, name);
}

function objectQuickOpenText(item: ObjectQuickOpenItem) {
  return `${item.schema}.${item.name} ${objectKindLabel(item.kind)} ${item.profileName} ${item.database}`.toLowerCase();
}

export function filterObjectQuickOpenItems(items: ObjectQuickOpenItem[], query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const searchableText = objectQuickOpenText(item);
    return terms.every((term) => searchableText.includes(term));
  });
}

export function collectExplorerDatabaseSources(nodes: ExplorerTreeNode[]) {
  const sources: { profileID: string; database: string }[] = [];

  nodes.forEach((node) => {
    if (node.kind === 'database' && node.profileID && node.database && (node.expanded || node.loaded)) {
      sources.push({ profileID: node.profileID, database: node.database });
    }

    if (node.children.length > 0) {
      sources.push(...collectExplorerDatabaseSources(node.children));
    }
  });

  return sources;
}
