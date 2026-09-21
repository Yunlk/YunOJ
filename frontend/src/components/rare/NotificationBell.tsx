import { useEffect, useRef, useState, type CSSProperties } from 'react'

type NotificationBellProps = {
  /** 未读数量 */
  count: number
  /** 徽标显示上限，超过显示为 `${max}+` */
  max?: number
  onClick?: () => void
}

/** 铃铛摆动的基础幅度（度） */
const SWING_BASE_DEG = 14
/** 连点一次增加的幅度（度） */
const SWING_STEP_DEG = 8
/** 幅度上限，避免连点后晃成“甩头” */
const SWING_MAX_DEG = 34
/** 两次新增间隔小于该值时算“连点” */
const RAPID_WINDOW_MS = 700

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/** 单个数位：0-9 竖排成一列，用 transform 滚到目标数字（纯 CSS 过渡）。 */
function RollingDigit({ digit }: { digit: number }) {
  return (
    <span className="rare-roll-digit">
      <span className="rare-roll-track" style={{ transform: `translateY(${-digit}em)` }}>
        {DIGITS.map((item) => (
          <span className="rare-roll-cell" key={item}>
            {item}
          </span>
        ))}
      </span>
    </span>
  )
}

/** 多位数字：从右往左编号数位，位数变化时高位以外的数位 key 不变，避免整块重滚。 */
function RollingNumber({ text }: { text: string }) {
  const chars = text.split('')
  return (
    <span className="rare-roll-number">
      {chars.map((char, index) => (
        <RollingDigit key={`pos-${chars.length - index}`} digit={Number(char)} />
      ))}
    </span>
  )
}

/**
 * iOS 风格通知铃铛 + 未读徽标。
 * - 数量增加时铃铛摆动一次，短时间连点则逐级加大摆幅；
 * - 徽标数字用「滚动翻牌」过渡，为 0 时收缩消失；
 * - 图形是内联 SVG，不依赖任何图标库。
 */
export default function NotificationBell({ count, max = 99, onClick }: NotificationBellProps) {
  const unread = Math.max(0, Math.floor(count))
  const limit = Math.max(1, Math.floor(max))
  const overflow = unread > limit

  const [swingKey, setSwingKey] = useState(0)
  const [swingDeg, setSwingDeg] = useState(SWING_BASE_DEG)
  const previousCount = useRef(unread)
  const lastSwingAt = useRef(0)
  const amplitude = useRef(SWING_BASE_DEG)

  // 只在数量增加时摆动；与上次摆动间隔很短则加大摆幅（连点摆得更猛）
  useEffect(() => {
    const previous = previousCount.current
    previousCount.current = unread
    if (unread <= previous) return
    const now = Date.now()
    const rapid = now - lastSwingAt.current < RAPID_WINDOW_MS
    lastSwingAt.current = now
    amplitude.current = rapid
      ? Math.min(amplitude.current + SWING_STEP_DEG, SWING_MAX_DEG)
      : SWING_BASE_DEG
    // 同时更新摆幅与 key：key 变化会重建节点，从而以新幅度重放关键帧
    setSwingDeg(amplitude.current)
    setSwingKey((key) => key + 1)
  }, [unread])

  // 摆幅通过 CSS 变量注入关键帧，比维护多套 keyframes 更好改
  const swingStyle = { '--rare-swing-amp': `${swingDeg}deg` } as CSSProperties
  const label = unread > 0 ? `通知，${unread} 条未读` : '通知，没有未读'

  return (
    <span className="rare-bell">
      <button type="button" className="icon-btn rare-bell-button" onClick={onClick} aria-label={label}>
        <span
          className={`rare-bell-swing${swingKey > 0 ? ' is-swinging' : ''}`}
          key={swingKey}
          style={swingStyle}
          aria-hidden="true"
        >
          <svg className="rare-bell-icon" viewBox="0 0 24 24" width="20" height="20" focusable="false">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </span>
        <span className={`rare-bell-badge${unread > 0 ? '' : ' is-empty'}`} aria-hidden="true">
          <RollingNumber text={String(overflow ? limit : unread)} />
          {overflow && <span className="rare-roll-plus">+</span>}
        </span>
      </button>
      {/* 动画不是唯一的信息载体：读屏与文本始终能拿到未读条数 */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {unread > 0 ? `${unread} 条未读通知` : '没有未读通知'}
      </span>
    </span>
  )
}
