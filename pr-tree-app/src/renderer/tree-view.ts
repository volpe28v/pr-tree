import { PrNode } from '../pr-builder';

export function renderTree(container: HTMLElement, roots: PrNode[]): void {
  container.innerHTML = '';
  renderNodes(container, roots, '');
}

function renderNodes(
  container: HTMLElement,
  items: PrNode[],
  prefix: string
): void {
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    renderItem(container, item, isLast, prefix);

    const nextPrefix = prefix + (isLast ? '      ' : ' │    ');
    renderNodes(container, item.children, nextPrefix);
  });
}

function renderItem(
  container: HTMLElement,
  item: PrNode,
  isLast: boolean,
  prefix: string
): void {
  const p = item.params;
  const connector = isLast ? ' └─' : ' ├─';
  const bodyPrefix = isLast ? '      ' : ' │    ';

  if (p.number == null) {
    // ブランチ名のみ（トップノード）
    const line = document.createElement('div');
    line.className = 'tree-node';
    line.innerHTML =
      `<span class="tree-prefix">${esc(prefix + connector)}</span>` +
      `<span class="branch-name-only">[${esc(p.head)}]</span>`;
    container.appendChild(line);
    addSpacer(container);
    return;
  }

  // PR情報（3行）
  const statusIcon = statusEmoji(p.status);
  const approveIcon = p.approved ? '✅' : '⬜';
  const conflictIcon = p.mergeable === false ? '💥' : '  ';
  const branchClass = p.currentBranch ? 'branch-name current' : 'branch-name';
  const reviewerText = formatReviewers(p.reviewers);

  // 1行目: ステータス + ブランチ
  const line1 = document.createElement('div');
  line1.className = 'tree-node pr-line';
  line1.innerHTML =
    `<span class="tree-prefix">${esc(prefix + connector)}</span>` +
    ` <span class="status-badge">${statusIcon}</span> ${approveIcon} ${conflictIcon}  ` +
    `<span class="${branchClass}">[${esc(p.head)}]</span>`;
  container.appendChild(line1);

  // 2行目: タイトル
  const line2 = document.createElement('div');
  line2.className = 'tree-node pr-line';
  line2.innerHTML =
    `<span class="tree-prefix">${esc(prefix + bodyPrefix)}</span>` +
    `           <span class="pr-title">${esc(p.title || '')} #${p.number}</span>`;
  container.appendChild(line2);

  // 3行目: ユーザー + URL
  const line3 = document.createElement('div');
  line3.className = 'tree-node pr-line';
  line3.innerHTML =
    `<span class="tree-prefix">${esc(prefix + bodyPrefix)}</span>` +
    `           <span class="pr-user">@${esc(p.user || '')}</span>` +
    (reviewerText ? `  <span class="pr-reviewer">${reviewerText}</span>` : '') +
    `  <a class="pr-url" href="${esc(p.url || '')}" data-url="${esc(p.url || '')}">${esc(p.url || '')}</a>`;
  container.appendChild(line3);

  addSpacer(container);
}

function addSpacer(container: HTMLElement): void {
  const spacer = document.createElement('div');
  spacer.style.height = '4px';
  container.appendChild(spacer);
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

function formatReviewers(reviewers?: string[]): string {
  if (!reviewers || reviewers.length === 0) return '';
  const first = reviewers[0];
  const rest = reviewers.length - 1;
  return rest > 0 ? `👀 ${esc(first)} +${rest}` : `👀 ${esc(first)}`;
}

function esc(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
