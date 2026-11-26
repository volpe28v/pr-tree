import { PrParams, GitHubPr, GitHubReview, GitHubFile } from './types';

export interface PrNode {
  params: PrParams;
  children: PrNode[];
  parent: PrNode | null;
}

export function createPrNode(params: PrParams): PrNode {
  return { params, children: [], parent: null };
}

export function buildPrNodes(
  prs: (GitHubPr & { status: string; files: GitHubFile[]; reviews: GitHubReview[]; mergeable: boolean | null })[],
  repoFullName?: string
): PrNode[] {
  return prs.map((pr) =>
    createPrNode({
      number: pr.number,
      title: pr.title,
      user: pr.user.login,
      reviewers: pr.requested_reviewers.map((r) => r.login),
      assignees: (pr.assignees || []).map((a) => a.login),
      base: pr.base.ref,
      head: pr.head.ref,
      url: pr.html_url,
      status: pr.status as PrParams['status'],
      approved: pr.reviews.some((r) => r.state === 'APPROVED'),
      approvers: [...new Set(pr.reviews.filter((r) => r.state === 'APPROVED').map((r) => r.user.login))],
      changeRequesters: pr.changeRequesters,
      commenters: pr.commenters,
      mergeable: pr.mergeable,
      files: pr.files.map((f) => ({ status: f.status, name: f.filename })),
      repoFullName,
      updatedAt: pr.updated_at,
      draft: pr.draft,
      commentCount: pr.commentCount,
      lastCommenter: pr.lastCommenter,
      lastCommentedAt: pr.lastCommentedAt,
      changedFiles: pr.changedFiles,
      ciFailures: pr.ciFailures,
    })
  );
}

export function filterKeyword(prs: PrNode[], keyword?: string): PrNode[] {
  if (!keyword) return prs;
  return prs.filter((pr) => {
    const users = [
      ...(pr.params.reviewers || []),
      ...(pr.params.assignees || []),
      pr.params.user || '',
    ];
    return users.some((u) => u.includes(keyword));
  });
}

// 検索クエリを照合用に正規化する（前後の空白と先頭の # を除去し、小文字化）
export function normalizeSearchQuery(query?: string): string {
  return (query || '').trim().replace(/^#/, '').trim().toLowerCase();
}

// PR 番号・head ブランチ名・タイトルのいずれかにクエリが部分一致する PR に絞り込む（大文字小文字は無視）
export function filterSearchQuery(prs: PrNode[], query?: string): PrNode[] {
  const q = normalizeSearchQuery(query);
  if (!q) return prs;
  return prs.filter((pr) =>
    [pr.params.number != null ? String(pr.params.number) : '', pr.params.head || '', pr.params.title || ''].some(
      (s) => s.toLowerCase().includes(q)
    )
  );
}

export function filterReviewer(prs: PrNode[], reviewer?: string): PrNode[] {
  if (!reviewer) return prs;
  return prs.filter((pr) =>
    (pr.params.reviewers || []).some((u) => u.includes(reviewer))
  );
}

export function filterCiPass(prs: PrNode[], enabled: boolean): PrNode[] {
  if (!enabled) return prs;
  return prs.filter((pr) => pr.params.status !== 'failure');
}

export function filterNoApproved(prs: PrNode[], enabled: boolean): PrNode[] {
  if (!enabled) return prs;
  return prs.filter((pr) => !pr.params.approved);
}
