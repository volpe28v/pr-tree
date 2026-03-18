import {
  GitHubPr,
  GitHubReview,
  GitHubFile,
  GraphQLPrNode,
  GraphQLResponse,
} from './types';

const PR_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  rateLimit {
    cost
    remaining
    limit
    resetAt
  }
  repository(owner: $owner, name: $repo) {
    pullRequests(states: [OPEN], first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title
        author { login }
        reviewRequests(first: 20) {
          nodes { requestedReviewer { ... on User { login } } }
        }
        baseRefName headRefName headRefOid
        url updatedAt isDraft mergeable
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
        reviews(first: 100) {
          nodes { state author { login } }
        }
      }
    }
  }
}
`;

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

    if (!username) return transformed;

    return transformed.filter(
      (pr) =>
        pr.user.login === username ||
        pr.requested_reviewers.some((r) => r.login === username)
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

    return {
      number: gqlPr.number,
      title: gqlPr.title,
      user: { login: gqlPr.author?.login ?? '' },
      requested_reviewers: gqlPr.reviewRequests.nodes
        .filter((n) => n.requestedReviewer !== null)
        .map((n) => ({ login: n.requestedReviewer!.login })),
      base: { ref: gqlPr.baseRefName },
      head: { ref: gqlPr.headRefName, sha: gqlPr.headRefOid },
      html_url: gqlPr.url,
      updated_at: gqlPr.updatedAt,
      draft: gqlPr.isDraft,
      status: this.computeStatus(gqlPr),
      files: [],
      reviews: gqlPr.reviews.nodes
        .filter((r) => r.author !== null)
        .map((r) => ({ state: r.state, user: { login: r.author!.login } })),
      mergeable: mergeableMap[gqlPr.mergeable] ?? null,
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
