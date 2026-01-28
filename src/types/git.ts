export type GitCommit = {
  hash: string;
  parents: string[];
  author: string;
  author_email: string;
  date: string;
  subject: string;
  refs: string;
  is_head: boolean;
};

export type RepoOverview = {
  head: string;
  head_name: string;
  branches: string[];
  tags: string[];
  remotes: string[];
};

export type GitTagTarget = {
  name: string;
  target: string;
};

export type GitStatusEntry = {
  status: string;
  path: string;
};

export type GitStashEntry = {
  index: number;
  reference: string;
  message: string;
};

export type GitStatusSummary = {
  changed: number;
};

export type GitAheadBehind = {
  ahead: number;
  behind: number;
  upstream?: string | null;
};

export type PullResult = {
  status: string;
  operation: string;
  message: string;
  conflict_files: string[];
};

export type PullPredictResult = {
  upstream?: string | null;
  ahead: number;
  behind: number;
  action: string;
  conflict_files: string[];
};

export type PullPredictGraphResult = {
  upstream?: string | null;
  ahead: number;
  behind: number;
  action: string;
  conflict_files: string[];
  graph_commits: GitCommit[];
  created_node_ids: string[];
  head_name: string;
  remote_name: string;
};

export type GitCloneProgressEvent = {
  destination_path: string;
  phase?: string | null;
  percent?: number | null;
  message: string;
};

export type GitCommitSummary = {
  hash: string;
  author: string;
  date: string;
  subject: string;
  refs: string;
};

export type GitBranchInfo = {
  name: string;
  kind: "local" | "remote" | string;
  target: string;
  committer_date: string;
};

export type GitConflictFileEntry = {
  status: string;
  path: string;
  stages: number[];
};

export type GitConflictState = {
  in_progress: boolean;
  operation: string;
  files: GitConflictFileEntry[];
};

export type GitConflictFileVersions = {
  base?: string | null;
  ours?: string | null;
  theirs?: string | null;
  working?: string | null;
};
