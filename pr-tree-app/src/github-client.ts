import { GitHubPr, GitHubReview, GitHubFile } from './types';

const MAX_CACHE_ENTRIES = 200;

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
    const prs = await this.getAllPages<GitHubPr>(this.url('/pulls?per_page=100'));
    if (prs.length === 0) return [];

    const enriched = await Promise.all(
      prs.map(async (pr) => {
        const [status, files, reviews] = await Promise.all([
          this.combinedStatus(pr.head.sha),
          this.getRequest<GitHubFile[]>(this.url(`/pulls/${pr.number}/files`)),
          this.getRequest<GitHubReview[]>(this.url(`/pulls/${pr.number}/reviews`)),
        ]);

        return {
          ...pr,
          status,
          files: files || [],
          reviews: reviews || [],
          mergeable: pr.mergeable ?? null,
        };
      })
    );

    return enriched;
  }

  private async combinedStatus(sha: string): Promise<string> {
    const [statusResponse, checkRunsResponse] = await Promise.all([
      this.getRequest<{
        state: string;
        total_count: number;
      }>(this.url(`/commits/${sha}/status`)),
      this.getRequest<{
        check_runs: { id: number; name: string; status: string; conclusion: string | null }[];
      }>(this.url(`/commits/${sha}/check-runs`)),
    ]);

    const statusState = statusResponse?.state || 'success';
    const hasStatuses = (statusResponse?.total_count || 0) > 0;

    // 同じ name の check run が複数ある場合、最新（id が最大）のみを評価
    const allRuns = checkRunsResponse?.check_runs || [];
    const latestByName = new Map<string, (typeof allRuns)[number]>();
    for (const cr of allRuns) {
      const existing = latestByName.get(cr.name);
      if (!existing || cr.id > existing.id) {
        latestByName.set(cr.name, cr);
      }
    }
    const checkRuns = [...latestByName.values()];

    const hasRunFailure = checkRuns.some(
      (cr) => cr.conclusion === 'failure'
    );
    // queued のまま放置されている run は無視し、in_progress のみ pending とする
    const hasRunPending = checkRuns.some(
      (cr) => cr.status === 'in_progress'
    );

    // in_progress があれば再実行中なので pending を優先
    if (hasRunPending || (hasStatuses && statusState === 'pending')) {
      return 'pending';
    } else if ((hasStatuses && statusState === 'failure') || hasRunFailure) {
      return 'failure';
    } else {
      return 'success';
    }
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    let url: string | null = firstUrl;
    const result: T[] = [];
    while (url) {
      const headers: Record<string, string> = {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
      };

      const cached = this.etags.get(url);
      if (cached) {
        headers['If-None-Match'] = cached.etag;
      }

      try {
        const res: Response = await fetch(url, { headers });

        if (res.status === 304 && cached) {
          result.push(...(cached.data as T[]));
        } else if (res.ok) {
          const etag = res.headers.get('etag');
          const data = (await res.json()) as T[];
          if (etag) {
            if (this.etags.has(url)) this.etags.delete(url);
            this.etags.set(url, { etag, data });
          }
          result.push(...data);
        } else {
          console.error(`GitHub API error: ${res.status} ${res.statusText} for ${url}`);
          break;
        }

        // Link ヘッダーから次ページ URL を取得
        const link: string | null = res.headers.get('link');
        const next: RegExpMatchArray | null | undefined = link?.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : null;
      } catch (err) {
        console.error(`Request failed: ${url}`, err);
        break;
      }
    }
    return result;
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
        // アクセス順維持: 既存キーは末尾に移動
        if (this.etags.has(url)) {
          this.etags.delete(url);
        }
        // サイズ上限チェック: 超過時に古いエントリ（先頭半分）を削除
        if (this.etags.size >= MAX_CACHE_ENTRIES) {
          const deleteCount = Math.floor(MAX_CACHE_ENTRIES / 2);
          let count = 0;
          for (const key of this.etags.keys()) {
            if (count >= deleteCount) break;
            this.etags.delete(key);
            count++;
          }
        }
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
