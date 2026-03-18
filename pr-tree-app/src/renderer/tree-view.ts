import { PrNode } from '../pr-builder';

const DEFAULT_BRANCHES = ['main', 'master', 'develop', 'development'];

export function renderTree(container: HTMLElement, roots: PrNode[]): void {
  container.innerHTML = '';
  renderNodes(container, roots, '');
}

export { findTreeRoot, extractRelatedSubtree };

export function renderGrouped(
  container: HTMLElement,
  trees: PrNode[],
  username: string,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null,
  hideApproved?: boolean
): void {
  container.innerHTML = '';

  const allPrs = flattenPrs(trees);
  const nonTrivialSet = buildNonTrivialTreeSet(trees);

  const myPrs = allPrs.filter((n) => n.params.user === username);
  let reviewPrs = allPrs.filter(
    (n) =>
      n.params.user !== username &&
      (n.params.reviewers || []).some((r) => r === username)
  );

  // Review Requested: ドラフトPRと承認済みPRを非表示
  reviewPrs = reviewPrs.filter((n) => !n.params.draft);
  if (hideApproved) {
    reviewPrs = reviewPrs.filter((n) => !n.params.approved);
  }

  if (myPrs.length > 0) {
    renderSection(container, '📝 My PRs', myPrs, trees, nonTrivialSet, onShowTree, selectedNumber);
  }
  if (reviewPrs.length > 0) {
    renderSection(container, '👀 Review Requested', reviewPrs, trees, nonTrivialSet, onShowTree, selectedNumber);
  }
  if (myPrs.length === 0 && reviewPrs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'loading';
    empty.textContent = 'No PRs found.';
    container.appendChild(empty);
  }
}

export function renderCompact(
  container: HTMLElement,
  trees: PrNode[],
  username: string,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null,
  hideApproved?: boolean
): void {
  container.innerHTML = '';

  const allPrs = flattenPrs(trees);
  const nonTrivialSet = buildNonTrivialTreeSet(trees);

  const myPrs = allPrs.filter((n) => n.params.user === username);
  let reviewPrs = allPrs.filter(
    (n) =>
      n.params.user !== username &&
      (n.params.reviewers || []).some((r) => r === username)
  );

  reviewPrs = reviewPrs.filter((n) => !n.params.draft);
  if (hideApproved) {
    reviewPrs = reviewPrs.filter((n) => !n.params.approved);
  }

  if (myPrs.length > 0) {
    renderCompactSection(container, '📝 My PRs', myPrs, trees, nonTrivialSet, onShowTree, selectedNumber);
  }
  if (reviewPrs.length > 0) {
    renderCompactSection(container, '👀 Review Requested', reviewPrs, trees, nonTrivialSet, onShowTree, selectedNumber);
  }
  if (myPrs.length === 0 && reviewPrs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'loading';
    empty.textContent = 'No PRs found.';
    container.appendChild(empty);
  }
}

export function renderSubTree(container: HTMLElement, root: PrNode, highlightNumber?: number): void {
  container.innerHTML = '';

  // ルートノード（仮想ブランチ名）はヘッダーとして表示
  if (root.params.number == null) {
    const header = document.createElement('div');
    header.className = 'tree-node';
    header.innerHTML = `<span class="branch-name-only">[${esc(root.params.head)}]</span>`;
    container.appendChild(header);
    renderNodes(container, root.children, '', highlightNumber);
  } else {
    renderNodes(container, [root], '', highlightNumber);
  }
}

let flattenCache: { trees: PrNode[]; result: PrNode[] } | null = null;

function flattenPrs(trees: PrNode[]): PrNode[] {
  if (flattenCache && flattenCache.trees === trees) {
    return flattenCache.result;
  }
  const result: PrNode[] = [];
  collectPrs(trees, result);
  // updatedAt 降順（新しい順）
  result.sort((a, b) => {
    const ta = a.params.updatedAt || '';
    const tb = b.params.updatedAt || '';
    return tb.localeCompare(ta);
  });
  flattenCache = { trees, result };
  return result;
}

