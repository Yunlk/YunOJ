import axios, { AxiosError } from 'axios'
import type {
  Contest,
  ContestDetail,
  ContestInput,
  ContestStandings,
  Language,
  Page,
  ProblemDetail,
  ProblemListItem,
  RollBoard,
  Sample,
  SubmissionDetail,
  SubmissionListItem,
  User,
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

// ---- Problems ----

export async function getProblems(params: {
  page: number
  size: number
  keyword?: string
}) {
  const res = await api.get<Page<ProblemListItem>>('/problems', { params })
  return res.data
}

export async function getProblem(id: number | string) {
  const res = await api.get<ProblemDetail>(`/problems/${id}`)
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
) {
  const res = await api.post<{ id: number }>('/submissions', {
    problem_id: problemId,
    language,
    code,
    optimize,
  })
  return res.data
}

export async function getSubmissions(params: {
  page: number
  size: number
  problem_id?: string
  user_id?: string
  status?: string
}) {
  const res = await api.get<Page<SubmissionListItem>>('/submissions', { params })
  return res.data
}

export async function getSubmission(id: number | string) {
  const res = await api.get<SubmissionDetail>(`/submissions/${id}`)
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
  memory_kb: number
  compile_error?: string
}

export interface SampleCaseResult {
  status: string
  stdout: string
  time_ms: number
  memory_kb: number
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
) {
  const res = await api.post<RunTestResult>(`/problems/${problemId}/test`, {
    language,
    code,
    input,
    optimize,
  })
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

export async function createContest(data: ContestInput) {
  const res = await api.post<Contest>('/contests', data)
  return res.data
}

export async function updateContest(id: number | string, data: ContestInput) {
  const res = await api.put<Contest>(`/contests/${id}`, data)
  return res.data
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

export async function getContestStandings(id: number | string) {
  const res = await api.get<ContestStandings>(`/contests/${id}/standings`)
  return res.data
}

export async function getContestRollBoard(id: number | string) {
  const res = await api.get<RollBoard>(`/contests/${id}/rollboard`)
  return res.data
}
