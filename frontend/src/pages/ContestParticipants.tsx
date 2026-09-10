import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { exportContestDataPackage, exportContestStandings, extractError, exportContestParticipants, getContestParticipants, removeContestParticipant } from '../api'
import PageHeader from '../components/PageHeader'
import type { ContestParticipant } from '../types'
import { formatTime } from '../utils/format'

export default function ContestParticipants() {
  const { id } = useParams()
  const contestId = Number(id)
  const [items, setItems] = useState<ContestParticipant[]>([])
  const [error, setError] = useState('')
  const load = () => getContestParticipants(contestId).then(setItems).catch((err) => setError(extractError(err)))
  useEffect(() => { void load() }, [contestId])
  const remove = async (teamId: number) => {
    if (!window.confirm('移除该参赛者的报名？历史提交不会删除。')) return
    try { await removeContestParticipant(contestId, teamId); await load() } catch (err) { setError(extractError(err)) }
  }
  return (
    <div className="contest-participants-page">
      <PageHeader
        eyebrow="比赛管理"
        title="参赛者管理"
        description="查看报名队伍与成员名单，导出报名、榜单或完整数据包。"
        actions={
          <>
            <Link to={`/contest/${contestId}`} className="button button-secondary">返回比赛</Link>
            <button className="button button-secondary" type="button" onClick={() => void exportContestParticipants(contestId)}>报名 CSV</button>
            <button className="button button-secondary" type="button" onClick={() => void exportContestStandings(contestId)}>榜单 CSV</button>
            <button className="button button-primary" type="button" onClick={() => void exportContestDataPackage(contestId)}>导出数据包</button>
          </>
        }
      />

      {error && <div className="error-message">{error}</div>}

      <div className="table-summary">
        <span>共 {items.length} 支队伍报名</span>
      </div>

      <div className="table-frame">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 200 }}>队长</th>
              <th style={{ width: 200 }}>队伍名</th>
              <th>成员</th>
              <th className="cell-right" style={{ width: 96 }}>提交</th>
              <th className="cell-right" style={{ width: 80 }}>AC</th>
              <th style={{ width: 160 }}>最后提交</th>
              <th className="cell-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  <div className="empty-state">
                    <span className="empty-state-title">暂无参赛者</span>
                    <span className="empty-state-hint">比赛开放报名后，报名队伍会出现在这里。</span>
                  </div>
                </td>
              </tr>
            ) : items.map((item) => (
              <tr key={item.team_id}>
                <td>
                  {item.username}
                  <small className="table-subtext cell-num">#{item.team_id}</small>
                </td>
                <td>{item.team_name}</td>
                <td>{item.members?.join('、') || item.username}</td>
                <td className="cell-right cell-num">{item.submission_count}</td>
                <td className="cell-right cell-num">{item.accepted_count}</td>
                <td className="cell-num">{item.last_submitted_at ? formatTime(item.last_submitted_at) : '—'}</td>
                <td className="cell-actions">
                  <button className="button button-ghost button-sm danger" type="button" onClick={() => void remove(item.team_id)}>
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
