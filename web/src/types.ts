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
  // 管理员列表专属
  type?: ProblemType
  status?: ProblemStatus
  testcase_count?: number
}

export type ProblemStatus = 'draft' | 'published' | 'disabled'
export type ProblemType = 'standard' | 'spj' | 'interactive' | 'output_only'

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
  type: ProblemType
  testcase_scores: number[]
  submission_limit: number
  status: ProblemStatus
  // 管理员专属
  spj_source?: string
  interactor_source?: string
  testcase_count?: number
}

export interface TestcaseItem {
  ordinal: number
  score: number
  size_bytes: number
  input_sha: string
  output_sha: string
  input_exists: boolean
  output_exists: boolean
  valid: boolean
}

export interface TestcasesResp {
  items: TestcaseItem[]
  count: number
  total_score: number
  problem_type: ProblemType
  score_valid: boolean
}

export interface ZipPreview {
  entries: { name: string; size: number }[]
  pairs: { name: string; in_size: number; out_size: number }[]
  unpaired: string[]
  total_size: number
  valid: boolean
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
  score: number
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

export type ContestMode = 'ACM' | 'OI' | 'IOI'
export type ContestFeedback = 'realtime' | 'blind'
export type ContestScoreMode = 'all_or_nothing' | 'partial'

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
  description: string
  visibility: 'public' | 'private'
  reg_start_time?: string
  reg_end_time?: string
  submission_limit: number
  created_at: string
}

export interface ContestProblem {
  problem_id: number
  display_id: string
  sort_order: number
  title: string
  score?: number | null
  submission_limit?: number | null
}

export interface MyTeam {
  team_name: string
  avatar: string
}

export interface ContestDetail {
  contest: Contest
  problems: ContestProblem[]
  is_registered?: boolean
  is_admin?: boolean
  my_team?: MyTeam
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
  description: string
  visibility: 'public' | 'private'
  reg_start_time?: string
  reg_end_time?: string
  submission_limit: number
}

// ---- 比赛总览 ----

export interface OverviewProblem {
  problem_id: number
  display_id: string
  sort_order: number
  title: string
  score: number
  submission_limit: number
  submission_count: number
  attempted_users: number
  accepted_users: number
  my_submissions: number
  my_remaining: number | null
  my_status: 'untried' | 'judging' | 'passed' | 'failed'
  my_score: number
}

export interface ContestOverview {
  contest: Contest
  problems: OverviewProblem[]
  phase: 'upcoming' | 'running' | 'ended'
  server_time: string
  my_summary?: {
    rank: number
    solved?: number
    penalty?: number
    total_score?: number
    visible: boolean
  }
}

export interface ContestProblemView {
  problem: ProblemDetail
  contest_problem: {
    problem_id: number
    display_id: string
    sort_order: number
    score: number
    submission_limit: number
  }
  prev_problem_id?: number
  next_problem_id?: number
  my?: {
    submissions: number
    status: string
    score: number
    remaining?: number
  }
}

export interface ACMProblemState {
  solved: boolean
  failed_attempts: number
  solved_at?: string
  first_blood?: boolean
}

export interface ACMStanding {
  rank: number
  team_id: number
  team_name: string
  avatar: string
  solved: number
  penalty: number
  last_ac?: string
  problems: Record<string, ACMProblemState>
}

export interface OIStanding {
  rank: number
  team_id: number
  team_name: string
  avatar: string
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
  latest_submission?: LiveSubmission
  roll_available?: boolean
  roll_initial_standings?: ACMStanding[]
  roll_events?: RollEvent[]
}

export interface LiveSubmission {
  submission_id: number
  problem_id: number
  display_id: string
  team_id: number
  team_name: string
  team_avatar: string
  status: string
  created_at: string
}

export interface RollEvent {
  submission_id: number
  problem_id: number
  status: string
  team_id: number
  team_name: string
  team_avatar: string
  standings: ACMStanding[]
}
