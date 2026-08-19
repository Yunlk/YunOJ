export type StatusColor = 'green' | 'red' | 'orange' | 'blue' | 'yellow' | 'gray'

export interface StatusInfo {
  label: string
  color: StatusColor
}

const STATUS_MAP: Record<string, StatusInfo> = {
  pending: { label: '等待中', color: 'gray' },
  running: { label: '评测中', color: 'blue' },
  accepted: { label: '通过', color: 'green' },
  wrong_answer: { label: '答案错误', color: 'red' },
  time_limit_exceeded: { label: '超出时间限制', color: 'orange' },
  memory_limit_exceeded: { label: '超出内存限制', color: 'orange' },
  output_limit_exceeded: { label: '超出输出限制', color: 'orange' },
  runtime_error: { label: '运行时错误', color: 'red' },
  compile_error: { label: '编译错误', color: 'yellow' },
  system_error: { label: '系统错误', color: 'red' },
  // 盲评进行中的脱敏状态
  hidden: { label: '盲评中', color: 'gray' },
}

export function getStatusInfo(status: string): StatusInfo {
  return STATUS_MAP[status] ?? { label: status, color: 'gray' }
}

export function isPendingStatus(status: string): boolean {
  return status === 'pending' || status === 'running'
}
