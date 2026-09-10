import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  askContestQuestion, deleteContest, extractError, getContest, getContestCommunications, getContestOverview,
  uploadContestAvatar,
} from '../api'
import Markdown from '../components/Markdown'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import type {
  ContestCommunications, ContestDetail as ContestDetailData, ContestOverview,
  MyTeam, OverviewProblem,
} from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import {
  contestFeedbackLabel, contestModeLabel, contestPhase, phaseClass, phaseLabel, registrationModeLabel,
  scoreModeLabel, teamAvatarUrl,
} from '../utils/contest'
import { formatTime } from '../utils/format'

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function AvatarPicker({ preview, onPick }: { preview: string; onPick: (f: File) => void }) {
  const inputId = `avatar-input-${Math.random().toString(36).slice(2, 8)}`
  return (
    <div className="avatar-picker">
      <label htmlFor={inputId} className="avatar-button" title="点击选择头像图片（JPG/PNG/GIF/WebP，≤2MB）">
        {preview ? <img src={preview} alt="头像预览" className="avatar-img" /> : <span className="avatar-placeholder">+</span>}
      </label>
      <input
        id={inputId}
        type="file"
        accept={AVATAR_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          if (!AVATAR_TYPES.includes(f.type)) {
            window.alert('头像仅支持 JPG/PNG/GIF/WebP 图片')
            return
          }
          if (f.size > 2 * 1024 * 1024) {
            window.alert('头像不能超过 2MB')
            return
          }
          onPick(f)
        }}
      />
      <div className="avatar-picker-text">
        <div className="avatar-picker-title">队伍头像</div>
        <div className="muted">点击选择图片，将显示在动态排行榜上（可选）</div>
      </div>
    </div>
  )
}

function TeamAvatar({ contestId, teamId, avatar, size }: {
  contestId: number; teamId: number; avatar: string; size: 'sm' | 'lg'
}) {
  const url = teamAvatarUrl(contestId, teamId, avatar)
  const cls = size === 'lg' ? 'avatar-lg' : 'avatar-sm'
  if (!url) return <span className={`${cls} avatar-fallback`}>?</span>
  return <img src={url} alt="" className={cls} />
}

// ---------- 队伍信息（已报名） ----------