function collectPrs(nodes: PrNode[], result: PrNode[]): void {
  for (const node of nodes) {
    if (node.params.number != null) {
      result.push(node);
    }
    collectPrs(node.children, result);
  }
}

function findTreeRoot(trees: PrNode[], prNode: PrNode): PrNode | null {
  for (const root of trees) {
    if (containsNode(root, prNode)) return root;
  }
  return null;
}

function containsNode(tree: PrNode, target: PrNode): boolean {
  if (tree === target) return true;
  return tree.children.some((child) => containsNode(child, target));
}

function buildNonTrivialTreeSet(trees: PrNode[]): Set<number> {
  const result = new Set<number>();
  for (const root of trees) {
    collectNonTrivial(root, root, result);
  }
  return result;
}

function collectNonTrivial(node: PrNode, root: PrNode, result: Set<number>): void {
  if (node.params.number != null) {
    // 子 PR がある
    if (node.children.length > 0) {
      result.add(node.params.number);
    }
    // 親が実 PR（仮想ルートノードでなく）= スタックされた PR
    const parent = findDirectParent(root, node);
    if (parent && parent.params.number != null) {
      result.add(node.params.number);
    }
  }
  for (const child of node.children) {
    collectNonTrivial(child, root, result);
  }
}

function extractRelatedSubtree(root: PrNode, target: PrNode): PrNode | null {
  // root → target への祖先パスを取得
  const path = findAncestorPath(root, target);
  if (!path) return null;

  // パスに沿って、各ノードのクローンを作り、パス上の子だけ残す
  // ただし target ノードは全子孫をそのまま含む
  let clonedChild: PrNode | null = null;

  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    const clone: PrNode = {
      params: node.params,
      children: [],
      parent: null,
    };

    if (node === target) {
      // target 自体は全子孫を含める
      clone.children = node.children;
    } else if (clonedChild) {
      // 祖先ノードはパス上の子のみ
      clone.children = [clonedChild];
    }

    clonedChild = clone;
  }

  return clonedChild;
}

function findAncestorPath(root: PrNode, target: PrNode): PrNode[] | null {
  if (root === target) return [root];
  for (const child of root.children) {
    const path = findAncestorPath(child, target);
    if (path) return [root, ...path];
  }
  return null;
}

function findDirectParent(tree: PrNode, target: PrNode): PrNode | null {
  for (const child of tree.children) {
    if (child === target) return tree;
    const found = findDirectParent(child, target);
    if (found) return found;
  }
  return null;
}

function renderSection(
  container: HTMLElement,
  title: string,
  prs: PrNode[],
  trees: PrNode[],
  nonTrivialSet: Set<number>,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = title;
  container.appendChild(header);

  for (const pr of prs) {
    renderPrCard(container, pr, trees, nonTrivialSet, onShowTree, selectedNumber);
  }

  addSpacer(container);
}

