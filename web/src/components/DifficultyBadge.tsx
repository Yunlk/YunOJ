import { getDifficulty } from '../utils/difficulty'

export default function DifficultyBadge({ value, showWeight = false }: {
  value: number
  showWeight?: boolean
}) {
  const info = getDifficulty(value)
  return (
    <span className={`difficulty-badge ${info.className}`} title={`难度权重 ${info.weight.toFixed(1)}`}>
      {info.label}{showWeight ? ` · ${info.weight.toFixed(1)}` : ''}
    </span>
  )
}