function TeamPanel({ contestId, teamId, team, onChanged }: {
  contestId: number; teamId: number; team: MyTeam; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(teamAvatarUrl(contestId, teamId, team.avatar) ?? '')

  return (
    <div className="card team-panel">
      <div className="team-panel-info">
        <TeamAvatar contestId={contestId} teamId={teamId} avatar={team.avatar} size="lg" />
        <div>
          <div className="team-panel-name">{team.team_name}</div>
          <div className="muted">
            已报名参赛
            {team.is_captain ? ' · 队长' : team.members && team.members.length > 0 ? ` · ${team.members.length} 名成员` : ''}
          </div>
        </div>
      </div>
      <div className="team-panel-avatar">
        <AvatarPicker
          preview={preview}
          onPick={async (f) => {
            setBusy(true)
            setError('')
            setPreview(URL.createObjectURL(f))
            try {
              await uploadContestAvatar(contestId, f)
              onChanged()
            } catch (err) {
              setError(extractError(err))
            } finally {
              setBusy(false)
            }
          }}
        />
        <span className="muted">{busy ? '上传中…' : '点击左侧圆框更换头像'}</span>
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  )
}

// ---------- 总览内容 ----------

function acceptingRate(attempted: number, accepted: number): string {
  if (attempted <= 0) return '—'
  return `${Math.round((accepted / attempted) * 100)}%`
}

function ContestCommunications({ contestId }: { contestId: number }) {
  const { user } = useAuth()
  const [data, setData] = useState<ContestCommunications | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [questionContent, setQuestionContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getContestCommunications(contestId)
      setData(result)
      setError('')
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }, [contestId])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!data || window.location.hash !== '#contest-communications') return
    const timer = window.setTimeout(() => {
      document.getElementById('contest-communications')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [data])

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!questionContent.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await askContestQuestion(contestId, questionContent.trim())
      setQuestionContent('')
      setNotice('问题已提交，等待出题组回答。')
      await load()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <div className="page-loading communication-loading">通信区加载中…</div>
  if (error && !data) return <div className="error-message">{error}</div>
  if (!data) return null

  return (
    <section id="contest-communications" className="contest-communications">
      {error && <div className="error-message">{error}</div>}
      {notice && <div className="success-message">{notice}</div>}
      <div className="communications-grid">
        <section className="card communication-panel">
          <div className="section-head">
            <h2 className="section-title">出题组广播</h2>
            <span className="section-hint">比赛通知、数据勘误和统一说明</span>
          </div>
          <div className="announcement-list">
            {data.announcements.length === 0 ? <p className="muted">暂无广播</p> : data.announcements.map((item) => (
              <article className="announcement-item" key={item.id}>
                <div className="announcement-item-head">
                  <strong>{item.title || '出题组广播'}</strong>
                  <time>{formatTime(item.created_at)}</time>
                </div>
                <Markdown>{item.content}</Markdown>
                {item.pinned && <span className="announcement-pinned">置顶</span>}
              </article>
            ))}
          </div>
        </section>

        <section className="card communication-panel">
          <div className="section-head">
            <h2 className="section-title">题目答疑</h2>
            <span className="section-hint">你的问题和出题组公开的回答</span>
          </div>
          <form className="communication-form" onSubmit={(event) => void submitQuestion(event)}>
            <label className="visually-hidden" htmlFor="contest-question">
              提问内容
            </label>
            <textarea
              id="contest-question"
              value={questionContent}
              maxLength={16 * 1024}
              onChange={(event) => setQuestionContent(event.target.value)}
              placeholder="描述你遇到的题意、样例或评测疑问"
              rows={3}
            />
            <div className="communication-form-actions">
              <span className="muted">提交后由出题组回答</span>
              <button type="submit" className="button button-primary button-sm" disabled={busy || !questionContent.trim()}>
                提交问题
              </button>
            </div>
          </form>
          <div className="question-list qa-thread-list">
            {data.questions.length === 0 ? <p className="muted">暂无答疑记录</p> : data.questions.map((question) => (
              <article className="qa-thread" key={question.id}>
                <div className="qa-message qa-message-user">
                  <div className="qa-message-meta">
                    <strong>{question.asker_id === user?.id ? '我' : '公开问题'}</strong>
                    <time>{formatTime(question.asked_at)}</time>
                  </div>
                  <div className="qa-bubble">{question.content}</div>
                </div>
                <div className="qa-message qa-message-admin">
                  <div className="qa-message-meta">
                    <strong>出题组</strong>
                    <span>{question.answer ? '已回复' : '等待回答'}</span>
                  </div>
                  {question.answer && <div className="qa-bubble qa-answer-bubble"><p>{question.answer}</p></div>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}

/** 顶部状态条：状态 + 倒计时（未开始显示开始时间）+ 赛程进度。 */
function ContestStatusBar({ overview, progress }: { overview: ContestOverview; progress: number }) {
  const contest = overview.contest
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
  const now = useClock(1000)
  const phase = contestPhase(contest, now)
  const solved = overview.problems.filter((problem) => problem.my_status === 'passed')

  return (
    <div className="contest-status-bar">
      <div className="contest-status-main">
        <span className={`phase-badge ${phaseClass(phase)}`}>{phaseLabel(phase)}</span>
        {phase === 'upcoming' && (
          <span className="contest-countdown" title={formatTime(contest.start_time)}>
            <span className="contest-countdown-label">距开始</span>
            {formatRemaining(startMs - now)}
          </span>
        )}
        {phase === 'running' && (
          <span className="contest-countdown danger" title={formatTime(contest.end_time)}>
            <span className="contest-countdown-label">剩余</span>
            {formatRemaining(endMs - now)}
          </span>
        )}
        {phase === 'ended' && <span className="muted">比赛已结束，提交不再计入成绩</span>}
        {solved.length > 0 && (
          <div className="contest-solved-dots" aria-label="已通过题目">
            {solved.map((problem) => (
              <span
                key={problem.problem_id}
                className={`contest-solved-dot dot-${problem.theme_color || 'blue'}`}
                title={`${problem.display_id} 已通过`}
              >
                {problem.display_id}
              </span>
            ))}
          </div>
        )}
        <span className="toolbar-spacer" />
        <span className="muted contest-status-time">
          {phase === 'upcoming' ? `开始 ${formatTime(contest.start_time)}` : `结束 ${formatTime(contest.end_time)}`}
        </span>
      </div>
      <div className="contest-progress">
        <div className="contest-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="contest-progress-labels muted">
        <span>{formatTime(contest.start_time)}</span>
        <span>{formatTime(contest.end_time)}</span>
      </div>
    </div>
  )
}

/** 题目表格：整行可点进比赛题目页（管理员与参赛者都能进入），行内保留标题链接。 */
function ProblemsTable({ contestId, problems }: {
  contestId: number
  problems: OverviewProblem[]
}) {
  const navigate = useNavigate()
  if (problems.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-title">本场比赛还没有题目</span>
        <span className="empty-state-hint">出题组添加题目后会显示在这里。</span>
      </div>
    )
  }
  return (
    <div className="table-frame">
      <table className="data-table contest-problems-table">
        <thead>
          <tr>
            <th style={{ width: 72 }}>题号</th>
            <th>标题</th>
            <th style={{ width: 104 }}>我的状态</th>
            <th style={{ width: 96 }} className="cell-right">
              通过 / 尝试
            </th>
            <th style={{ width: 76 }} className="cell-right">
              通过率
            </th>
            <th style={{ width: 96 }} className="cell-right">
              我的提交
            </th>
            <th style={{ width: 72 }} className="cell-actions">
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => {
            const remaining = problem.my_remaining
            return (
              <tr
                key={problem.problem_id}
                className="clickable-row"
                onClick={() => navigate(`/contest/${contestId}/problem/${problem.problem_id}`)}
              >
                <td className="mono contest-problem-id">{problem.display_id}</td>
                <td>
                  <Link
                    to={`/contest/${contestId}/problem/${problem.problem_id}`}
                    className="problem-link"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {problem.title}
                  </Link>
                </td>
                <td>
                  {problem.my_status === 'passed' && (
                    <span className="contest-my-status is-passed" title="已通过">
                      <span aria-hidden="true">✓</span>
                      <span className="visually-hidden">已通过</span>
                    </span>
                  )}
                  {problem.my_status === 'failed' && (
                    <span className="contest-my-status is-failed" title="已尝试但未通过">
                      <span aria-hidden="true">✗</span>
                      <span className="visually-hidden">已尝试但未通过</span>
                      {problem.my_score > 0 && <span className="contest-my-score">{problem.my_score} 分</span>}
                    </span>
                  )}
                  {problem.my_status === 'judging' && (
                    <span className="contest-my-status is-judging">评测中</span>
                  )}
                  {problem.my_status === 'untried' && (
                    <span className="contest-my-status is-untried" title="未尝试">
                      <span aria-hidden="true">–</span>
                      <span className="visually-hidden">未尝试</span>
                    </span>
                  )}
                </td>
                <td className="cell-right cell-num">
                  {problem.accepted_users} / {problem.attempted_users}
                </td>
                <td className="cell-right cell-num">{acceptingRate(problem.attempted_users, problem.accepted_users)}</td>
                <td className="cell-right cell-num">
                  <span title={remaining === null ? '提交次数不限' : `还可提交 ${remaining} 次`}>
                    {problem.my_submissions}
                    {remaining !== null && <span className="muted"> / 余 {remaining}</span>}
                  </span>
                </td>
                <td className="cell-actions">
                  <Link
                    to={`/contest/${contestId}/problem/${problem.problem_id}`}
                    className="button button-ghost button-sm"
                    onClick={(event) => event.stopPropagation()}
                  >
                    进入
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 赛制信息侧栏：保留原有信息并补齐赛制相关的其余字段。 */
function ContestRuleCard({ overview }: { overview: ContestOverview }) {
  const contest = overview.contest
  const problems = overview.problems
  const scoreText = problems.some((problem) => typeof problem.score === 'number' && problem.score > 0)
    ? `${problems[0]?.score ?? 100} 分`
    : '按测试点计分'
  return (
    <section className="side-card" aria-label="赛制信息">
      <h2 className="side-card-title">赛制</h2>
      <dl className="kv-list">
        <div>
          <dt>赛制</dt>
          <dd>{contestModeLabel(contest.mode)}</dd>
        </div>
        <div>
          <dt>反馈</dt>
          <dd>{contestFeedbackLabel(contest.feedback)}</dd>
        </div>
        <div>
          <dt>计分</dt>
          <dd>{scoreModeLabel(contest.score_mode)}</dd>
        </div>
        <div>
          <dt>单题分值</dt>
          <dd>{scoreText}</dd>
        </div>
        <div>
          <dt>提交上限</dt>
          <dd>
            {problems[0]?.submission_limit ? `单题 ${problems[0].submission_limit} 次` : '不限'}
          </dd>
        </div>
        <div>
          <dt>罚时</dt>
          <dd>{contest.penalty_minutes} 分钟 / 次</dd>
        </div>
        <div>
          <dt>封榜</dt>
          <dd>{contest.freeze_duration_minutes > 0 ? `结束前 ${contest.freeze_duration_minutes} 分钟` : '不封榜'}</dd>
        </div>
        <div>
          <dt>动态榜延迟</dt>
          <dd>{contest.dynamic_delay_minutes > 0 ? `${contest.dynamic_delay_minutes} 分钟` : '关闭'}</dd>
        </div>
        <div>
          <dt>报名方式</dt>
          <dd>{registrationModeLabel(contest.registration_mode, Math.max(contest.max_team_size, 1))}</dd>
        </div>
        <div>
          <dt>队伍成员编辑</dt>
          <dd>{contest.allow_team_edit ? '队长可添加成员' : '不可添加成员'}</dd>
        </div>
        <div>
          <dt>报名窗口</dt>
          <dd>
            {contest.reg_start_time || contest.reg_end_time
              ? `开放至 ${contest.reg_end_time ? formatTime(contest.reg_end_time) : '比赛结束'}`
              : '不限制'}
          </dd>
        </div>
        <div>
          <dt>Hack</dt>
          <dd>{contest.hacking_enabled ? '开放' : '关闭'}</dd>
        </div>
      </dl>
      {contest.pretest_only && (
        <p className="field-hint">比赛期间只跑预测试数据，赛后自动用完整数据重新系统测试。</p>
      )}
    </section>
  )
}

function MySummaryCard({ overview }: { overview: ContestOverview }) {
  const summary = overview.my_summary
  if (!summary) return null
  const contest = overview.contest
  return (
    <section className="side-card" aria-label="我的成绩">
      <h2 className="side-card-title">我的成绩</h2>
      {!summary.visible ? (
        <p className="muted">盲评进行中，成绩暂不可见</p>
      ) : (
        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-tile-label">排名</span>
            <span className="stat-tile-value">#{summary.rank}</span>
          </div>
          {contest.mode === 'ACM' ? (
            <div className="stat-tile">
              <span className="stat-tile-label">通过</span>
              <span className="stat-tile-value">{summary.solved ?? 0}</span>
            </div>
          ) : (
            <div className="stat-tile">
              <span className="stat-tile-label">总分</span>
              <span className="stat-tile-value">{summary.total_score ?? 0}</span>
            </div>
          )}
          {contest.mode !== 'OI' && (
            <div className="stat-tile">
              <span className="stat-tile-label">罚时</span>
              <span className="stat-tile-value">{summary.penalty ?? 0}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ContestOverviewContent({ contestId, isAdmin }: { contestId: number; isAdmin: boolean }) {
  const [overview, setOverview] = useState<ContestOverview | null>(null)
  const [error, setError] = useState('')
  const now = useClock(1000)

  useEffect(() => {
    let cancelled = false
    getContestOverview(contestId)
      .then((o) => {
        if (!cancelled) setOverview(o)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
    return () => {
      cancelled = true
    }
  }, [contestId])

  if (error) return <div className="error-message">{error}</div>
  if (!overview) return <div className="page-loading">总览加载中…</div>

  const { contest, problems } = overview
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
  const total = Math.max(1, endMs - startMs)
  const progress = Math.min(100, Math.max(0, ((now - startMs) / total) * 100))

  return (
    <div>
      <ContestStatusBar overview={overview} progress={progress} />

      <nav className="tabs contest-tabs" aria-label="比赛导航">
        <span className="tab active" aria-current="page">
          总览
        </span>
        <Link className="tab" to={`/contest/${contestId}/submissions`}>
          {isAdmin ? '全部提交' : '我的提交'}
        </Link>
        <Link className="tab" to={`/contest/${contestId}/standings`}>
          排行榜
        </Link>
        {isAdmin && (
          <>
            <Link className="tab" to={`/contest/${contestId}/edit`}>
              比赛设置
            </Link>
            <Link className="tab" to={`/contest/${contestId}/messages`}>
              消息管理
            </Link>
            <Link className="tab" to={`/contest/${contestId}/participants`}>
              参赛者
            </Link>
          </>
        )}
      </nav>

      {contest.description && (
        <div className="card contest-announcement">
          <Markdown>{contest.description}</Markdown>
        </div>
      )}

      <div className="layout-side contest-overview">
        <section className="contest-section">
          <div className="section-head">
            <h2 className="section-title">题目</h2>
            <span className="section-hint">
              共 {problems.length} 题 · 点击整行进入比赛题目页
            </span>
          </div>
          <ProblemsTable contestId={contestId} problems={problems} />
        </section>

        <aside className="contest-overview-side">
          <MySummaryCard overview={overview} />
          <ContestRuleCard overview={overview} />
        </aside>
      </div>
      {!isAdmin && <ContestCommunications contestId={contestId} />}
    </div>
  )
}

// ---------- 页面入口 ----------

export default function ContestDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const contestId = Number(id)

  const [data, setData] = useState<ContestDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const now = useClock(1000)

  const reload = useCallback(() => {
    getContest(contestId)
      .then(setData)
      .catch((err) => setError(extractError(err)))
  }, [contestId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getContest(contestId)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contestId])

  useEffect(() => {
    if (loading || !data || window.location.hash !== '#contest-communications') return
    const timer = window.setTimeout(() => {
      document.getElementById('contest-communications')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [data, loading])

  if (loading) return <div className="page-loading">加载中…</div>
  if (error) return <div className="error-message">{error}</div>
  if (!data) return <div className="error-message">比赛不存在</div>

  const { contest } = data
  const isAdmin = data.is_admin ?? false
  const registered = data.is_registered ?? false
  const phase = contestPhase(contest, now)
  const registerHref = user ? `/contest/${contest.id}/register` : '/login'

  return (
    <div className="contest-page">
      {contest.cover_image && (
        <img
          className="contest-cover-image"
          src={`${window.location.origin}/api/contests/${contest.id}/cover`}
          alt="比赛封面"
        />
      )}

      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/contests">比赛</Link>
        <span className="breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span>{contest.title}</span>
      </nav>

      <PageHeader
        title={contest.title}
        eyebrow={contestModeLabel(contest.mode)}
        description={
          registered && !isAdmin
            ? `已报名${data.my_team?.team_name ? `：${data.my_team.team_name}` : ''}，共 ${data.problems.length} 题。`
            : `共 ${data.problems.length} 题 · 报名截止后仍可查看赛题与榜单。`
        }
        actions={
          <>
            <span className="contest-badges">
              <span className="phase-badge">{phaseLabel(phase)}</span>
              <span className="tag-chip">{contestModeLabel(contest.mode)}</span>
              {contest.visibility === 'private' && <span className="tag-chip">私有</span>}
            </span>
            {isAdmin ? (
              <>
                <Link to={`/contest/${contest.id}/messages`} className="button button-secondary button-sm">
                  消息管理
                </Link>
                <Link to={`/contest/${contest.id}/participants`} className="button button-secondary button-sm">
                  参赛者
                </Link>
                <Link to={`/contest/${contest.id}/edit`} className="button button-secondary button-sm">
                  编辑
                </Link>
                <button
                  type="button"
                  className="button button-danger button-sm"
                  onClick={async () => {
                    if (!window.confirm(`确定删除比赛「${contest.title}」？该操作不可恢复。`)) return
                    try {
                      await deleteContest(contestId)
                      navigate('/contests')
                    } catch (err) {
                      window.alert(extractError(err))
                    }
                  }}
                >
                  删除
                </button>
              </>
            ) : (
              <Link to={registerHref} className={registered ? 'button button-secondary' : 'button button-primary'}>
                {user ? (registered ? '队伍报名' : '报名参赛') : '登录报名'}
              </Link>
            )}
          </>
        }
      />

      {registered || isAdmin ? (
        <>
          {registered && user && (
            <TeamPanel
              contestId={contest.id}
              teamId={data.my_team?.team_id ?? user.id}
              team={data.my_team ?? { team_name: user.username, avatar: '' }}
              onChanged={reload}
            />
          )}
          <ContestOverviewContent contestId={contest.id} isAdmin={isAdmin} />
        </>
      ) : (
        <>
          <div className="contest-status-bar">
            <div className="contest-status-main">
              <span className={`phase-badge ${phaseClass(phase)}`}>{phaseLabel(phase)}</span>
              {phase === 'upcoming' && (
                <span className="contest-countdown" title={formatTime(contest.start_time)}>
                  <span className="contest-countdown-label">距开始</span>
                  {formatRemaining(new Date(contest.start_time).getTime() - now)}
                </span>
              )}
              {phase === 'running' && (
                <span className="contest-countdown danger" title={formatTime(contest.end_time)}>
                  <span className="contest-countdown-label">剩余</span>
                  {formatRemaining(new Date(contest.end_time).getTime() - now)}
                </span>
              )}
              {phase === 'ended' && <span className="muted">比赛已结束</span>}
              <span className="toolbar-spacer" />
              <span className="muted contest-status-time">
                {user ? '报名后才能进入比赛题目' : '登录后可以报名参赛'}
              </span>
            </div>
          </div>

          <div className="layout-side contest-overview">
            <section className="contest-section">
              <div className="section-head">
                <h2 className="section-title">赛题</h2>
                <span className="section-hint">报名后可见题目状态与提交入口</span>
              </div>
              <div className="table-frame">
                <table className="data-table contest-problems-table">
                  <thead>
                    <tr>
                      <th style={{ width: 72 }}>题号</th>
                      <th>标题</th>
                      <th style={{ width: 120 }} className="cell-right">
                        单题分值
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.problems.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="table-empty">
                          本场比赛还没有题目
                        </td>
                      </tr>
                    ) : (
                      data.problems.map((problem) => (
                        <tr key={problem.problem_id}>
                          <td className="mono contest-problem-id">{problem.display_id}</td>
                          <td>{problem.title}</td>
                          <td className="cell-right cell-num">{problem.score ?? 100}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="contest-overview-side">
              <section className="side-card" aria-label="比赛信息">
                <h2 className="side-card-title">比赛信息</h2>
                <dl className="kv-list">
                  <div>
                    <dt>开始时间</dt>
                    <dd className="mono">{formatTime(contest.start_time)}</dd>
                  </div>
                  <div>
                    <dt>结束时间</dt>
                    <dd className="mono">{formatTime(contest.end_time)}</dd>
                  </div>
                  <div>
                    <dt>赛制</dt>
                    <dd>{contestModeLabel(contest.mode)}</dd>
                  </div>
                  <div>
                    <dt>反馈</dt>
                    <dd>{contestFeedbackLabel(contest.feedback)}</dd>
                  </div>
                  <div>
                    <dt>计分</dt>
                    <dd>{scoreModeLabel(contest.score_mode)}</dd>
                  </div>
                  <div>
                    <dt>报名方式</dt>
                    <dd>{registrationModeLabel(contest.registration_mode, Math.max(contest.max_team_size, 1))}</dd>
                  </div>
                  <div>
                    <dt>报名窗口</dt>
                    <dd>
                      {contest.reg_start_time || contest.reg_end_time
                        ? `开放至 ${contest.reg_end_time ? formatTime(contest.reg_end_time) : '比赛结束'}`
                        : '不限制'}
                    </dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>

          {contest.description && (
            <div className="card contest-announcement">
              <Markdown>{contest.description}</Markdown>
            </div>
          )}
        </>
      )}
    </div>
  )
}
