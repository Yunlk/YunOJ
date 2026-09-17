import axios, { AxiosError } from 'axios'
import type {
  Contest,
  ContestCommunications,
  ContestDetail,
  ContestHackItem,
  ContestRegistration,
  ContestInput,
  ContestOverview,
  ContestProblemView,
  ContestParticipant,
  HackTargetsResp,
  ProblemDiscussion,
  ProblemEditorial,
  Notification,
  ContestStandings,
  Assignment,
  AssignmentDetail,
  Group,
  GroupDetail,
  HomeData,
  Language,
  Page,
  ProfileData,
  RankingEntry,
  ProblemDetail,
  ProblemAttachment,
  ProblemFacets,
  ProblemListItem,
  Sample,
  SubmissionDetail,
  SubmissionListItem,
  TestcasesResp,
  User,
  ZipPreview,
} from './types'

export const TOKEN_KEY = 'yunoj_token'

const api = axios.create({
  baseURL: '/api',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string }>) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      const path = window.location.pathname
      if (path !== '/login' && path !== '/register') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export function extractError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined
    if (data && typeof data.error === 'string' && data.error) {
      return data.error
    }
    if (error.message) return error.message
  }
  return '请求失败，请稍后重试'
}

export { api }

// ---- Auth ----

export async function register(username: string, email: string, password: string) {
  const res = await api.post<{ token: string; user: User }>('/auth/register', {
    username,
    email,
    password,
  })
  return res.data
}

export async function login(username: string, password: string) {
  const res = await api.post<{ token: string; user: User }>('/auth/login', {
    username,
    password,
  })
  return res.data
}

export async function getMe() {
  const res = await api.get<{ user: User }>('/auth/me')
  return res.data.user
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await api.post('/profile/password', { current_password: currentPassword, new_password: newPassword })
}

export async function updateProfile(username: string, email: string, currentPassword: string) {
  const res = await api.patch<{ user: User }>('/profile', {
    username,
    email,
    current_password: currentPassword,
  })
  return res.data
}

// ---- 首页 / 教学空间 ----

export async function getHome() {
  const res = await api.get<HomeData>('/home')
  return res.data
}

export async function getGroups() {
  const res = await api.get<{ items: Group[] }>('/groups')
  return res.data.items
}

export async function createGroup(data: { name: string; description: string }) {
  const res = await api.post<Group>('/groups', data)
  return res.data
}

export async function getGroup(id: number | string) {
  const res = await api.get<GroupDetail>(`/groups/${id}`)
  return res.data
}

export async function updateGroup(id: number | string, data: { name: string; description: string }) {
  const res = await api.put<Group>(`/groups/${id}`, data)
  return res.data
}

export async function addGroupMember(id: number | string, data: { user_id: number; role: 'student' | 'teacher' }) {
  await api.post(`/groups/${id}/members`, data)
}

export async function removeGroupMember(id: number | string, userId: number) {
  await api.delete(`/groups/${id}/members/${userId}`)
}

export async function createAssignment(id: number | string, data: {
  title: string
  description: string
  kind: 'assignment' | 'test'
  start_at: string
  due_at?: string
  published: boolean
}) {
  const res = await api.post<Assignment>(`/groups/${id}/assignments`, data)
  return res.data
}

export async function getAssignment(id: number | string) {
  const res = await api.get<AssignmentDetail>(`/assignments/${id}`)
  return res.data
}

export async function updateAssignment(id: number | string, data: {
  title: string
  description: string
  kind: 'assignment' | 'test'
  start_at: string
  due_at?: string
  published: boolean
}) {
  const res = await api.put<Assignment>(`/assignments/${id}`, data)
  return res.data
}

export async function addAssignmentProblem(id: number | string, data: { problem_id: number; sort_order: number; max_score: number }) {
  await api.post(`/assignments/${id}/problems`, data)
}

export async function removeAssignmentProblem(id: number | string, problemId: number) {
  await api.delete(`/assignments/${id}/problems/${problemId}`)
}

export async function getAdminUsers(params: { page: number; size: number; keyword?: string; role?: string }) {
  const res = await api.get<Page<User>>('/admin/users', { params })
  return res.data
}

export async function updateAdminUser(id: number, data: { role: string; disabled: boolean; password?: string }) {
  const res = await api.patch<{ user: User }>(`/admin/users/${id}`, data)
  return res.data.user
}

export async function getProfile() {
  const res = await api.get<ProfileData>('/profile')
  return res.data
}

export async function uploadProfileAvatar(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ avatar: string }>('/profile/avatar', form)
  return res.data
}

