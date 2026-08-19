import { useParams } from 'react-router-dom'
import RollBoardPlayer from '../components/RollBoardPlayer'

/** 独立滚榜展示页（/contest/:id/roll）：全屏投影模式，无导航栏与关闭按钮。 */
export default function StandaloneRoll() {
  const { id } = useParams()
  return (
    <div className="roll-standalone">
      <RollBoardPlayer contestId={Number(id)} onClose={() => {}} embedded />
    </div>
  )
}
