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
      base: pr.base.ref,
      head: pr.head.ref,
      url: pr.html_url,
      status: pr.status as PrParams['status'],
      approved: pr.reviews.some((r) => r.state === 'APPROVED'),
      approvers: [...new Set(pr.reviews.filter((r) => r.state === 'APPROVED').map((r) => r.user.login))],
      mergeable: pr.mergeable,
      files: pr.files.map((f) => ({ status: f.status, name: f.filename })),
      repoFullName,
    })
  );
}

export function filterKeyword(prs: PrNode[], keyword?: string): PrNode[] {
  if (!keyword) return prs;
  return prs.filter((pr) => {
    const users = [...(pr.params.reviewers || []), pr.params.user || ''];
    return users.some((u) => u.includes(keyword));
  });
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
