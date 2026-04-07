export interface PrParams {
  number?: number;
  title?: string;
  user?: string;
  reviewers?: string[];
  base?: string;
  head: string;
  url?: string;
  status?: 'success' | 'failure' | 'pending';
  approved?: boolean;
  approvers?: string[];
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
  base: { ref: string };
  head: { ref: string; sha: string };
  html_url: string;
  updated_at: string;
  draft: boolean;
  mergeable?: boolean | null;
  commentCount?: number;
  lastCommenter?: string;
  lastCommentedAt?: string;
  changedFiles?: number;
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
export interface GraphQLPrNode {
  number: number;
  title: string;
  author: { login: string } | null;
  reviewRequests: {
    nodes: { requestedReviewer: { login: string } | null }[];
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
  reviews: {
    totalCount: number;
    nodes: {
      state: string;
      author: { login: string } | null;
      createdAt: string;
    }[];
  };
  comments: {
    totalCount: number;
    nodes: {
      author: { login: string } | null;
      createdAt: string;
    }[];
  };
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
