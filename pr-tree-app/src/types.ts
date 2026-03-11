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
  mergeable?: boolean | null;
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

export interface RepoEntry {
  owner: string;
  repo: string;
}

export interface AppConfig {
  token: string;
  repos: RepoEntry[];
  pollingInterval: number;
  username?: string;
  // 後方互換
  owner?: string;
  repo?: string;
}
