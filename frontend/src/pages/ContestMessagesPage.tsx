import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  answerContestQuestion, createContestAnnouncement, deleteContestAnnouncement,
  extractError, getContest, getContestCommunications,
} from '../api'
import Markdown from '../components/Markdown'
import type { ContestCommunications, ContestQuestion } from '../types'
import { formatTime } from '../utils/format'

export default function ContestMessagesPage() {
  const { id } = useParams()
  const contestId = Number(id)
  const [contestTitle, setContestTitle] = useState('')
  const [data, setData] = useState<ContestCommunications | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementContent, setAnnouncementContent] = useState('')
  const [announcementPinned, setAnnouncementPinned] = useState(false)
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({})
  const [publicDrafts, setPublicDrafts] = useState<Record<number, boolean>>({})
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState('')

  const load = useCallback(async () => {
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
    getContest(contestId)
      .then((result) => setContestTitle(result.contest.title))
      .catch((err) => setError(extractError(err)))
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [contestId, load])

  const pendingQuestions = useMemo(
    () => data?.questions.filter((question) => !question.answer.trim()) ?? [],
    [data],
  )
  const answeredQuestions = useMemo(
    () => data?.questions.filter((question) => question.answer.trim()) ?? [],
    [data],
  )

  const publishAnnouncement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = announcementContent.trim()
    if (!content) return
    setBusyAction('announcement')
    setError('')
    setNotice('')
    try {
      await createContestAnnouncement(contestId, {
        title: announcementTitle.trim(),
        content,
        pinned: announcementPinned,
      })
      setAnnouncementTitle('')
      setAnnouncementContent('')
      setAnnouncementPinned(false)
      setNotice('广播已发布，参赛者将在数秒内收到强提醒。')
      await load()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusyAction('')
    }
  }

  const removeAnnouncement = async (announcementId: number) => {
    if (!window.confirm('删除这条广播？已阅读记录会一并失去意义。')) return
    setBusyAction(`delete-${announcementId}`)
    setError('')
    setNotice('')
    try {
      await deleteContestAnnouncement(contestId, announcementId)
      setNotice('广播已删除。')
      await load()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusyAction('')
    }
  }

  const saveAnswer = async (question: ContestQuestion) => {
    const answer = (answerDrafts[question.id] ?? question.answer).trim()
    if (!answer) return
    setBusyAction(`answer-${question.id}`)
    setError('')
    setNotice('')
    try {
      await answerContestQuestion(contestId, question.id, {
        answer,
        public: publicDrafts[question.id] ?? question.public,
      })
      setAnswerDrafts((current) => {
        const next = { ...current }
        delete next[question.id]
        return next
      })
      setPublicDrafts((current) => {
        const next = { ...current }
        delete next[question.id]
        return next
      })
      setEditingQuestionId(null)
      setNotice(question.answer ? '回答修改已保存。' : '回答已发布。')
      await load()
    } catch (err) {
      setError(extractError(err))
      await load()
    } finally {
      setBusyAction('')
    }
  }

  if (loading && !data) return <div className="page-loading">消息管理加载中…</div>

  return (
    <div className="contest-manage-page contest-message-page">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">比赛管理</div>
          <h1 className="page-title">消息管理{contestTitle ? ` · ${contestTitle}` : ''}</h1>
        </div>
        <Link to={`/contest/${contestId}`} className="button button-secondary">返回比赛总览</Link>
      </div>

      <div className="contest-nav contest-manage-nav">
        <Link className="contest-nav-item" to={`/contest/${contestId}/edit`}>比赛设置与题目</Link>
        <span className="contest-nav-item active">消息管理</span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {notice && <div className="success-message">{notice}</div>}

      <div className="contest-message-grid">
        <section className="card communication-panel">
          <div className="section-header">
            <div>
              <h2>发布广播</h2>
              <p className="muted">发布后，所有正在比赛页面中的参赛者都会收到强提醒。</p>
            </div>
          </div>
          <form className="communication-form" onSubmit={(event) => void publishAnnouncement(event)}>
            <input
              type="text"
              value={announcementTitle}
              maxLength={120}
              onChange={(event) => setAnnouncementTitle(event.target.value)}
              placeholder="广播标题（可选）"
            />
            <textarea
              value={announcementContent}
              maxLength={64 * 1024}
              onChange={(event) => setAnnouncementContent(event.target.value)}
              placeholder="输入广播内容，支持 Markdown"
              rows={6}
            />
            <div className="communication-form-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={announcementPinned}
                  onChange={(event) => setAnnouncementPinned(event.target.checked)}
                />
                置顶
              </label>
              <button
                type="submit"
                className="button button-primary"
                disabled={Boolean(busyAction) || !announcementContent.trim()}
              >
                {busyAction === 'announcement' ? '发布中…' : '发布广播'}
              </button>
            </div>
          </form>

          <div className="announcement-list">
            {!data?.announcements.length ? <p className="muted">暂无广播</p> : data.announcements.map((item) => (
              <article className="announcement-item" key={item.id}>
                <div className="announcement-item-head">
                  <strong>{item.title || '出题组广播'}</strong>
                  <time>{formatTime(item.created_at)}</time>
                </div>
                <Markdown>{item.content}</Markdown>
                {item.pinned && <span className="announcement-pinned">置顶</span>}
                <button
                  type="button"
                  className="link-button danger announcement-delete"
                  disabled={Boolean(busyAction)}
                  onClick={() => void removeAnnouncement(item.id)}
                >
                  {busyAction === `delete-${item.id}` ? '删除中…' : '删除'}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="card communication-panel message-question-panel">
          <div className="section-header">
            <div>
              <h2>参赛者问题</h2>
              <p className="muted">待回复 {pendingQuestions.length} 条。已回复内容可以进入编辑状态后修正。</p>
            </div>
          </div>

          <div className="question-list qa-thread-list">
            {pendingQuestions.length === 0 && <p className="muted">暂无待回复问题</p>}
            {pendingQuestions.map((question) => (
              <article className="qa-thread" key={question.id}>
                <div className="qa-message qa-message-user">
                  <div className="qa-message-meta">
                    <strong>{question.asker_name}</strong>
                    <time>{formatTime(question.asked_at)}</time>
                  </div>
                  <div className="qa-bubble">{question.content}</div>
                </div>
                <div className="qa-message qa-message-admin">
                  <div className="qa-message-meta"><strong>出题组</strong><span>待回复</span></div>
                  <div className="qa-bubble qa-composer">
                    <textarea
                      id={`qa-answer-${question.id}`}
                      value={answerDrafts[question.id] ?? ''}
                      maxLength={16 * 1024}
                      onChange={(event) => setAnswerDrafts((current) => ({ ...current, [question.id]: event.target.value }))}
                      placeholder="输入回复"
                      rows={4}
                    />
                    <div className="communication-form-actions">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={publicDrafts[question.id] ?? false}
                          onChange={(event) => setPublicDrafts((current) => ({ ...current, [question.id]: event.target.checked }))}
                        />
                        对所有参赛者公开
                      </label>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={Boolean(busyAction) || !(answerDrafts[question.id] ?? '').trim()}
                        onClick={() => void saveAnswer(question)}
                      >
                        {busyAction === `answer-${question.id}` ? '发送中…' : '发送回复'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}

            {answeredQuestions.length > 0 && <h3 className="answered-question-heading">已回复</h3>}
            {answeredQuestions.map((question) => (
              <article className="qa-thread" key={question.id}>
                <div className="qa-message qa-message-user">
                  <div className="qa-message-meta">
                    <strong>{question.asker_name}</strong>
                    <time>{formatTime(question.asked_at)}</time>
                  </div>
                  <div className="qa-bubble">{question.content}</div>
                </div>
                <div className="qa-message qa-message-admin">
                  <div className="qa-message-meta">
                    <strong>出题组</strong>
                    <time>{question.answered_at ? formatTime(question.answered_at) : '已回复'}</time>
                  </div>
                  {editingQuestionId === question.id ? (
                    <div className="qa-bubble qa-composer">
                      <textarea
                        id={`qa-answer-${question.id}`}
                        value={answerDrafts[question.id] ?? question.answer}
                        maxLength={16 * 1024}
                        onChange={(event) => setAnswerDrafts((current) => ({ ...current, [question.id]: event.target.value }))}
                        rows={4}
                      />
                      <div className="communication-form-actions">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={publicDrafts[question.id] ?? question.public}
                            onChange={(event) => setPublicDrafts((current) => ({ ...current, [question.id]: event.target.checked }))}
                          />
                          对所有参赛者公开
                        </label>
                        <div className="message-edit-actions">
                          <button type="button" className="button button-secondary" disabled={Boolean(busyAction)} onClick={() => setEditingQuestionId(null)}>取消</button>
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={Boolean(busyAction) || !(answerDrafts[question.id] ?? question.answer).trim()}
                            onClick={() => void saveAnswer(question)}
                          >
                            {busyAction === `answer-${question.id}` ? '保存中…' : '保存修改'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="qa-bubble qa-answer-bubble">
                      <p>{question.answer}</p>
                      <div className="qa-answer-footer">
                        <span>{question.public ? '所有参赛者可见' : '仅提问者可见'}</span>
                        <button
                          type="button"
                          className="link-button"
                          disabled={Boolean(busyAction)}
                          onClick={() => {
                            setAnswerDrafts((current) => ({ ...current, [question.id]: question.answer }))
                            setPublicDrafts((current) => ({ ...current, [question.id]: question.public }))
                            setEditingQuestionId(question.id)
                          }}
                        >
                          修改回答
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