function renderPrCard(
  container: HTMLElement,
  item: PrNode,
  trees: PrNode[],
  nonTrivialSet: Set<number>,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const p = item.params;
  const statusIcon = statusEmoji(p.status);
  const approveText = formatApprovers(p.approved, p.approvers);
  const conflictIcon = p.mergeable === false ? '💥' : '';
  const reviewerText = formatReviewers(p.reviewers);
  const showTreeBadge = p.number != null && nonTrivialSet.has(p.number);

  const isSelected = selectedNumber != null && p.number === selectedNumber;
  const card = document.createElement('div');
  card.className = 'pr-card' + (isSelected ? ' pr-highlight' : '');
  card.dataset.url = p.url || '';

  const treeBadgeHtml = showTreeBadge
    ? ` <span class="tree-badge" data-tree-pr="${p.number}" title="Show tree">🌳</span>`
    : '';

  card.innerHTML =
    `<div class="pr-card-line1">` +
    `<span class="status-badge">${statusIcon}</span> ${approveText}${conflictIcon ? ' ' + conflictIcon : ''} ` +
    `<span class="pr-number">#${p.number}</span> <span class="pr-title" data-tooltip="${esc(p.title || '')}">${esc(p.title || '')}</span>` +
    treeBadgeHtml +
    `</div>` +
    `<div class="pr-card-line2">` +
    (p.repoFullName ? `<span class="pr-repo">${esc(p.repoFullName)}</span> ` : '') +
    `<span class="branch-name">[${esc(p.head)}]</span>` +
    ` ← <span class="branch-name-only">[${esc(p.base || '')}]</span>` +
    `</div>` +
    `<div class="pr-card-line3">` +
    `<span class="pr-user">@${esc(p.user || '')}</span>` +
    (p.draft ? ' <span class="pr-draft-badge">DRAFT</span>' : '') +
    (reviewerText ? `  <span class="pr-reviewer">${reviewerText}</span>` : '') +
    (p.updatedAt ? `  <span class="pr-updated">${formatRelativeTime(p.updatedAt)}</span>` : '') +
    `</div>`;

  if (showTreeBadge && onShowTree) {
    card.querySelector('.tree-badge')?.addEventListener('click', (e) => {
      e.stopPropagation();
      // 既存のハイライトを解除
      container.querySelectorAll('.pr-card.pr-highlight').forEach((el) => {
        el.classList.remove('pr-highlight');
      });
      card.classList.add('pr-highlight');

      const root = findTreeRoot(trees, item);
      if (root) {
        const subtree = extractRelatedSubtree(root, item);
        if (subtree) onShowTree(subtree, p.number!);
      }
    });
  }

  container.appendChild(card);
}

function renderNodes(
  container: HTMLElement,
  items: PrNode[],
  prefix: string,
  highlightNumber?: number
): void {
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    renderItem(container, item, isLast, prefix, highlightNumber);

    const nextPrefix = prefix + (isLast ? '      ' : ' │    ');
    renderNodes(container, item.children, nextPrefix, highlightNumber);
  });
}

function renderItem(
  container: HTMLElement,
  item: PrNode,
  isLast: boolean,
  prefix: string,
  highlightNumber?: number
): void {
  const p = item.params;
  const connector = isLast ? ' └─' : ' ├─';
  const bodyPrefix = isLast ? '      ' : ' │    ';

  if (p.number == null) {
    const line = document.createElement('div');
    line.className = 'tree-node';
    line.innerHTML =
      `<span class="tree-prefix">${esc(prefix + connector)}</span>` +
      `<span class="branch-name-only">[${esc(p.head)}]</span>`;
    container.appendChild(line);
    addSpacer(container);
    return;
  }

  const statusIcon = statusEmoji(p.status);
  const approveText = formatApprovers(p.approved, p.approvers);
  const conflictIcon = p.mergeable === false ? '💥' : '  ';
  const branchClass = p.currentBranch ? 'branch-name current' : 'branch-name';
  const reviewerText = formatReviewers(p.reviewers);

  const isHighlighted = highlightNumber != null && p.number === highlightNumber;
  const wrapper = document.createElement('div');
  wrapper.className = 'pr-line' + (isHighlighted ? ' pr-highlight' : '');
  wrapper.dataset.url = p.url || '';

  wrapper.innerHTML =
    `<div class="tree-node">` +
    `<span class="tree-prefix">${esc(prefix + connector)}</span>` +
    ` <span class="status-badge">${statusIcon}</span> ${approveText} ${conflictIcon}  ` +
    `<span class="${branchClass}">[${esc(p.head)}]</span>` +
    `</div>` +
    `<div class="tree-node">` +
    `<span class="tree-prefix">${esc(prefix + bodyPrefix)}</span>` +
    `           <span class="pr-title" data-tooltip="${esc(p.title || '')}">${esc(p.title || '')} #${p.number}</span>` +
    `</div>` +
    `<div class="tree-node">` +
    `<span class="tree-prefix">${esc(prefix + bodyPrefix)}</span>` +
    `           <span class="pr-user">@${esc(p.user || '')}</span>` +
    (p.draft ? ' <span class="pr-draft-badge">DRAFT</span>' : '') +
    (reviewerText ? `  <span class="pr-reviewer">${reviewerText}</span>` : '') +
    (p.updatedAt ? `  <span class="pr-updated">${formatRelativeTime(p.updatedAt)}</span>` : '') +
    `</div>`;
  container.appendChild(wrapper);

  addSpacer(container);
}

