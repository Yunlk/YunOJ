import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import AnimatedCounter from '../components/rare/AnimatedCounter'
import NotificationBell from '../components/rare/NotificationBell'
import '../styles/pages/demo.css'

/**
 * Rare UI 动效 demo：铃铛未读徽标 + 数字滚动计数器。
 * 零新依赖——只用 React 18 与项目现有设计令牌 / 基座类手写。
 */
export default function DemoUI() {
  const [unread, setUnread] = useState(3)
  const [rating, setRating] = useState(1240)
  const [previousRating, setPreviousRating] = useState(1240)
  const [solved, setSolved] = useState(168)

  /** 改分前先记住旧值，页面上的「上一值」也走滚动计数器 */
  const changeRating = (next: (current: number) => number) => {
    setPreviousRating(rating)
    setRating(next(rating))
  }

  return (
    <div className="demo-ui-page">
      <PageHeader
        eyebrow="前端演示 · 不连接接口"
        title="Rare UI 动效对照"
        description="两个手写动效组件，用来评估是否推广到全站。这是 demo：零新依赖，全部用现有设计令牌与基座类手写。"
        actions={
          <span className="badge badge-info">
            <span aria-hidden="true">●</span>
            demo · 零新依赖
          </span>
        }
      />

      <div className="info-message demo-ui-notice">
        本页是 <strong>demo</strong>：没有新增任何 npm 依赖，样式只用 <code>tokens.css</code> 的
        <code>--c-* / --fs-* / --space-*</code> 令牌与 <code>components.css</code> 的基座类手写；
        动画遵循 <code>prefers-reduced-motion</code>，页面未接入任何接口。
      </div>

      <div className="demo-ui-grid">
        <section className="card demo-ui-card">
          <div className="demo-ui-card-head">
            <h2 className="panel-title">通知铃铛 · NotificationBell</h2>
            <span className="badge">组件 1</span>
          </div>
          <p className="field-hint demo-ui-note">
            可以用在顶栏的「通知」入口：把未读数从纯文字换成会摆动、会翻牌的徽标，
            新通知到达时不需要额外提示也不会被忽略。
          </p>

          <div className="demo-ui-stage">
            <NotificationBell count={unread} max={99} />
          </div>

          <div className="demo-ui-readout">
            <span className="demo-ui-readout-label">当前未读</span>
            <strong className="demo-ui-readout-value">
              {unread} 条
              <span className="visually-hidden">
                （徽标显示 {unread > 99 ? '99+' : unread}）
              </span>
            </strong>
            <span className="field-hint">连续快速点「+1」可以看到摆幅逐级加大；清零后徽标收缩消失。</span>
          </div>

          <div className="demo-ui-actions">
            <button type="button" className="button button-primary" onClick={() => setUnread((current) => current + 1)}>
              +1 新通知
            </button>
            <button type="button" className="button button-secondary" onClick={() => setUnread((current) => current + 12)}>
              +12 批量到达
            </button>
            <button type="button" className="button button-secondary" onClick={() => setUnread(120)}>
              设成 120（看 99+）
            </button>
            <button type="button" className="button button-ghost" onClick={() => setUnread(0)}>
              清零
            </button>
          </div>
        </section>

        <section className="card demo-ui-card">
          <div className="demo-ui-card-head">
            <h2 className="panel-title">数字滚动 · AnimatedCounter</h2>
            <span className="badge">组件 2</span>
          </div>
          <p className="field-hint demo-ui-note">
            可以用在个人中心 / 榜单的「综合分」：分值或名次变化时从旧值滚到新值，
            比直接替换数字更容易看出「涨了还是掉了」。
          </p>

          <div className="demo-ui-stage demo-ui-stage-counter">
            <div className="demo-ui-score">
              <span className="demo-ui-score-label">综合分</span>
              <AnimatedCounter value={rating} suffix="分" />
              <span className="demo-ui-score-delta">
                上一值 <AnimatedCounter value={previousRating} duration={500} />
              </span>
            </div>
            <div className="stat-grid demo-ui-stats">
              <div className="stat-tile">
                <span className="stat-tile-label">已通过</span>
                <span className="stat-tile-value">
                  <AnimatedCounter value={solved} duration={600} />
                </span>
                <span className="stat-tile-sub">题目数</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">通过率</span>
                <span className="stat-tile-value">
                  <AnimatedCounter value={62.5} duration={600} suffix="%" />
                </span>
                <span className="stat-tile-sub">保持不变</span>
              </div>
            </div>
          </div>

          <div className="demo-ui-actions">
            <button type="button" className="button button-primary" onClick={() => changeRating((current) => current + 37)}>
              综合分 +37
            </button>
            <button type="button" className="button button-secondary" onClick={() => changeRating((current) => current - 21)}>
              综合分 −21
            </button>
            <button type="button" className="button button-secondary" onClick={() => changeRating(() => 1500)}>
              跳到 1500
            </button>
            <button type="button" className="button button-ghost" onClick={() => setSolved((current) => current + 1)}>
              通过 +1
            </button>
            <button type="button" className="button button-ghost" onClick={() => { changeRating(() => 1240); setSolved(168) }}>
              复位
            </button>
          </div>
        </section>
      </div>

      <section className="card demo-ui-card demo-ui-notes">
        <h2 className="panel-title">评估时要看的两点</h2>
        <ul className="demo-ui-list">
          <li>
            <strong>铃铛</strong>：摆动只在「未读增加」时触发，读到已读不会乱晃；连点会加大摆幅，
            停手约 0.7 秒后回到轻摆。徽标为 0 时收缩消失，此时按钮的 <code>aria-label</code> 仍是「通知，没有未读」。
          </li>
          <li>
            <strong>计数器</strong>：挂载时从 0 滚到目标值，之后从「当前显示值」接着滚，
            中途再次变更数值不会回跳；等宽数字（<code>tabular-nums</code>）保证宽度不抖。
          </li>
          <li>
            两者在系统开启「减少动态效果」时都只显示最终状态，不做任何过渡。
          </li>
        </ul>
      </section>
    </div>
  )
}
