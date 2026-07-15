import { PrNode } from '../pr-builder';

const DEFAULT_BRANCHES = ['main', 'master', 'develop', 'development'];

// 手動で最小化した PR 番号を localStorage に記憶する（放置 PR を畳んで目立たせない）
const COLLAPSED_KEY = 'pr-tree-collapsed';

function getCollapsedSet(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch {
    return new Set();
  }
}

export function setCollapsed(num: number, collapsed: boolean): void {
  const set = getCollapsedSet();
  if (collapsed) set.add(num);
  else set.delete(num);
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
}

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
  // 工程順に並べ替え（開発中を上、マージ可能を下）。同工程内は既存の更新時刻降順を維持（安定ソート）
  myPrs.sort((a, b) => stageSortKey(a.params) - stageSortKey(b.params));
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

  // My PRs は詳細カード（案A）、Review Requested は 1 行表示
  if (myPrs.length > 0) {
    renderSection(container, '📝 My PRs', myPrs, trees, nonTrivialSet, username, onShowTree, selectedNumber);
  }
  if (reviewPrs.length > 0) {
    renderCompactSection(container, '👀 Review Requested', reviewPrs, trees, nonTrivialSet, username, onShowTree, selectedNumber);
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
  // 工程順に並べ替え（開発中を上、マージ可能を下）。同工程内は既存の更新時刻降順を維持（安定ソート）
  myPrs.sort((a, b) => stageSortKey(a.params) - stageSortKey(b.params));
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
    renderCompactSection(container, '📝 My PRs', myPrs, trees, nonTrivialSet, username, onShowTree, selectedNumber);
  }
  if (reviewPrs.length > 0) {
    renderCompactSection(container, '👀 Review Requested', reviewPrs, trees, nonTrivialSet, username, onShowTree, selectedNumber);
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
  username: string,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = title;
  container.appendChild(header);

  const groups = groupByRepo(prs);
  for (const [repo, repoPrs] of groups) {
    if (repoPrs.length === 0) continue;
    appendRepoSeparator(container, repo);
    for (const pr of repoPrs) {
      renderPrCard(container, pr, trees, nonTrivialSet, username, onShowTree, selectedNumber);
    }
  }

  addSpacer(container);
}

function renderPrCard(
  container: HTMLElement,
  item: PrNode,
  trees: PrNode[],
  nonTrivialSet: Set<number>,
  username: string,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const p = item.params;
  const stage = computeStage(p);
  const showTreeBadge = p.number != null && nonTrivialSet.has(p.number);
  // ホバー時はタイトルのみ表示（最終コメントはテーブルに出ているため）
  const titleTooltip = esc(p.title || '');

  const isSelected = selectedNumber != null && p.number === selectedNumber;
  const isMergeReady = isMergeReadyPr(p);
  const isCollapsed = p.number != null && getCollapsedSet().has(p.number);
  const card = document.createElement('div');
  card.className =
    'pr-card pr-detail-card ' + stage.cls +
    (isSelected ? ' pr-highlight' : '') + (isMergeReady ? ' merge-ready' : '') +
    (isCollapsed ? ' collapsed' : '');
  card.dataset.url = p.url || '';
  if (p.head) card.dataset.branch = p.head;
  // 右クリックメニューから最小化トグルできるよう PR 番号を保持
  if (p.number != null) card.dataset.prNumber = String(p.number);

  const treeBadgeHtml = showTreeBadge
    ? ` <span class="tree-badge" data-tree-pr="${p.number}" title="Show tree">🌳</span>`
    : '';

  // CI・コンフリクトはタイトル行に記号で押し込めて縦幅を節約（更新時刻は最終コメントと重複するため省く）
  const conflictIcon = p.mergeable === false ? ' <span class="pr-conflict-icon">💥</span>' : '';

  card.innerHTML =
    `<div class="pr-detail-head">` +
    `<span class="status-badge" title="CI: ${esc(p.status || 'unknown')}">${statusEmoji(p.status)}</span>` +
    `<span class="pr-number">#${p.number}</span> ` +
    `<span class="pr-title" data-tooltip="${titleTooltip}">${esc(p.title || '')}</span>` +
    conflictIcon +
    treeBadgeHtml +
    `</div>` +
    buildStepper(p) +
    buildDetailTable(p, username);

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
  if (p.head) wrapper.dataset.branch = p.head;

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
  username: string,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = title;
  container.appendChild(header);

  const groups = groupByRepo(prs);
  for (const [repo, repoPrs] of groups) {
    if (repoPrs.length === 0) continue;
    appendRepoSeparator(container, repo);
    for (const pr of repoPrs) {
      renderCompactRow(container, pr, trees, nonTrivialSet, username, onShowTree, selectedNumber);
    }
  }
}

