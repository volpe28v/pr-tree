import { GitHubPr, GitHubReview, GitHubFile, GitHubCheckRun } from './types';

export class GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;
  private etags: Map<string, { etag: string; data: unknown }> = new Map();

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  async checkConnection(): Promise<boolean> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
    const headers: Record<string, string> = {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
    };
    try {
      const res = await fetch(url, { headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  async pullRequests(): Promise<GitHubPr[]> {
    const prs = await this.getRequest<GitHubPr[]>(this.url('/pulls'));
    if (!prs) return [];

    const enriched = await Promise.all(
      prs.map(async (pr) => {
        const [status, files, reviews, detail] = await Promise.all([
          this.combinedStatus(pr.head.sha),
          this.getRequest<GitHubFile[]>(this.url(`/pulls/${pr.number}/files`)),
          this.getRequest<GitHubReview[]>(this.url(`/pulls/${pr.number}/reviews`)),
          this.getRequest<GitHubPr>(this.url(`/pulls/${pr.number}`)),
        ]);

        return {
          ...pr,
          status,
          files: files || [],
          reviews: reviews || [],
          mergeable: detail?.mergeable ?? null,
        };
      })
    );

    return enriched;
  }

  private async combinedStatus(sha: string): Promise<string> {
    const statusResponse = await this.getRequest<{
      state: string;
      total_count: number;
    }>(this.url(`/commits/${sha}/status`));

    const statusState = statusResponse?.state || 'success';
    const hasStatuses = (statusResponse?.total_count || 0) > 0;

    const checkRunsResponse = await this.getRequest<{
      check_runs: GitHubCheckRun[];
    }>(this.url(`/commits/${sha}/check-runs`));

    const checkRuns = checkRunsResponse?.check_runs || [];

    // 同名check runは最新の結果のみ使う
    const seen = new Set<string>();
    const latestRuns = checkRuns
      .sort((a, b) =>
        (b.completed_at || '').localeCompare(a.completed_at || '')
      )
      .filter((cr) => {
        if (seen.has(cr.name)) return false;
        seen.add(cr.name);
        return true;
      });

    const hasCheckFailure = latestRuns.some(
      (cr) => cr.conclusion === 'failure'
    );
    const hasCheckPending = latestRuns.some(
      (cr) => cr.status !== 'completed'
    );

    if ((hasStatuses && statusState === 'failure') || hasCheckFailure) {
      return 'failure';
    } else if ((hasStatuses && statusState === 'pending') || hasCheckPending) {
      return 'pending';
    } else {
      return 'success';
    }
  }

  private async getRequest<T>(url: string): Promise<T | null> {
    const headers: Record<string, string> = {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
    };

    const cached = this.etags.get(url);
    if (cached) {
      headers['If-None-Match'] = cached.etag;
    }

    try {
      const res = await fetch(url, { headers });

      if (res.status === 304 && cached) {
        return cached.data as T;
      }

      if (!res.ok) {
        console.error(`GitHub API error: ${res.status} ${res.statusText} for ${url}`);
        return null;
      }

      const etag = res.headers.get('etag');
      const data = await res.json();

      if (etag) {
        this.etags.set(url, { etag, data });
      }

      return data as T;
    } catch (err) {
      console.error(`Request failed: ${url}`, err);
      return null;
    }
  }

  private url(path: string): string {
    return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
  }
}
