import type { RollEvent } from '../types'

export type RevealPhase = 'focus' | 'judging' | 'result' | 'settled'

export interface RevealTiming {
  focus: number
  judging: number
  result: number
  settled: number
  total: number
  rankChange: boolean
  batchSize: number
}

const TARGET_REVEAL_MS = 90_000
const MIN_REVEAL_SCALE = 0.55

function isAccepted(event: Pick<RollEvent, 'status'>): boolean {
  return event.status === 'accepted'
}

function timestamp(event: Pick<RollEvent, 'created_at'>): number | null {
  if (!event.created_at) return null
  const value = Date.parse(event.created_at)
  return Number.isFinite(value) ? value : null
}

function batchSizes(events: RollEvent[]): number[] {
  const sizes = new Array(events.length).fill(1)
  const dated = events
    .map((event, index) => ({ index, at: timestamp(event) }))
    .filter((item): item is { index: number; at: number } => item.at !== null)
    .sort((left, right) => left.at - right.at)

  let start = 0
  for (let end = 1; end <= dated.length; end += 1) {
    const sameWindow = end < dated.length && dated[end].at - dated[end - 1].at <= 500
    if (sameWindow) continue
    const size = end - start
    for (let cursor = start; cursor < end; cursor += 1) sizes[dated[cursor].index] = size
    start = end
  }
  return sizes
}

function batchScale(size: number): number {
  if (size <= 1) return 1
  // Simultaneous submissions remain individual events, but do not add a long
  // pause between every row while the audience is watching the same moment.
  return Math.max(0.55, 1 - Math.min(0.45, (size - 1) * 0.06))
}

function baseTiming(event: RollEvent, simultaneous: number): RevealTiming {
  const rankChange = isAccepted(event)
  const scale = batchScale(simultaneous)
  const phases = rankChange
    ? [460, 360, 620, 240]
    : [90, 50, 220, 70]
  const [focus, judging, result, settled] = phases.map((value) => Math.round(value * scale))
  return {
    focus,
    judging,
    result,
    settled,
    total: focus + judging + result + settled,
    rankChange,
    batchSize: simultaneous,
  }
}

/**
 * 生成滚榜每个事件的阶段时长。
 *
 * 失败事件仍会逐条显示，避免丢失评测过程，但只占很短的时间；AC
 * 事件保留完整聚焦和排名移动。事件太多时整体按比例压缩，避免水题
 * 提交把滚榜拖到不可控的长度。
 */
export function buildRevealTimings(events: RollEvent[]): RevealTiming[] {
  if (events.length === 0) return []
  const sizes = batchSizes(events)
  const timings = events.map((event, index) => baseTiming(event, sizes[index]))
  const rawTotal = timings.reduce((sum, timing) => sum + timing.total, 0)
  const scale = rawTotal > TARGET_REVEAL_MS
    ? Math.max(MIN_REVEAL_SCALE, TARGET_REVEAL_MS / rawTotal)
    : 1
  if (scale === 1) return timings
  return timings.map((timing) => {
    const focus = Math.max(40, Math.round(timing.focus * scale))
    const judging = Math.max(30, Math.round(timing.judging * scale))
    const result = Math.max(120, Math.round(timing.result * scale))
    const settled = Math.max(40, Math.round(timing.settled * scale))
    return { ...timing, focus, judging, result, settled, total: focus + judging + result + settled }
  })
}