function renderCompactRow(
  container: HTMLElement,
  item: PrNode,
  trees: PrNode[],
  nonTrivialSet: Set<number>,
  username: string,
  onShowTree?: (rootNode: PrNode, highlightNumber: number) => void,
  selectedNumber?: number | null
): void {
  const p = item.params;
  const statusIcon = statusEmoji(p.status);
  const approveText = formatApproversCompact(p.approved, p.approvers);
  const showTreeBadge = p.number != null && nonTrivialSet.has(p.number);
  const isSelected = selectedNumber != null && p.number === selectedNumber;

  const isMergeReady = isMergeReadyPr(p);
  const row = document.createElement('div');
  row.className = 'compact-row' + (isSelected ? ' pr-highlight' : '') + (isMergeReady ? ' merge-ready' : '');
  row.dataset.url = p.url || '';
  if (p.head) row.dataset.branch = p.head;

  const treeBadgeHtml = showTreeBadge
    ? `<span class="tree-badge" data-tree-pr="${p.number}" title="Show tree">🌳</span>`
    : '';

  const conflictIcon = p.mergeable === false ? '💥' : '';

  row.innerHTML =
    `<span class="status-badge">${statusIcon}</span>` +
    `<span class="compact-approve">${approveText}</span>` +
    (conflictIcon ? `<span class="compact-conflict">${conflictIcon}</span>` : '') +
    `<span class="compact-number">#${p.number}</span>` +
    `<span class="compact-title" data-tooltip="${buildTitleTooltip(p.title, p.lastCommenter, p.lastCommentedAt)}">${esc(p.title || '')}</span>` +
    `<span class="compact-user">@${esc(p.user || '')}</span>` +
    (p.draft ? '<span class="pr-draft-badge">DRAFT</span>' : '') +
    formatCommentBadgeCompact(p.commentCount, p.lastCommenter, username) +
    formatChangedFiles(p.changedFiles) +
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
  return `<span class="pr-approver">${keycapNumber(approvers.length)}</span>`;
}

// approve 人数をキーキャップ絵文字（1️⃣〜🔟）で表す。10 超はほぼ無いので 🔟 に丸める
function keycapNumber(n: number): string {
  if (n >= 1 && n <= 9) return `${n}️⃣`;
  return '🔟';
}

function groupByRepo(prs: PrNode[]): Map<string, PrNode[]> {
  const groups = new Map<string, PrNode[]>();
  for (const pr of prs) {
    const repo = pr.params.repoFullName || '';
    if (!groups.has(repo)) groups.set(repo, []);
    groups.get(repo)!.push(pr);
  }
  return groups;
}

function appendRepoSeparator(container: HTMLElement, repo: string): void {
  if (!repo) return;
  const sep = document.createElement('div');
  sep.className = 'repo-separator';
  sep.textContent = repo;
  container.appendChild(sep);
}

function isMergeReadyPr(p: PrNode['params']): boolean {
  return p.status === 'success' && p.approved === true && p.mergeable !== false;
}

interface Stage {
  key: string;
  icon: string;
  label: string;
  cls: string;
  ball?: 'self' | 'other';
}

// PR の生データから「今どの工程か」を 1 つ計算する（優先度順に判定）。
// My PRs 用なので p.user === 自分。ボールが self = 自分が対応する番。
function computeStage(p: PrNode['params']): Stage {
  const approved = p.approved === true;
  const conflict = p.mergeable === false;
  const ciFail = p.status === 'failure';
  const pending = (p.reviewers || []).length;
  const approvedCount = (p.approvers || []).length;
  // github-actions は CI 通知 bot なので工程判定では無視（これが最終コメントでも「修正中」にしない）
  const lastByOther =
    !!p.lastCommenter && p.lastCommenter !== p.user && !isNoiseCommenter(p.lastCommenter);

  if (p.draft) return { key: 'draft', icon: '🚧', label: '開発中', cls: 'stage-draft' };
  if (isMergeReadyPr(p)) return { key: 'merge', icon: '🟢', label: 'マージ可能', cls: 'stage-merge', ball: 'self' };
  if (conflict) return { key: 'conflict', icon: '💥', label: 'コンフリクト', cls: 'stage-alert', ball: 'self' };
  if (ciFail) return { key: 'ci-fail', icon: '🛑', label: 'CI失敗', cls: 'stage-alert', ball: 'self' };
  if (!approved && pending === 0 && approvedCount === 0) {
    return { key: 'no-review', icon: '⚪', label: 'レビュー未依頼', cls: 'stage-idle' };
  }
  if (lastByOther && !approved) {
    return { key: 'review-fix', icon: '🔴', label: 'レビュー修正中', cls: 'stage-fix', ball: 'self' };
  }
  return { key: 'review-wait', icon: '🟡', label: 'レビュー待ち', cls: 'stage-wait', ball: 'other' };
}

// 工程判定で無視する bot（CI 通知など。regista / devin 等の AI レビュー bot は対象外）
function isNoiseCommenter(login?: string): boolean {
  return !!login && login.startsWith('github-actions');
}