export async function getNotifications() {
  const res = await api.get<{ items: Notification[] }>('/notifications')
  return res.data.items
}

export async function markNotificationRead(id: number) {
  await api.post(`/notifications/${id}/read`)
}

/** 一键把当前用户可见的全部通知标为已读，返回本次新标记条数。 */
export async function markAllNotificationsRead() {
  const res = await api.post<{ marked: number }>('/notifications/read-all')
  return res.data.marked
}

export async function createNotification(data: { title: string; content: string; kind?: string }) {
  const res = await api.post<Notification>('/notifications', data)
  return res.data
}

export async function deleteNotification(id: number) {
  await api.delete(`/notifications/${id}`)
}

// ---- 全站排名 ----

export async function getRankings(page: number, size: number, keyword?: string) {
  const res = await api.get<Page<RankingEntry>>('/rankings', { params: { page, size, keyword } })
  return res.data
}

// ---- Problems ----

export type ProblemSort =
  | 'id'
  | 'difficulty'
  | 'difficulty_desc'
  | 'acceptance'
  | 'newest'
  | 'submissions'
  /** recent：按「我最近提交过」排序（需要登录；未登录时回退题号） */
  | 'recent'
export type MyProblemStatus = 'todo' | 'attempted' | 'accepted'

export async function getProblems(params: {
  page: number
  size: number
  keyword?: string
  difficulty?: number[]
  tag?: string[]
  my_status?: MyProblemStatus
  sort?: ProblemSort
  type?: string
  status?: string
}) {
  const res = await api.get<Page<ProblemListItem>>('/problems', {
    params,
    // 数组参数序列化为 difficulty=1&difficulty=2，与后端 queryList 约定一致
    paramsSerializer: { indexes: null },
  })
  return res.data
}

/** 题库筛选统计：难度分布、我的进度与标签频次。 */
export async function getProblemFacets() {
  const res = await api.get<ProblemFacets>('/problems/facets')
  return res.data
}

export async function getProblem(id: number | string) {
  const res = await api.get<ProblemDetail>(`/problems/${id}`)
  return res.data
}

export async function getProblemLearning(id: number | string) {
  const res = await api.get<{ favorite: boolean; discussions: ProblemDiscussion[]; editorial?: ProblemEditorial }>(`/problems/${id}/learning`)
  return res.data
}

/** 相邻题目（0 表示没有），供单题页「上一题 / 下一题」使用。 */
export async function getProblemNeighbors(id: number | string) {
  const res = await api.get<{ prev: number; next: number }>(`/problems/${id}/neighbors`)
  return res.data
}

/** 当前进行中的比赛（没有则 null）。导航栏倒计时用，避免拉整份首页数据。 */
export async function getActiveContest() {
  const res = await api.get<{ contest: Contest | null }>('/contests/active')
  return res.data.contest
}

export async function toggleProblemFavorite(id: number | string) {
  const res = await api.post<{ favorite: boolean }>(`/problems/${id}/favorite`)
  return res.data.favorite
}

export async function createProblemDiscussion(id: number | string, content: string) {
  const res = await api.post<ProblemDiscussion>(`/problems/${id}/discussions`, { content })
  return res.data
}

export interface ProblemInput {
  title: string
  statement: string
  input_format: string
  output_format: string
  hint: string
  samples: Sample[]
  time_limit_ms: number
  memory_limit_kb: number
  difficulty: number
  tags: string[]
  type: string
  checker_mode: 'token' | 'exact'
	spj_source: string
	interactor_source: string
	hack_generator_source: string
	hack_reference_source: string
	hack_target_source: string
	testcase_scores: number[]
  submission_limit: number
  status: string
  /** 提供者/来源（可空，如「Codeforces 1900E」） */
  provider: string
  /** 是否向选手展示该题分数 */
  show_score: boolean
}

// ---- 题目管理后台 ----

export async function copyProblem(id: number | string) {
  const res = await api.post<ProblemDetail>(`/problems/${id}/copy`)
  return res.data
}

export async function importProblemPackage(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ problem: ProblemDetail; testcase_count: number }>('/problems/import', form)
  return res.data
}

