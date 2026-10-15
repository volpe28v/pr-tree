import {
  CiCheck,
  GitHubPr,
  GitHubReview,
  GitHubFile,
  GraphQLCiFailureResponse,
  GraphQLPrNode,
  GraphQLResponse,
  GraphQLStatusCheckContext,
} from './types';

// bot は自動レビュー（devin / cursor / github-actions 等）として集計から除くが、
// レビュー担当として扱いたい bot はここに列挙して人と同じ扱いにする
const VISIBLE_BOTS = new Set(['higasshi-bot']);

function isIgnoredBot(author: { __typename: string; login: string } | null): boolean {
  return author !== null && author.__typename === 'Bot' && !VISIBLE_BOTS.has(author.login);
}

// 最終コメント者の候補として issue コメントを末尾から取る件数。bot（github-actions 等）を飛ばして人の最新を探すため 1 件では足りない
// （レビュー側の候補は allReviews をそのまま使う）
const LAST_COMMENT_CANDIDATES = 10;

// 1 PR あたり取得するレビュー件数。承認 / request changes の判定は直近が重要なので last で取り、
// 100 件を超える PR では古い側を切り捨てる
const REVIEWS_PER_PR = 100;

const PR_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  rateLimit {
    cost
    remaining
    limit
    resetAt
  }
  repository(owner: $owner, name: $repo) {
    pullRequests(states: [OPEN], first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title
        author { login }
        reviewRequests(first: 20) {
          nodes { requestedReviewer { ... on User { login } } }
        }
        assignees(first: 10) {
          nodes { login }
        }
        baseRefName headRefName headRefOid
        url updatedAt isDraft mergeable changedFiles
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
        allReviews: reviews(last: ${REVIEWS_PER_PR}) {
          totalCount
          nodes { state author { __typename login } createdAt }
        }
        comments(last: ${LAST_COMMENT_CANDIDATES}) {
          totalCount
          nodes { author { __typename login } createdAt }
        }
      }
    }
  }
}
`;

// 失敗 PR ごとの check/status 一覧。一覧クエリに contexts を同居させると
// open PR が多いリポジトリで GitHub 側が 504 を返すため、対象 PR を絞って別途取得する
const CI_FAILURE_BATCH_SIZE = 10;
const CI_CONTEXTS_PER_PR = 50;

function buildCiFailureQuery(numbers: number[]): string {
  const fields = numbers
    .map(
      (n) => `
    pr${n}: pullRequest(number: ${n}) {
      number
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: ${CI_CONTEXTS_PER_PR}) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }`
    )
    .join('');
  return `
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {${fields}
  }
}
`;
}

// CheckRun.conclusion のうち rollup を FAILURE にするもの
// （NEUTRAL / SKIPPED / SUCCESS は赤の原因にならない）
const CHECK_RUN_FAILURE_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
]);

// 赤の原因になった check / status だけを抜き出す（PENDING や SUCCESS は含めない）
function collectCiFailures(contexts: GraphQLStatusCheckContext[]): CiCheck[] {
  const failures: CiCheck[] = [];
  for (const ctx of contexts) {
    if (ctx.__typename === 'CheckRun') {
      if (CHECK_RUN_FAILURE_CONCLUSIONS.has((ctx.conclusion ?? '').toUpperCase())) {
        failures.push({ name: ctx.name, url: ctx.detailsUrl ?? undefined });
      }
    } else if (ctx.__typename === 'StatusContext') {
      const state = ctx.state.toUpperCase();
      if (state === 'FAILURE' || state === 'ERROR') {
        failures.push({ name: ctx.context, url: ctx.targetUrl ?? undefined });
      }
    }
  }
  return failures;
}

export interface RateLimitInfo {
  cost: number;
  remaining: number;
  limit: number;
  resetAt: string;
}

export class GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;
  apiCallCount = 0;
  rateLimitInfo: RateLimitInfo | null = null;

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

  async pullRequests(
    username?: string
  ): Promise<
    (GitHubPr & {
      status: string;
      files: GitHubFile[];
      reviews: GitHubReview[];
      mergeable: boolean | null;
    })[]
  > {
    const allNodes = await this.fetchAllPrs();
    if (allNodes.length === 0) return [];

    const transformed = allNodes.map((node) => this.transformPr(node));

    const visible = username
      ? transformed.filter(
          (pr) =>
            pr.user.login === username ||
            pr.requested_reviewers.some((r) => r.login === username) ||
            (pr.assignees || []).some((a) => a.login === username)
        )
      : transformed;

    await this.attachCiFailures(visible);
    return visible;
  }

  // 赤の PR にだけ失敗チェック一覧を付ける。取得に失敗しても一覧表示は壊さない
  // （ciFailures が undefined のままなら描画側が「取得できず」と出す）
  private async attachCiFailures(prs: (GitHubPr & { status: string })[]): Promise<void> {
    const failed = prs.filter((pr) => pr.status === 'failure');
    if (failed.length === 0) return;

    const batches: GitHubPr[][] = [];
    for (let i = 0; i < failed.length; i += CI_FAILURE_BATCH_SIZE) {
      batches.push(failed.slice(i, i + CI_FAILURE_BATCH_SIZE));
    }

    await Promise.all(
      batches.map(async (batch) => {
        try {
          const data = await this.graphql<GraphQLCiFailureResponse>(
            buildCiFailureQuery(batch.map((pr) => pr.number)),
            { owner: this.owner, repo: this.repo }
          );
          for (const pr of batch) {
            const node = data.repository[`pr${pr.number}`];
            if (!node) continue;
            pr.ciFailures = collectCiFailures(
              node.commits.nodes[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
            );
          }
        } catch (e) {
          console.warn(
            `CI failure details unavailable for ${this.owner}/${this.repo} #${batch
              .map((pr) => pr.number)
              .join(',#')}:`,
            e
          );
        }
      })
    );
  }

  private async fetchAllPrs(): Promise<GraphQLPrNode[]> {
    const allNodes: GraphQLPrNode[] = [];
    let cursor: string | null = null;

    do {
      const data: GraphQLResponse = await this.graphql<GraphQLResponse>(
        PR_QUERY,
        {
          owner: this.owner,
          repo: this.repo,
          cursor,
        }
      );

      this.rateLimitInfo = data.rateLimit;

      const prs: GraphQLResponse['repository']['pullRequests'] =
        data.repository.pullRequests;
      allNodes.push(...prs.nodes);

      cursor = prs.pageInfo.hasNextPage
        ? prs.pageInfo.endCursor
        : null;
    } while (cursor);

    return allNodes;
  }

  private transformPr(gqlPr: GraphQLPrNode): GitHubPr & {
    status: string;
    files: GitHubFile[];
    reviews: GitHubReview[];
    mergeable: boolean | null;
  } {
    const mergeableMap: Record<string, boolean | null> = {
      MERGEABLE: true,
      CONFLICTING: false,
      UNKNOWN: null,
    };

    // レビューを人ごとに集計する。
    // - 未解消の request changes: CHANGES_REQUESTED の後に同じ人が APPROVED していれば解消済み。
    //   dismiss されたレビューは state が DISMISSED に変わるため CHANGES_REQUESTED 判定から自然に外れる。
    // - コメントのみ: レビューは出したが承認も request changes もしていない人
    //   （GitHub の Reviewers 欄で吹き出しアイコンになる人。dismiss された承認者もここに落ちる）。
    //   PR 作者自身のコメントレビューはレビュアーではないので除く。
    //   bot（devin / cursor 等の自動レビュー）は全 PR に付くため人数と工程判定から除く
    //   （VISIBLE_BOTS に挙げた bot は除かない）。
    const authorLogin = gqlPr.author?.login;
    const approvedReviews = gqlPr.allReviews.nodes.filter(
      (r) => r.state === 'APPROVED' && r.author !== null
    );
    const lastApprovedAt = new Map<string, string>();
    for (const r of approvedReviews) {
      const prev = lastApprovedAt.get(r.author!.login);
      if (!prev || r.createdAt > prev) lastApprovedAt.set(r.author!.login, r.createdAt);
    }
    const changeRequesters = new Set<string>();
    for (const r of gqlPr.allReviews.nodes) {
      if (r.state !== 'CHANGES_REQUESTED' || !r.author) continue;
      const approvedAt = lastApprovedAt.get(r.author.login);
      if (!approvedAt || r.createdAt > approvedAt) changeRequesters.add(r.author.login);
    }
    const commenters = new Set<string>();
    for (const r of gqlPr.allReviews.nodes) {
      const login = r.author?.login;
      if (!login || login === authorLogin || isIgnoredBot(r.author)) continue;
      if (lastApprovedAt.has(login) || changeRequesters.has(login)) continue;
      commenters.add(login);
    }

    // コメント総数（reviews + comments）と最終コメント者を算出。
    // 最終コメント者は bot（github-actions / devin 等）を除いた人の最新（VISIBLE_BOTS は人と同じ扱い）。
    // 候補はレビュー末尾 REVIEWS_PER_PR 件と issue コメント末尾 LAST_COMMENT_CANDIDATES 件。
    // どちらも全部 bot なら「最終コメントなし」扱いになる
    const commentCount =
      gqlPr.allReviews.totalCount + gqlPr.comments.totalCount;
    let lastCommenter: string | undefined;
    let lastCommentedAt: string | undefined;
    for (const c of [...gqlPr.allReviews.nodes, ...gqlPr.comments.nodes]) {
      if (!c.author || isIgnoredBot(c.author)) continue;
      if (!lastCommentedAt || c.createdAt > lastCommentedAt) {
        lastCommenter = c.author.login;
        lastCommentedAt = c.createdAt;
      }
    }

    return {
      number: gqlPr.number,
      title: gqlPr.title,
      user: { login: gqlPr.author?.login ?? '' },
      requested_reviewers: gqlPr.reviewRequests.nodes
        .filter((n) => n.requestedReviewer !== null)
        .map((n) => ({ login: n.requestedReviewer!.login })),
      assignees: gqlPr.assignees.nodes.map((n) => ({ login: n.login })),
      base: { ref: gqlPr.baseRefName },
      head: { ref: gqlPr.headRefName, sha: gqlPr.headRefOid },
      html_url: gqlPr.url,
      updated_at: gqlPr.updatedAt,
      draft: gqlPr.isDraft,
      status: this.computeStatus(gqlPr),
      files: [],
      reviews: approvedReviews.map((r) => ({
        state: 'APPROVED',
        user: { login: r.author!.login },
      })),
      mergeable: mergeableMap[gqlPr.mergeable] ?? null,
      changeRequesters: [...changeRequesters],
      commenters: [...commenters],
      commentCount,
      lastCommenter,
      lastCommentedAt,
      changedFiles: gqlPr.changedFiles,
    };
  }

  private computeStatus(gqlPr: GraphQLPrNode): string {
    const rollup =
      gqlPr.commits.nodes[0]?.commit?.statusCheckRollup ?? null;
    if (!rollup) return 'success';

    // statusCheckRollup.state は GitHub が全 check/status を集約した結果
    // SUCCESS, PENDING, FAILURE, ERROR, EXPECTED のいずれか
    const state = rollup.state.toUpperCase();
    if (state === 'PENDING' || state === 'EXPECTED') {
      return 'pending';
    } else if (state === 'FAILURE' || state === 'ERROR') {
      return 'failure';
    }
    return 'success';
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    this.apiCallCount++;
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `GraphQL API error: ${res.status} ${res.statusText}\n${body}`
      );
    }
    const json = (await res.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (json.errors) {
      throw new Error(
        `GraphQL errors: ${json.errors.map((e) => e.message).join(', ')}`
      );
    }
    if (!json.data) {
      throw new Error('GraphQL response has no data');
    }
    return json.data;
  }
}