// 工程ごとの表示優先度（小さいほど上）。開発中を優先し、マージ可能は最下部。
const STAGE_PRIORITY: Record<string, number> = {
  draft: 0, // 開発中
  'review-fix': 1, // レビュー修正中（自分の番）
  conflict: 1,
  'ci-fail': 1,
  'no-review': 2, // レビュー未依頼
  'review-wait': 3, // レビュー待ち（相手の番）
  merge: 4, // マージ可能 → 下
};

function stageSortKey(p: PrNode['params']): number {
  return STAGE_PRIORITY[computeStage(p).key] ?? 2;
}

// 進捗ステッパー（開発 → CI → 依頼 → 承認 → マージ）。左から順に埋まっていく。
function buildStepper(p: PrNode['params']): string {
  const approvedCount = (p.approvers || []).length;
  const pending = (p.reviewers || []).length;
  const total = approvedCount + pending;
  const requested = total > 0;
  const mergeReady = isMergeReadyPr(p);

  const ciState =
    p.status === 'success' ? 'done' :
    p.status === 'failure' ? 'alert' :
    p.status === 'pending' ? 'current' : 'pending';
  const ciIcon = p.status === 'pending' ? '🔄' : undefined;

  const approveState = mergeReady ? 'done' : approvedCount > 0 ? 'current' : 'pending';
  const approveLabel = total > 0 ? `承認 ${approvedCount}/${total}` : '承認';

  const steps: { label: string; state: string; icon?: string }[] = [
    // Draft の間は開発ステップを未チェック（白四角）にする
    { label: '開発', state: p.draft ? 'pending' : 'done', icon: p.draft ? '⬜' : undefined },
    { label: 'CI', state: ciState, icon: ciIcon },
    { label: '依頼', state: requested ? 'done' : 'pending' },
    { label: approveLabel, state: approveState },
    { label: 'マージ', state: mergeReady ? 'current' : 'pending' },
  ];

  const segs = steps
    .map((s) => `<span class="step step-${s.state}">${s.icon || stepIcon(s.state)}${esc(s.label)}</span>`)
    .join('<span class="step-sep">─</span>');
  return `<div class="pr-stepper">${segs}</div>`;
}

function stepIcon(state: string): string {
  switch (state) {
    case 'done': return '✅';
    case 'alert': return '🛑';
    case 'current': return '🔵';
    default: return '⚪';
  }
}

// 詳細情報テーブル（案A）。工程判定の裏取りができるよう生データを併記する。
function buildDetailTable(p: PrNode['params'], username: string): string {
  const approvedCount = (p.approvers || []).length;
  const pending = (p.reviewers || []).length;
  const total = approvedCount + pending;

  // レビュアー数と最終 Approve 者を 1 行に統合
  let reviewerCell: string;
  if (total > 0) {
    reviewerCell = `${total}人 (承認${approvedCount} / 保留${pending})`;
    if (approvedCount > 0) {
      reviewerCell += ` · 最終 <span class="pr-approver">✅@${esc(p.approvers![approvedCount - 1])}</span>`;
    }
  } else {
    reviewerCell = 'なし';
  }

  let lastCommentCell = '—';
  if (p.lastCommenter) {
    const cls = commentBadgeClass(p.lastCommenter, username);
    const time = p.lastCommentedAt ? ` ${formatRelativeTime(p.lastCommentedAt)}` : '';
    lastCommentCell = `<span class="${cls}">@${esc(p.lastCommenter)}</span>${time}`;
  }

  // 変更ファイル数はブランチ行の右端に寄せる
  const filesRight = p.changedFiles ? `<span class="pr-changed-files">📁${p.changedFiles}</span>` : '';
  const branchCell = `<div class="cell-split"><span>[${esc(p.head)}]</span>${filesRight}</div>`;

  // CI・Conflict・更新はタイトル行に記号で表示するためテーブルからは省く
  const rows: [string, string][] = [
    ['ブランチ', branchCell],
    ['レビュアー', reviewerCell],
    ['最終コメント', lastCommentCell],
  ];

  const body = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  return `<table class="pr-detail-table">${body}</table>`;
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

function commentBadgeClass(lastCommenter?: string, username?: string): string {
  if (!lastCommenter || !username) return 'pr-comment-badge';
  return lastCommenter === username ? 'pr-comment-badge comment-mine' : 'pr-comment-badge comment-others';
}

function formatCommentBadgeCompact(count?: number, lastCommenter?: string, username?: string): string {
  if (!count || count === 0) return '';
  const cls = commentBadgeClass(lastCommenter, username);
  return `  <span class="${cls}">💬${count}</span>`;
}

function formatChangedFiles(changedFiles?: number): string {
  if (!changedFiles || changedFiles === 0) return '';
  return `  <span class="pr-changed-files">📁${changedFiles}</span>`;
}

function buildTitleTooltip(title?: string, lastCommenter?: string, lastCommentedAt?: string): string {
  let tooltip = esc(title || '');
  if (lastCommenter) {
    const time = lastCommentedAt ? ` (${formatRelativeTime(lastCommentedAt)})` : '';
    tooltip += `\nLast comment: @${esc(lastCommenter)}${time}`;
  }
  return tooltip;
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
