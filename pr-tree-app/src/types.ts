export interface PrParams {
  number?: number;
  title?: string;
  user?: string;
  reviewers?: string[];
  assignees?: string[];
  base?: string;
  head: string;
  url?: string;
  status?: 'success' | 'failure' | 'pending';
  approved?: boolean;
  approvers?: string[];
  changeRequesters?: string[];
  commenters?: string[];
  mergeable?: boolean | null;
  files?: FileChange[];
  currentBranch?: boolean;
  repoFullName?: string;
  updatedAt?: string;
  draft?: boolean;
  commentCount?: number;
  lastCommenter?: string;
  lastCommentedAt?: string;
  changedFiles?: number;
  ciFailures?: CiCheck[];
}

// 失敗した CI チェック（Check Run / commit status）の名前と詳細ページ URL
export interface CiCheck {
  name: string;
  url?: string;
}

export interface FileChange {
  status: string;
  name: string;
}

export interface GitHubPr {
  number: number;
  title: string;
  user: { login: string };
  requested_reviewers: { login: string }[];
  assignees?: { login: string }[];
  base: { ref: string };
  head: { ref: string; sha: string };
  html_url: string;
  updated_at: string;
  draft: boolean;
  mergeable?: boolean | null;
  changeRequesters?: string[];
  commenters?: string[];
  commentCount?: number;
  lastCommenter?: string;
  lastCommentedAt?: string;
  changedFiles?: number;
  ciFailures?: CiCheck[];
}

export interface GitHubReview {
  state: string;
  user: { login: string };
}

export interface GitHubFile {
  status: string;
  filename: string;
}

export interface GitHubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
}

// GraphQL response types
export type GraphQLStatusCheckContext =
  | {
      __typename: 'CheckRun';
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
    }
  | {
      __typename: 'StatusContext';
      context: string;
      state: string;
      targetUrl: string | null;
    };

export interface GraphQLPrNode {
  number: number;
  title: string;
  author: { login: string } | null;
  reviewRequests: {
    nodes: { requestedReviewer: { login: string } | null }[];
  };
  assignees: {
    nodes: { login: string }[];
  };
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  changedFiles: number;
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: {
          state: string;
        } | null;
      };
    }[];
  };
  allReviews: {
    totalCount: number;
    nodes: {
      state: string;
      author: { __typename: string; login: string } | null;
      createdAt: string;
    }[];
  };
  comments: {
    totalCount: number;
    nodes: {
      author: { __typename: string; login: string } | null;
      createdAt: string;
    }[];
  };
}

// 失敗 PR の check/status 一覧クエリ（alias は pr<number>）
export interface GraphQLCiFailureResponse {
  repository: Record<
    string,
    {
      number: number;
      commits: {
        nodes: {
          commit: {
            statusCheckRollup: {
              contexts: { nodes: GraphQLStatusCheckContext[] };
            } | null;
          };
        }[];
      };
    } | null
  >;
}

export interface GraphQLResponse {
  rateLimit: {
    cost: number;
    remaining: number;
    limit: number;
    resetAt: string;
  };
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphQLPrNode[];
    };
  };
}

export interface RepoEntry {
  owner: string;
  repo: string;
}

export interface AppConfig {
  token: string;
  repos: RepoEntry[];
  pollingInterval: number;
  username?: string;
  excludeKeywords?: string;
  // 後方互換
  owner?: string;
  repo?: string;
}