export async function exportProblemPackage(id: number | string) {
  const res = await api.get<Blob>(`/problems/${id}/package`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = `problem-${id}-package.zip`
  link.click()
  URL.revokeObjectURL(url)
}

export async function updateProblemStatus(id: number | string, status: string) {
  const res = await api.patch<{ id: number; status: string }>(`/problems/${id}/status`, { status })
  return res.data
}

export async function batchProblems(ids: number[], action: 'publish' | 'disable' | 'delete') {
  const res = await api.post<{ results: { id: number; ok: boolean; error?: string }[] }>(
    '/problems/batch',
    { ids, action },
  )
  return res.data
}

export async function getProblemUsage(id: number | string) {
  const res = await api.get<{ contests: { id: number; title: string }[]; submissions: number }>(
    `/problems/${id}/usage`,
  )
  return res.data
}

// ---- 测试点管理 ----

export async function getTestcases(id: number | string) {
  const res = await api.get<TestcasesResp>(`/problems/${id}/testcases`)
  return res.data
}

export async function previewTestsZip(id: number | string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<ZipPreview>(`/problems/${id}/testcases/preview`, form)
  return res.data
}

export async function importTestsZip(
  id: number | string,
  file: File,
  mode: 'replace' | 'append',
  scores: number[],
) {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  form.append('scores', JSON.stringify(scores))
  const res = await api.post<{ count: number; ordinals?: number[]; start_ordinal?: number }>(
    `/problems/${id}/testcases/import`,
    form,
  )
  return res.data
}

export async function addTestcase(
  id: number | string,
  inFile: File,
  outFile: File,
  score: number,
) {
  const form = new FormData()
  form.append('in', inFile)
  form.append('out', outFile)
  form.append('score', String(score))
  const res = await api.post<{ ordinal: number; score: number }>(`/problems/${id}/testcases`, form)
  return res.data
}

export async function updateTestcase(
  id: number | string,
  ordinal: number,
  patch: { score?: number; is_pretest?: boolean },
) {
  const res = await api.put<{ ordinal: number; score: number; is_pretest: boolean }>(
    `/problems/${id}/testcases/${ordinal}`,
    patch,
  )
  return res.data
}

export async function deleteTestcase(id: number | string, ordinal: number) {
  await api.delete(`/problems/${id}/testcases/${ordinal}`)
}

// ---- 题目附件 ----

export async function getProblemAttachments(id: number | string) {
  const res = await api.get<{ items: ProblemAttachment[]; total: number }>(`/problems/${id}/attachments`)
  return res.data
}

export async function uploadProblemAttachment(id: number | string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<ProblemAttachment>(`/problems/${id}/attachments`, form)
  return res.data
}

export async function deleteProblemAttachment(id: number | string, attachmentId: number) {
  await api.delete(`/problems/${id}/attachments/${attachmentId}`)
}

/** 附件下载地址（走带令牌的 axios，避免 <a href> 丢失 Authorization 头）。 */
export async function downloadProblemAttachment(id: number | string, attachment: ProblemAttachment) {
  const res = await api.get<Blob>(`/problems/${id}/attachments/${attachment.id}/download`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function reorderTestcases(id: number | string, ordinals: number[]) {
  const res = await api.put<{ ordinals: number[] }>(`/problems/${id}/testcases/order`, { ordinals })
  return res.data
}

export async function createProblem(data: ProblemInput) {
  const res = await api.post<ProblemDetail>('/problems', data)
  return res.data
}

export async function updateProblem(id: number | string, data: ProblemInput) {
  const res = await api.put<ProblemDetail>(`/problems/${id}`, data)
  return res.data
}

export async function deleteProblem(id: number | string) {
  await api.delete(`/problems/${id}`)
}

export async function uploadTests(id: number | string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ count: number }>(`/problems/${id}/tests`, form)
  return res.data
}

// ---- Submissions ----

export async function createSubmission(
  problemId: number,
  language: string,
  code: string,
  optimize = true,
  assignmentId?: number,
) {
  const res = await api.post<{ id: number }>('/submissions', {
    problem_id: problemId,
    language,
    code,
    optimize,
    ...(assignmentId ? { assignment_id: assignmentId } : {}),
  })
  return res.data
}

export async function getSubmissions(params: {
  page: number
  size: number
  problem_id?: string
  user_id?: string
  status?: string
  /** 语言键过滤（如 cpp） */
  language?: string
  /** 提交时间下界（RFC3339），用于「今天 / 近 7 天」等服务端筛选 */
  created_after?: string
  /** 提交时间上界（RFC3339，开区间） */
  created_before?: string
}) {
  const res = await api.get<Page<SubmissionListItem>>('/submissions', { params })
  return res.data
}

export async function getSubmission(id: number | string) {
  const res = await api.get<SubmissionDetail>(`/submissions/${id}`)
  return res.data
}

export async function getSubmissionResult(id: number | string) {
  const res = await api.get<SubmissionDetail>(`/submissions/${id}`, {
    params: { compact: 1 },
  })
  return res.data
}

export async function rejudgeSubmission(id: number | string) {
  const res = await api.post<{ id: number }>(`/submissions/${id}/rejudge`)
  return res.data
}

// ---- Languages ----

export async function getLanguages() {
  const res = await api.get<{ items: Language[] }>('/languages')
  return res.data.items
}

// ---- 自测 / 样例测试（临时运行，不落库） ----

export interface RunTestResult {
  status: string
  stdout: string
  stderr?: string
  time_ms: number
  wall_time_ms: number
  memory_kb: number
  timeout_source?: string
  compile_error?: string
}

export interface SampleCaseResult {
  status: string
  stdout: string
  time_ms: number
  wall_time_ms: number
  memory_kb: number
  timeout_source?: string
  passed: boolean | null
}

export interface SampleTestResult {
  status: string
  compile_error?: string
  cases: SampleCaseResult[]
}

export async function runTest(
  problemId: number,
  language: string,
  code: string,
  input: string,
  optimize = true,
  sampleIndex?: number,
) {
  const res = await api.post<RunTestResult>(`/problems/${problemId}/test`, {
    language,
    code,
    input,
    optimize,
    ...(sampleIndex !== undefined ? { sample_index: sampleIndex } : {}),
  })
  return res.data
}

export async function runContestTest(
  contestId: number,
  problemId: number,
  language: string,
  code: string,
  input: string,
  optimize = true,
  sampleIndex?: number,
) {
  const res = await api.post<RunTestResult>(
    `/contests/${contestId}/problems/${problemId}/test`,
    {
      language,
      code,
      input,
      optimize,
      ...(sampleIndex !== undefined ? { sample_index: sampleIndex } : {}),
    },
  )
  return res.data
}

export async function runSamples(
  problemId: number,
  language: string,
  code: string,
  optimize = true,
) {
  const res = await api.post<SampleTestResult>(`/problems/${problemId}/test-samples`, {
    language,
    code,
    optimize,
  })
  return res.data
}

// ---- 比赛 ----

export async function getContests(params: { page: number; size: number }) {
  const res = await api.get<Page<Contest>>('/contests', { params })
  return res.data
}

export async function getContest(id: number | string) {
  const res = await api.get<ContestDetail>(`/contests/${id}`)
  return res.data
}

export async function getContestParticipants(id: number | string) {
  const res = await api.get<{ items: ContestParticipant[] }>(`/contests/${id}/participants`)
  return res.data.items
}

export async function removeContestParticipant(id: number | string, teamId: number) {
  await api.delete(`/contests/${id}/participants/${teamId}`)
}

export async function exportContestParticipants(id: number | string) {
  const res = await api.get<Blob>(`/contests/${id}/participants/export`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = 'contest-participants.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export async function createContest(data: ContestInput) {
  const res = await api.post<Contest>('/contests', data)
  return res.data
}

export async function updateContest(id: number | string, data: ContestInput) {
  const res = await api.put<Contest>(`/contests/${id}`, data)
  return res.data
}

export async function uploadContestCover(id: number | string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ cover_image: string }>(`/contests/${id}/cover`, form)
  return res.data
}

export async function uploadMarkdownImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ url: string }>('/markdown-images', form)
  return res.data
}

