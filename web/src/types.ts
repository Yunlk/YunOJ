export type Role = 'admin' | 'teacher' | 'student' | 'user'

export interface User {
  id: number
  username: string
  email: string
  role: Role
  disabled: boolean
  avatar: string
  rating: number
  rank: number
  created_at: string
}

export interface Group {
  id: number
  name: string
  description: string
  owner_id: number
  owner_name: string
  member_count: number
  created_at: string
  updated_at: string
}

export interface GroupMember {
  user_id: number
  username: string
  email: string
  role: 'student' | 'teacher'
  joined_at: string
}

export interface Assignment {
  id: number
  group_id: number
  title: string
  description: string
  kind: 'assignment' | 'test'
  creator_id: number
  creator_name: string
  start_at: string
  due_at?: string
  published: boolean
  problem_count: number
  created_at: string
  updated_at: string
}

export interface AssignmentProblem {
  assignment_id: number
  problem_id: number
  title: string
  sort_order: number
  max_score: number
}

export interface AssignmentProgress {
  user_id: number
  username: string
  solved: number
  problem_count: number
  best_score: number
  total_score: number
}

export interface HomeSummary {
  user_count: number
  problem_count: number
  contest_count: number
  submission_count: number
  group_count: number
  assignment_count: number
  active_contests: Contest[]
  upcoming_contests: Contest[]
  recent_problems: ProblemListItem[]
}

export interface HomeData {
  summary: HomeSummary
  groups?: Group[]
  my_stats?: {
    total_submissions: number
    accepted_submissions: number
    attempted_problems: number
    contests: number
  }
}

export type HomeProblem = ProblemListItem

export interface ProblemDiscussion {
  id: number
  problem_id: number
  user_id: number
  username: string
  content: string
  created_at: string
  updated_at: string
}

export interface ProblemEditorial {
  problem_id: number
  content: string
  updated_by: number
  updated_at: string
}

export interface Notification {
  id: number
  recipient_id?: number
  author_id: number
  author_name: string
  kind: string
  title: string
  content: string
  read: boolean
  created_at: string
}

export interface GroupDetail {
  group: Group
  members: GroupMember[]
  assignments: Assignment[]
  can_manage: boolean
}

export interface AssignmentDetail {
  assignment: Assignment
  group: Group
  problems: AssignmentProblem[]
  progress?: AssignmentProgress[]
  can_manage: boolean
}

export interface RankingEntry {
  rank: number
  user_id: number
  username: string
  avatar: string
  rating: number
  weighted_solved: number
  solved_problems: number
  attempted_problems: number
  first_bloods: number
  acceptance_rate: number
  last_accepted_at?: string
}

export interface ProfileStats {
  total_submissions: number
  accepted_submissions: number
  attempted_problems: number
  contests: number
}

export interface ProfileActivityDay {
  date: string
  count: number
}

export interface ProfileContest {
  id: number
  title: string
  mode: ContestMode
  submission_count: number
  last_submitted_at: string
}

export interface ProfileData {
  user: User
  ranking: RankingEntry | null
  stats: ProfileStats
  activity: ProfileActivityDay[]
  recent_submissions: SubmissionListItem[]
  contests: ProfileContest[]
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
  is_favorite?: boolean
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
  'presentation_error',
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
  case_scores: number[] | null
}

export interface Language {
  key: string
  name: string
  version: string
  monaco: string
  supports_optimize: boolean
}

// ---- 比赛 ----

export type ContestMode = 'ACM' | 'OI' | 'IOI'
export type ContestFeedback = 'realtime' | 'blind'
export type ContestScoreMode = 'all_or_nothing' | 'partial'
export type ContestRegistrationMode = 'individual' | 'team' | 'both'

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
  cover_image: string
  visibility: 'public' | 'private'
  reg_start_time?: string
  reg_end_time?: string
  submission_limit: number
  registration_mode: ContestRegistrationMode
  max_team_size: number
  allow_team_edit: boolean
  created_at: string
}

export interface ContestProblem {
  problem_id: number
  display_id: string
  sort_order: number
  title: string
  score?: number | null
  total_score?: number
  submission_limit?: number | null
  theme_color?: string
}

export interface ContestTeamMember {
  contest_id: number
  team_id: number
  user_id: number
  username: string
  is_captain: boolean
  joined_at: string
}

export interface MyTeam {
  team_name: string
  avatar: string
  team_id?: number
  members?: ContestTeamMember[]
  is_captain?: boolean
}

export interface ContestDetail {
  contest: Contest
  problems: ContestProblem[]
  is_registered?: boolean
  is_admin?: boolean
  my_team?: MyTeam
}

export interface ContestParticipant {
  contest_id: number
  team_id: number
  team_name: string
  username: string
  avatar: string
  submission_count: number
  accepted_count: number
  last_submitted_at?: string
  members: string[]
}

export interface ContestAnnouncement {
  id: number
  contest_id: number
  author_id: number
  author_name: string
  title: string
  content: string
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface ContestQuestion {
  id: number
  contest_id: number
  asker_id: number
  asker_name: string
  content: string
  answer: string
  answerer_id?: number
  answerer_name?: string
  public: boolean
  asked_at: string
  answered_at?: string
}

export interface ContestCommunications {
  announcements: ContestAnnouncement[]
  questions: ContestQuestion[]
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
  cover_image?: string
  visibility: 'public' | 'private'
  reg_start_time?: string
  reg_end_time?: string
  submission_limit: number
  registration_mode: ContestRegistrationMode
  max_team_size: number
  allow_team_edit: boolean
}

export interface ContestRegistration {
  contest: Contest
  registration_mode: ContestRegistrationMode
  max_team_size: number
  allow_team_edit: boolean
  is_registered: boolean
  team: { team_id: number; team_name: string; avatar: string; is_captain: boolean } | null
  members: ContestTeamMember[]
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
  theme_color: string
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
  last_status?: string
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
  live_submissions?: LiveSubmission[]
  latest_submission?: LiveSubmission
  roll_available?: boolean
  roll_initial_standings?: ACMStanding[]
  roll_events?: RollEvent[]
  fun_stats?: ContestFunStats
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
  standings_after?: ACMStanding[]
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

export interface ContestFunEntry {
  team_id: number
  team_name: string
  count?: number
  display_ids?: string[]
  created_at?: string
  elapsed_seconds?: number
}

export interface ContestFunStats {
  fastest_first_blood: ContestFunEntry[]
  most_first_blood: ContestFunEntry[]
  most_wrong_answers: ContestFunEntry[]
  last_accepted: ContestFunEntry[]
}
