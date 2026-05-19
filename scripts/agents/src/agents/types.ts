/**
 * Common types for all agents
 */

export interface AgentContext {
  workingDir: string;
  repoOwner: string;
  repoName: string;
  prNumber?: number;
}

export interface AgentResult<T> {
  success: boolean;
  data?: T;
  errors?: AgentError[];
  warnings?: string[];
  proposedChanges?: ProposedChange[];
  validated?: boolean;
}

export interface AgentError {
  code: string;
  message: string;
  recoverable?: boolean;
}

export interface ProposedChange {
  filePath: string;
  type: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
  description?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Bug Fix Agent types
export interface BugFixAgentInput {
  issueNumber?: number;
  /** Pre-fetched issue title (treated as untrusted text). */
  issueTitle?: string;
  /** Pre-fetched issue body (treated as untrusted text). */
  issueBody?: string;
  maxIssues?: number;
  labels?: string[];
}

export interface BugFixAgentOutput {
  issuesProcessed: IssueProcessResult[];
  issuesFixed: number;
  issuesSkipped: number;
  pullRequestsCreated: PullRequestInfo[];
  summary: string;
}

export interface IssueProcessResult {
  issueNumber: number;
  status: 'fixed' | 'skipped' | 'failed';
  reason?: string;
  prNumber?: number;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  issueNumber: number;
}

// PR Review Agent types
export interface PRReviewAgentInput {
  prNumber: number;
  suggestTests?: boolean;
  focusAreas?: string[];
  diff?: string;
  /** When true, review each file separately to stay within small token limits */
  chunkedReview?: boolean;
}

export interface PRReviewAgentOutput {
  summary: string;
  issues: ReviewIssue[];
  suggestions: ReviewSuggestion[];
  suggestedTests: string[];
  approval: 'approve' | 'request_changes' | 'comment';
}

export interface ReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewSuggestion {
  file: string;
  line?: number;
  original?: string;
  suggested: string;
  reason: string;
}