function addSpacer(container: HTMLElement): void {
  const spacer = document.createElement('div');
  spacer.style.height = '4px';
  container.appendChild(spacer);
}

function renderCompactSection(
  container: HTMLElement,
  title: string,
  prs: PrNode[],
  trees: PrNode[],
  nonTrivialSet: Set<number>,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = title;
  container.appendChild(header);

  for (const pr of prs) {
    renderCompactRow(container, pr, trees, nonTrivialSet, onShowTree, selectedNumber);
  }
}

function renderCompactRow(
  container: HTMLElement,
  item: PrNode,
  trees: PrNode[],
  nonTrivialSet: Set<number>,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const p = item.params;
  const statusIcon = statusEmoji(p.status);
  const approveText = formatApproversCompact(p.approved, p.approvers);
  const showTreeBadge = p.number != null && nonTrivialSet.has(p.number);
  const isSelected = selectedNumber != null && p.number === selectedNumber;

  const row = document.createElement('div');
  row.className = 'compact-row' + (isSelected ? ' pr-highlight' : '');
  row.dataset.url = p.url || '';

  const treeBadgeHtml = showTreeBadge
    ? `<span class="tree-badge" data-tree-pr="${p.number}" title="Show tree">🌳</span>`
    : '';

  const conflictIcon = p.mergeable === false ? '💥' : '';

  row.innerHTML =
    `<span class="status-badge">${statusIcon}</span>` +
    `<span class="compact-approve">${approveText}</span>` +
    (conflictIcon ? `<span class="compact-conflict">${conflictIcon}</span>` : '') +
    `<span class="compact-number">#${p.number}</span>` +
    `<span class="compact-title" data-tooltip="${esc(p.title || '')}">${esc(p.title || '')}</span>` +
    `<span class="compact-user">@${esc(p.user || '')}</span>` +
    (p.draft ? '<span class="pr-draft-badge">DRAFT</span>' : '') +
    (p.updatedAt ? `<span class="compact-time">${formatRelativeTime(p.updatedAt)}</span>` : '') +
    treeBadgeHtml;

  if (showTreeBadge && onShowTree) {
    row.querySelector('.tree-badge')?.addEventListener('click', (e) => {
      e.stopPropagation();
      container.querySelectorAll('.compact-row.pr-highlight').forEach((el) => {
        el.classList.remove('pr-highlight');
      });
      row.classList.add('pr-highlight');

      const root = findTreeRoot(trees, item);
      if (root) {
        const subtree = extractRelatedSubtree(root, item);
        if (subtree) onShowTree(subtree, p.number!);
      }
    });
  }

  container.appendChild(row);
}

function formatApproversCompact(approved?: boolean, approvers?: string[]): string {
  if (!approved || !approvers || approvers.length === 0) return '⬜';
  const count = approvers.length;
  return `<span class="pr-approver">✅${count > 1 ? count : ''}</span>`;
}

function statusEmoji(status?: string): string {
  switch (status) {
    case 'success':
      return '🟢';
    case 'failure':
      return '🔴';
    case 'pending':
      return '🟡';
    default:
      return '⚪';
  }
}

function formatApprovers(approved?: boolean, approvers?: string[]): string {
  if (!approved || !approvers || approvers.length === 0) return '⬜';
  const first = esc(approvers[0]);
  const rest = approvers.length - 1;
  const names = rest > 0 ? `${first} +${rest}` : first;
  return `<span class="pr-approver">✅ ${names}</span>`;
}

function formatReviewers(reviewers?: string[]): string {
  if (!reviewers || reviewers.length === 0) return '';
  const first = reviewers[0];
  const rest = reviewers.length - 1;
  return rest > 0 ? `👀 ${esc(first)} +${rest}` : `👀 ${esc(first)}`;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