export function contestCoverUrl(id: number | string, coverImage?: string) {
  return coverImage ? `${api.defaults.baseURL}/contests/${id}/cover` : ''
}

export async function deleteContest(id: number | string) {
  await api.delete(`/contests/${id}`)
}

export async function addContestProblem(
  id: number | string,
  data: { problem_id: number; display_id: string; sort_order: number },
) {
  const res = await api.post<{ ok: boolean }>(`/contests/${id}/problems`, data)
  return res.data
}

export async function removeContestProblem(id: number | string, problemId: number) {
  await api.delete(`/contests/${id}/problems/${problemId}`)
}

export async function registerContest(id: number | string, teamName: string) {
  const res = await api.post<{ ok: boolean }>(`/contests/${id}/register`, {
    team_name: teamName,
  })
  return res.data
}

export async function getContestRegistration(id: number | string) {
  const res = await api.get<ContestRegistration>(`/contests/${id}/registration`)
  return res.data
}

export async function addContestMember(id: number | string, teamId: number, data: { user_id?: number; username?: string }) {
  const res = await api.post(`/contests/${id}/teams/${teamId}/members`, data)
  return res.data
}

export async function removeContestMember(id: number | string, teamId: number, userId: number) {
  await api.delete(`/contests/${id}/teams/${teamId}/members/${userId}`)
}

