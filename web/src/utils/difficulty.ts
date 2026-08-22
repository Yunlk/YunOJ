export interface DifficultyInfo {
  value: number
  label: string
  weight: number
  className: string
}

export const DIFFICULTIES: DifficultyInfo[] = [
  { value: 1, label: '入门', weight: 1.0, className: 'difficulty-level-1' },
  { value: 2, label: '基础', weight: 1.2, className: 'difficulty-level-2' },
  { value: 3, label: '普及', weight: 1.5, className: 'difficulty-level-3' },
  { value: 4, label: '普及+', weight: 1.8, className: 'difficulty-level-4' },
  { value: 5, label: '提高', weight: 2.2, className: 'difficulty-level-5' },
  { value: 6, label: '提高+', weight: 2.7, className: 'difficulty-level-6' },
  { value: 7, label: '省选', weight: 3.3, className: 'difficulty-level-7' },
  { value: 8, label: 'NOI', weight: 4.0, className: 'difficulty-level-8' },
  { value: 9, label: 'Limit', weight: 5.0, className: 'difficulty-level-9' },
]

export function getDifficulty(value: number): DifficultyInfo {
  return DIFFICULTIES.find((item) => item.value === value) ?? DIFFICULTIES[0]
}
