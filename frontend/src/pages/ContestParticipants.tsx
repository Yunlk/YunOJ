import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { exportContestDataPackage, exportContestStandings, extractError, exportContestParticipants, getContestParticipants, removeContestParticipant } from '../api'
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
  return <div className="contest-participants-page"><div className="page-header"><div><Link to={`/contest/${contestId}`} className="back-link">← 返回比赛</Link><h1 className="page-title">参赛者管理</h1></div><div className="button-row"><button className="button button-secondary" type="button" onClick={() => void exportContestParticipants(contestId)}>报名 CSV</button><button className="button button-secondary" type="button" onClick={() => void exportContestStandings(contestId)}>榜单 CSV</button><button className="button button-primary" type="button" onClick={() => void exportContestDataPackage(contestId)}>导出数据包</button></div></div>{error && <div className="error-message">{error}</div>}<table className="data-table"><thead><tr><th>队长</th><th>队伍名</th><th>成员</th><th>提交</th><th>AC</th><th>最后提交</th><th>操作</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={7} className="table-empty">暂无参赛者</td></tr> : items.map((item) => <tr key={item.team_id}><td>{item.username}<small className="table-subtext">#{item.team_id}</small></td><td>{item.team_name}</td><td>{item.members?.join('、') || item.username}</td><td>{item.submission_count}</td><td>{item.accepted_count}</td><td className="mono">{item.last_submitted_at ? formatTime(item.last_submitted_at) : '—'}</td><td><button className="link-button" type="button" onClick={() => void remove(item.team_id)}>移除</button></td></tr>)}</tbody></table></div>
}