export async function exportContestStandings(id: number | string, format: 'csv' | 'json' = 'csv') {
  const res = await api.get<Blob>(`/contests/${id}/standings/export`, { params: { format }, responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = `contest-${id}-standings.${format}`
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportContestDataPackage(id: number | string) {
  const res = await api.get<Blob>(`/contests/${id}/data-package`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = `contest-${id}-data.zip`
  link.click()
  URL.revokeObjectURL(url)
}

export async function uploadContestAvatar(id: number | string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ avatar: string }>(`/contests/${id}/avatar`, form)
  return res.data
}

export async function submitToContest(
  id: number | string,
  problemId: number,
  language: string,
  code: string,
  optimize = true,
) {
  const res = await api.post<{ id: number }>(`/contests/${id}/submit`, {
    problem_id: problemId,
    language,
    code,
    optimize,
  })
  return res.data
}

export async function getContestStandings(id: number | string, dynamic = false) {
  const res = await api.get<ContestStandings>(`/contests/${id}/standings`, {
    params: dynamic ? { view: 'dynamic' } : undefined,
  })
  return res.data
}

// ---- 比赛总览 / 题目上下文 / 我的提交 ----

export async function getContestOverview(id: number | string) {
  const res = await api.get<ContestOverview>(`/contests/${id}/overview`)
  return res.data
}

export async function getContestCommunications(id: number | string) {
  const res = await api.get<ContestCommunications>(`/contests/${id}/communications`)
  return res.data
}

export async function createContestAnnouncement(
  id: number | string,
  data: { title: string; content: string; pinned: boolean },
) {
  const res = await api.post(`/contests/${id}/announcements`, data)
  return res.data
}

export async function deleteContestAnnouncement(id: number | string, announcementId: number) {
  await api.delete(`/contests/${id}/announcements/${announcementId}`)
}

export async function askContestQuestion(id: number | string, content: string) {
  const res = await api.post(`/contests/${id}/questions`, { content })
  return res.data
}

export async function answerContestQuestion(
  id: number | string,
  questionId: number,
  data: { answer: string; public: boolean },
) {
  const res = await api.put<{ ok: boolean }>(`/contests/${id}/questions/${questionId}`, data)
  return res.data
}

export async function getContestProblem(id: number | string, problemId: number | string) {
  const res = await api.get<ContestProblemView>(`/contests/${id}/problems/${problemId}`)
  return res.data
}

export async function getContestMySubmissions(params: {
  id: number | string
  page: number
  size: number
  problem_id?: number
  status?: string
}) {
  const { id, ...rest } = params
  const res = await api.get<Page<SubmissionListItem>>(`/contests/${id}/submissions`, { params: rest })
  return res.data
}

export async function updateContestProblem(
  id: number | string,
  problemId: number,
  data: { display_id: string; score: number | null; submission_limit: number | null; theme_color?: string },
) {
  const res = await api.put<{ ok: boolean }>(`/contests/${id}/problems/${problemId}`, data)
  return res.data
}

export async function reorderContestProblems(id: number | string, problemIds: number[]) {
  const res = await api.put<{ ok: boolean }>(`/contests/${id}/problems/order`, {
    problem_ids: problemIds,
  })
  return res.data
}

// ---- Open Hacking（锁题 / 查看他人提交 / 发起 Hack） ----

export async function lockContestProblem(id: number | string, problemId: number) {
  const res = await api.post<{ ok: boolean; locked: boolean }>(
    `/contests/${id}/problems/${problemId}/lock`,
  )
  return res.data
}

export async function getContestLocks(id: number | string) {
  const res = await api.get<{ problem_ids: number[] }>(`/contests/${id}/locks`)
  return res.data.problem_ids
}

export async function getHackTargets(id: number | string, problemId: number) {
  const res = await api.get<HackTargetsResp>(`/contests/${id}/problems/${problemId}/hack-targets`)
  return res.data
}

export async function createHack(
  id: number | string,
  data: { target_submission_id: number; input: string; expected_output: string },
) {
  const res = await api.post<{ id: number }>(`/contests/${id}/hacks`, data)
  return res.data
}

export async function getContestHacks(id: number | string) {
  const res = await api.get<{ items: ContestHackItem[] }>(`/contests/${id}/hacks`)
  return res.data.items
}

export async function getServerTime(): Promise<string> {
  const res = await api.get<{ server_time: string }>('/health')
  return res.data.server_time
}
