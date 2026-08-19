export type Role = 'admin' | 'user'

export interface User {
  id: number
  username: string
  email: string
  role: Role
  created_at: string
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface ProblemListItem {
  id: number
  title: string
  difficulty: number
  tags: string[]
  accepted_count: number
  submission_count: number
  created_at: string
  updated_at: string
}

export interface Sample {
  input: string
  output: string
  note: string
}

export interface ProblemDetail extends ProblemListItem {
  statement: string
  input_format: string
  output_format: string
  hint: string
  samples: Sample[]
  time_limit_ms: number
  memory_limit_kb: number
}

export const SUBMISSION_STATUSES = [
  'pending',
  'running',
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'output_limit_exceeded',
  'runtime_error',
  'compile_error',
  'system_error',
] as const

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export interface SubmissionListItem {
  id: number
  problem_id: number
  problem_title: string
  user_id: number
  username: string
  language: string
  status: string
  time_ms: number
  memory_kb: number
  created_at: string
}

export interface CaseResult {
  case_id: number
  status: string
  time_ms: number
  memory_kb: number
}

export interface SubmissionDetail extends SubmissionListItem {
  code: string | null
  compile_error: string | null
  case_results: CaseResult[] | null
}

export interface Language {
  key: string
  name: string
  version: string
}

// ---- 比赛 ----

export type ContestMode = 'acm' | 'oi' | 'ioi'
export type ContestFeedback = 'visible' | 'blind'
export type ContestScoreMode = 'last' | 'best'

export interface Contest {
  id: number
  title: string
  mode: ContestMode
  feedback: ContestFeedback
  score_mode: ContestScoreMode
  penalty_minutes: number
  freeze_duration_minutes: number
  rank_keys: string[]
  start_time: string
  end_time: string
  created_at: string
}

export interface ContestProblem {
  problem_id: number
  display_id: string
  sort_order: number
  title: string
}

export interface ContestDetail {
  contest: Contest
  problems: ContestProblem[]
  is_registered?: boolean
  is_admin?: boolean
}

export interface ContestInput {
  title: string
  mode: ContestMode
  feedback: ContestFeedback
  score_mode: ContestScoreMode
  penalty_minutes: number
  freeze_duration_minutes: number
  rank_keys: string[]
  start_time: string
  end_time: string
}

export interface ACMProblemState {
  solved: boolean
  failed_attempts: number
  solved_at?: string
}

export interface ACMStanding {
  rank: number
  team_id: number
  team_name: string
  solved: number
  penalty: number
  last_ac?: string
  problems: Record<string, ACMProblemState>
}

export interface OIStanding {
  rank: number
  team_id: number
  team_name: string
  total_score: number
  problem_scores: Record<string, number>
  problem_submissions: Record<string, number>
}

export interface ContestStandings {
  contest: Contest
  problems: ContestProblem[]
  mode: ContestMode
  standings: ACMStanding[] | OIStanding[]
  freeze_at?: string
  frozen_submissions?: number
}

export interface RollEvent {
  submission_id: number
  problem_id: number
  team_id: number
  team_name: string
  rank_before: number
  rank_after: number
  standings: ACMStanding[]
}

export interface RollBoard {
  contest: Contest
  problems: ContestProblem[]
  freeze_at?: string
  events: RollEvent[]
  initial_standings: ACMStanding[]
}
