import { useEffect, useRef, useState } from 'react'

type AnimatedCounterProps = {
  /** 目标数值 */
  value: number
  /** 动画时长（毫秒），默认 800ms */
  duration?: number
  /** 数值后缀，例如「分」「%」 */
  suffix?: string
}

/** 缓出曲线：起步快、收尾慢，长距离跳变时读数更稳 */
function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3)
}

/**
 * 数字滚动计数器。
 * 挂载时从 0 滚到目标值，之后每次数值变化都从“当前显示值”接着滚到新值。
 * 插值走 requestAnimationFrame（不引依赖），数字用 tabular-nums 等宽避免抖动。
 */
export default function AnimatedCounter({ value, duration = 800, suffix = '' }: AnimatedCounterProps) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const shownRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    const to = value

    // 尊重系统“减少动态效果”：直接落到终值，不做逐帧动画
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (from === to || reduceMotion || duration <= 0) {
      fromRef.current = to
      shownRef.current = to
      setDisplay(to)
      return
    }

    startRef.current = null
    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now
      const progress = Math.min(1, (now - startRef.current) / duration)
      const next = from + (to - from) * easeOutCubic(progress)
      shownRef.current = next
      setDisplay(next)
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step)
      } else {
        frameRef.current = null
        fromRef.current = to
        shownRef.current = to
        setDisplay(to)
      }
    }

    frameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      // 动画被打断（数值又变了）时，以当前显示值为新起点，避免数字回跳
      fromRef.current = shownRef.current
    }
  }, [value, duration])

  const decimals = Number.isInteger(value) ? 0 : 2
  const shown = decimals === 0 ? Math.round(display) : Number(display.toFixed(decimals))

  return (
    <span className="rare-counter">
      {/* 动画中的数字对读屏隐藏，读屏只读最终值，避免逐帧播报 */}
      <span className="rare-counter-value" aria-hidden="true">
        {shown.toFixed(decimals)}
      </span>
      <span className="visually-hidden">{`${value.toFixed(decimals)}${suffix}`}</span>
      {suffix && (
        <span className="rare-counter-suffix" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  )
}
