import { PrNode, createPrNode } from './pr-builder';

export function buildTree(items: PrNode[]): PrNode[] {
  // 親子関係を構築
  for (const item of items) {
    const parent = items.find(
      (p) =>
        p.params.head === item.params.base &&
        !hasKeyInParentBases(p, item.params.head!)
    );
    if (parent) {
      parent.children.push(item);
      item.parent = parent;
    }
  }

  // トップレベル（親がないもの）をグループ化
  const topItems = items.filter((item) => item.parent === null);
  const groups = new Map<string, PrNode[]>();

  for (const item of topItems) {
    const key = item.params.base || 'unknown';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }

  // 各グループにトップノードを作成
  const result: PrNode[] = [];
  for (const [key, children] of groups) {
    const topNode = createPrNode({ head: key });
    topNode.children = children;
    result.push(topNode);
  }

  return result;
}

function hasKeyInParentBases(node: PrNode, key: string): boolean {
  if (!node.parent) return false;
  if (node.params.base === key) return true;
  return hasKeyInParentBases(node.parent, key);
}
